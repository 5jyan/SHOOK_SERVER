import { storage } from "../repositories/storage.js";
import { YouTubeSummaryService } from "./youtube-summary.js";
import { errorLogger } from "./error-logging-service.js";
import { pushNotificationService } from "./push-notification-service.js";
import { YoutubeChannel, Video, InsertVideo } from "../../shared/schema.js";
import { decodeYouTubeTitle } from "../utils/html-decode.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";
import { youtubeApiUtils } from "../utils/youtube-api-utils.js";

interface RSSVideo {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: Date;
  channelTitle: string;
  channelThumbnail: string | null;
}

interface RSSEntry {
  videoId: string;
  title: string;
  publishedAt: string;
  linkUrl: string;
}

export class YouTubeMonitor {
  // Configuration constants
  private readonly CONCURRENT_LIMIT = 3;
  private readonly SUMMARY_TIMEOUT = 120000; // 2 minutes
  private readonly MONITORING_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Runtime state
  private state = {
    monitorInterval: null as NodeJS.Timeout | null,
    summaryQueue: [] as RSSVideo[],
    isProcessingSummaries: false,
  };

  // Services
  private summaryService: YouTubeSummaryService;

  constructor() {
    this.summaryService = new YouTubeSummaryService();
    logWithTimestamp('[YOUTUBE_MONITOR] Initialized with concurrent limit:', this.CONCURRENT_LIMIT);
  }

  // ================================
  // RSS Parsing Methods
  // ================================

  private logRSSEntries(xmlText: string): void {
    const entryMatches = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g);
    if (entryMatches && entryMatches.length > 0) {
      const entriesToLog = entryMatches.slice(0, 3);
      logWithTimestamp(`[YOUTUBE_MONITOR] RSS entries found: ${entryMatches.length}, showing first ${entriesToLog.length}:`);

      entriesToLog.forEach((entry, index) => {
        const parsedEntry = this.parseRSSEntry(entry);
        if (parsedEntry) {
          logWithTimestamp(`[YOUTUBE_MONITOR] Entry ${index + 1}: ${parsedEntry.title} (${parsedEntry.videoId}) - ${parsedEntry.publishedAt}`);
        }
      });
    }
  }

  private parseRSSEntry(entryXml: string): RSSEntry | null {
    const entryContent = entryXml.replace(/<entry>|<\/entry>/g, "");

    const videoIdMatch = entryContent.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
    const titleMatch = entryContent.match(/<title>(.*?)<\/title>/);
    const publishedMatch = entryContent.match(/<published>(.*?)<\/published>/);
    const linkMatch = entryContent.match(/<link\s+rel="alternate"\s+href="([^"]*)"/);

    if (videoIdMatch && titleMatch && publishedMatch) {
      let title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, "$1");
      title = decodeYouTubeTitle(title);

      const videoId = videoIdMatch[1];
      const publishedAt = publishedMatch[1];
      const linkUrl = linkMatch ? linkMatch[1] : `https://www.youtube.com/watch?v=${videoId}`;

      return { videoId, title, publishedAt, linkUrl };
    }

    return null;
  }

  private isVideoSkippable(entry: RSSEntry): { skip: boolean; reason?: string } {
    // Check for shorts
    if (entry.linkUrl.includes("/shorts/")) {
      return { skip: true, reason: 'YouTube Shorts' };
    }

    return { skip: false };
  }

  private async fetchRSSContent(channelId: string): Promise<string> {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

    logWithTimestamp(`[YOUTUBE_MONITOR] Fetching RSS for channel: ${channelId}`);
    const response = await fetch(rssUrl);

    if (!response.ok) {
      throw new Error(`RSS fetch failed: ${response.status}`);
    }

    const xmlText = await response.text();
    logWithTimestamp(`[YOUTUBE_MONITOR] RSS response length: ${xmlText.length} characters`);

    return xmlText;
  }

  private async findLatestValidVideo(channelId: string): Promise<RSSVideo | null> {
    try {
      const xmlText = await this.fetchRSSContent(channelId);
      this.logRSSEntries(xmlText);

      const entryMatches = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g);
      if (!entryMatches || entryMatches.length === 0) {
        logWithTimestamp(`[YOUTUBE_MONITOR] No videos found in RSS feed for channel ${channelId}`);
        return null;
      }

      // Find first non-skippable video
      for (const entryMatch of entryMatches) {
        const parsedEntry = this.parseRSSEntry(entryMatch);
        if (!parsedEntry) continue;

        const skipCheck = this.isVideoSkippable(parsedEntry);
        if (skipCheck.skip) {
          logWithTimestamp(`[YOUTUBE_MONITOR] Skipping video: ${parsedEntry.title} (${parsedEntry.videoId}) - ${skipCheck.reason}`);
          continue;
        }

        // Note: Live stream check moved to channel processing level to match existing logic

        // Valid video found
        const channel = await storage.getYoutubeChannel(channelId);
        logWithTimestamp(`[YOUTUBE_MONITOR] Latest valid video from channel ${channelId}: ${parsedEntry.title} (${parsedEntry.videoId})`);

        return {
          videoId: parsedEntry.videoId,
          channelId,
          title: parsedEntry.title,
          publishedAt: new Date(parsedEntry.publishedAt),
          channelTitle: channel?.title || 'Unknown Channel',
          channelThumbnail: channel?.thumbnail || null,
        };
      }

      logWithTimestamp(`[YOUTUBE_MONITOR] No valid videos found in RSS feed for channel ${channelId}`);
      return null;

    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_MONITOR] Error fetching RSS for channel ${channelId}:`, error);

      // Handle 404 errors for channel deactivation
      if (error instanceof Error && error.message.includes('404')) {
        await storage.updateChannelActiveStatus(
          channelId,
          false,
          `RSS 피드 접근 불가 (404) - ${new Date().toISOString()}`
        );
      }

      return null;
    }
  }

  // ================================
  // Channel Processing Methods
  // ================================

  private async shouldProcessVideo(channel: YoutubeChannel, video: RSSVideo): Promise<boolean> {
    // Check if it's the same as recent video
    if (channel.recentVideoId === video.videoId) {
      logWithTimestamp(`[YOUTUBE_MONITOR] No new video for channel ${channel.title} (latest: ${video.videoId})`);
      return false;
    }

    // Check if video is already being processed
    const existingVideo = await storage.getVideo(video.videoId);
    if (existingVideo?.processingStatus === 'pending' ||
        existingVideo?.processingStatus === 'processing') {
      logWithTimestamp(`[YOUTUBE_MONITOR] Skipping ${video.videoId} - already ${existingVideo.processingStatus}`);
      return false;
    }

    return true;
  }

  private async saveNewVideo(video: RSSVideo): Promise<void> {
    const newVideo: InsertVideo = {
      videoId: video.videoId,
      channelId: video.channelId,
      title: video.title,
      publishedAt: video.publishedAt,
      channelTitle: video.channelTitle,
      channelThumbnail: video.channelThumbnail,
      processingStatus: 'pending',
      summary: null,
      transcript: null,
      processed: false,
    };

    await storage.createVideo(newVideo);
    await storage.updateChannelRecentVideo(video.channelId, video.videoId);

    logWithTimestamp(`[YOUTUBE_MONITOR] New video queued: ${video.title} (${video.videoId})`);
  }

  private async scanSingleChannel(channel: YoutubeChannel): Promise<RSSVideo | null> {
    try {
      logWithTimestamp(`[YOUTUBE_MONITOR] Scanning channel: ${channel.title} (${channel.channelId})`);

      const latestVideo = await this.findLatestValidVideo(channel.channelId);
      if (!latestVideo) {
        return null;
      }

      // Check if we should process this video
      const shouldProcess = await this.shouldProcessVideo(channel, latestVideo);
      if (!shouldProcess) {
        return null;
      }

      // Reactivate channel if it was inactive
      if (!channel.isActive) {
        logWithTimestamp(`[YOUTUBE_MONITOR] Reactivating channel: ${channel.title}`);
        await storage.updateChannelActiveStatus(channel.channelId, true, null);
      }

      // Check if it's a live stream before processing (matching existing logic)
      try {
        const isLiveStream = await youtubeApiUtils.isLiveStream(latestVideo.videoId);
        if (isLiveStream) {
          logWithTimestamp(`[YOUTUBE_MONITOR] Skipping live stream video: ${latestVideo.title} (${latestVideo.videoId})`);

          // Update recentVideoId to avoid processing this video again, but don't save to videos table
          await storage.updateChannelRecentVideo(channel.channelId, latestVideo.videoId);
          return null; // Don't add to summary queue
        }
      } catch (error) {
        errorWithTimestamp(`[YOUTUBE_MONITOR] Error checking live stream status for video ${latestVideo.videoId}:`, error);
        // Continue processing if live stream check fails to avoid blocking regular videos
      }

      // Save video to DB with pending status
      await this.saveNewVideo(latestVideo);

      logWithTimestamp(`[YOUTUBE_MONITOR] New video detected: ${latestVideo.title} from ${channel.title}`);
      return latestVideo;

    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_MONITOR] Error scanning channel ${channel.channelId}:`, error);

      // Handle RSS 404 errors
      if (error instanceof Error && error.message.includes('404')) {
        logWithTimestamp(`[YOUTUBE_MONITOR] RSS 404 error - deactivating channel: ${channel.title}`);
        await storage.updateChannelActiveStatus(
          channel.channelId,
          false,
          `RSS 피드 접근 불가 (404) - ${new Date().toISOString()}`
        );
      } else {
        await errorLogger.logError(error as Error, {
          service: "YouTubeMonitor",
          operation: "scanSingleChannel",
          channelId: channel.channelId,
          additionalInfo: { channelTitle: channel.title },
        });
      }

      return null;
    }
  }

  // ================================
  // Summary Processing Methods
  // ================================

  private async processVideoSummary(video: RSSVideo): Promise<void> {
    logWithTimestamp(`[YOUTUBE_MONITOR] Processing summary for: ${video.title} (${video.videoId})`);

    try {
      // Update status to processing
      await storage.updateVideoProcessingStatus(video.videoId, {
        processingStatus: 'processing',
        processingStartedAt: new Date()
      });

      // Process with timeout
      const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
      const result = await Promise.race([
        this.summaryService.processYouTubeUrl(videoUrl),
        this.createTimeoutPromise(this.SUMMARY_TIMEOUT)
      ]);

      // Success: update with results
      await storage.updateVideoProcessingStatus(video.videoId, {
        processingStatus: 'completed',
        processingCompletedAt: new Date(),
        summary: result.summary,
        transcript: result.transcript,
        processed: true
      });

      // Send push notifications
      await this.sendVideoNotification(video, result.summary);

      logWithTimestamp(`[YOUTUBE_MONITOR] ✅ Successfully processed: ${video.title}`);

    } catch (error) {
      await this.handleProcessingError(video, error);
    }
  }

  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PROCESSING_TIMEOUT')), timeoutMs)
    );
  }

  private async handleProcessingError(video: RSSVideo, error: any): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);

    logWithTimestamp(`[YOUTUBE_MONITOR] ❌ Processing failed for ${video.title}: ${errorMsg}`);

    if (errorMsg.includes('자막이 없거나') || errorMsg.includes('자막을 가져올 수 없습니다')) {
      // No subtitles - save basic info only (matching existing logic)
      logWithTimestamp(`[YOUTUBE_MONITOR] Video has no subtitles, saving basic info only: ${video.title}`);
      await storage.updateVideoProcessingStatus(video.videoId, {
        processingStatus: 'completed',
        processingCompletedAt: new Date(),
        errorMessage: '자막이 없는 영상',
        processed: true, // Mark as processed even without summary
        summary: null,
        transcript: null
      });
      // Note: No push notification sent for videos without subtitles
    } else if (errorMsg === 'PROCESSING_TIMEOUT') {
      // Timeout error
      await storage.updateVideoProcessingStatus(video.videoId, {
        processingStatus: 'failed',
        processingCompletedAt: new Date(),
        errorMessage: `처리 시간 초과 (${this.SUMMARY_TIMEOUT / 1000}초)`,
        processed: false
      });
    } else {
      // Other errors
      await storage.updateVideoProcessingStatus(video.videoId, {
        processingStatus: 'failed',
        processingCompletedAt: new Date(),
        errorMessage: `처리 실패: ${errorMsg}`,
        processed: false
      });

      // Log error for serious issues
      await errorLogger.logError(error as Error, {
        service: "YouTubeMonitor",
        operation: "processVideoSummary",
        additionalInfo: {
          videoId: video.videoId,
          videoTitle: video.title,
          channelTitle: video.channelTitle,
        },
      });
    }
  }

  private async sendVideoNotification(video: RSSVideo, summary: string): Promise<void> {
    try {
      logWithTimestamp(`[YOUTUBE_MONITOR] Sending push notifications for video: ${video.videoId}`);

      const notificationsSent = await pushNotificationService.sendNewVideoSummaryNotification(
        video.channelId,
        {
          videoId: video.videoId,
          title: video.title,
          channelName: video.channelTitle,
          summary: summary,
        }
      );

      logWithTimestamp(`[YOUTUBE_MONITOR] Sent push notifications to ${notificationsSent} users`);
    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_MONITOR] Error sending push notifications:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeMonitor",
        operation: "sendVideoNotification",
        additionalInfo: { videoId: video.videoId },
      });
    }
  }

  private async processSummaryBatch(videos: RSSVideo[]): Promise<void> {
    logWithTimestamp(`[YOUTUBE_MONITOR] Processing batch of ${videos.length} videos`);

    const results = await Promise.allSettled(
      videos.map(video => this.processVideoSummary(video))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logWithTimestamp(`[YOUTUBE_MONITOR] Batch completed: ${successful} success, ${failed} failed`);
  }

  private async processSummaryQueue(): Promise<void> {
    if (this.state.isProcessingSummaries) {
      logWithTimestamp('[YOUTUBE_MONITOR] Summary processing already in progress');
      return;
    }

    this.state.isProcessingSummaries = true;

    try {
      logWithTimestamp(`[YOUTUBE_MONITOR] Starting summary processing for ${this.state.summaryQueue.length} videos`);

      while (this.state.summaryQueue.length > 0) {
        // Process videos in batches
        const batch = this.state.summaryQueue.splice(0, this.CONCURRENT_LIMIT);
        await this.processSummaryBatch(batch);

        logWithTimestamp(`[YOUTUBE_MONITOR] ${this.state.summaryQueue.length} videos remaining in queue`);
      }

      logWithTimestamp('[YOUTUBE_MONITOR] All summaries processed');

    } finally {
      this.state.isProcessingSummaries = false;
    }
  }

  // ================================
  // Main Monitoring Methods
  // ================================

  public async monitorAllChannels(): Promise<void> {
    const startTime = Date.now();
    logWithTimestamp(`[YOUTUBE_MONITOR] Starting RSS scan cycle at ${new Date().toISOString()}`);

    try {
      // Phase 1: RSS Scan - collect new videos
      this.state.summaryQueue = []; // Reset queue
      const channels = await storage.getAllYoutubeChannels();

      logWithTimestamp(`[YOUTUBE_MONITOR] Scanning ${channels.length} channels for new videos`);

      for (const channel of channels) {
        const newVideo = await this.scanSingleChannel(channel);
        if (newVideo) {
          this.state.summaryQueue.push(newVideo);
        }
      }

      const scanTime = Date.now() - startTime;
      logWithTimestamp(`[YOUTUBE_MONITOR] RSS scan completed in ${scanTime}ms, found ${this.state.summaryQueue.length} new videos`);

      // Phase 2: Summary Processing (if any new videos found)
      if (this.state.summaryQueue.length > 0 && !this.state.isProcessingSummaries) {
        // Start processing asynchronously (don't await)
        this.processSummaryQueue().catch(error => {
          errorWithTimestamp('[YOUTUBE_MONITOR] Error in summary processing:', error);
        });
      }

    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_MONITOR] Error in monitoring cycle:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeMonitor",
        operation: "monitorAllChannels",
      });
    }

    logWithTimestamp(`[YOUTUBE_MONITOR] Monitoring cycle completed at ${new Date().toISOString()}`);
  }

  // ================================
  // Public API Methods
  // ================================

  /**
   * Get the latest video from a channel's RSS feed
   * Used by ChannelService when adding new channels
   */
  public async getLatestVideoFromChannel(channelId: string): Promise<RSSVideo | null> {
    logWithTimestamp(`[YOUTUBE_MONITOR] getLatestVideoFromChannel called for ${channelId}`);
    return this.findLatestValidVideo(channelId);
  }

  /**
   * Process a specific video (transcript extraction + AI summary)
   * Used by ChannelService when adding new channels
   */
  public async processVideo(channelId: string, video: RSSVideo): Promise<void> {
    logWithTimestamp(`[YOUTUBE_MONITOR] processVideo called for ${video.videoId}`);

    // Check if video already exists and is processed
    const existingVideo = await storage.getVideo(video.videoId);
    if (existingVideo) {
      // Video already exists in DB
      if (existingVideo.processingStatus === 'completed' || existingVideo.processed) {
        logWithTimestamp(`[YOUTUBE_MONITOR] Video ${video.videoId} already processed (status: ${existingVideo.processingStatus})`);
        return;
      }
      if (existingVideo.processingStatus === 'pending' || existingVideo.processingStatus === 'processing') {
        logWithTimestamp(`[YOUTUBE_MONITOR] Video ${video.videoId} already ${existingVideo.processingStatus}`);
        return;
      }
    }

    // Check if it's a live stream
    try {
      const isLiveStream = await youtubeApiUtils.isLiveStream(video.videoId);
      if (isLiveStream) {
        logWithTimestamp(`[YOUTUBE_MONITOR] Skipping live stream: ${video.title}`);
        await storage.updateChannelRecentVideo(channelId, video.videoId);
        return;
      }
    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_MONITOR] Error checking live stream status:`, error);
      // Continue processing if check fails
    }

    // Save video to DB (only if it doesn't exist)
    if (!existingVideo) {
      await this.saveNewVideo(video);
    }

    // Process summary immediately
    await this.processVideoSummary(video);
  }

  // ================================
  // Control Methods
  // ================================

  public startMonitoring(): void {
    if (this.state.monitorInterval) {
      logWithTimestamp(`[YOUTUBE_MONITOR] Monitoring already running`);
      return;
    }

    logWithTimestamp(`[YOUTUBE_MONITOR] Starting YouTube channel monitoring (${this.MONITORING_INTERVAL / 1000}s intervals)`);

    // Run immediately
    this.monitorAllChannels();

    // Schedule regular intervals
    this.state.monitorInterval = setInterval(
      () => {
        this.monitorAllChannels();
      },
      this.MONITORING_INTERVAL
    );
  }

  public stopMonitoring(): void {
    if (this.state.monitorInterval) {
      clearInterval(this.state.monitorInterval);
      this.state.monitorInterval = null;
      logWithTimestamp(`[YOUTUBE_MONITOR] YouTube channel monitoring stopped`);
    }
  }

  public isMonitoring(): boolean {
    return this.state.monitorInterval !== null;
  }

  public getStatus() {
    return {
      isMonitoring: this.isMonitoring(),
      isProcessingSummaries: this.state.isProcessingSummaries,
      queueLength: this.state.summaryQueue.length,
      concurrentLimit: this.CONCURRENT_LIMIT,
    };
  }
}