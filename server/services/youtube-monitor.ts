import { storage } from "../repositories/storage.js";
import { YouTubeSummaryService } from "./youtube-summary.js";
import { errorLogger } from "./error-logging-service.js";
import { pushNotificationService } from "./push-notification-service.js";
import { YoutubeChannel, Video, InsertVideo } from "../../shared/schema.js";
import { decodeYouTubeTitle } from "../utils/html-decode.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";
import { youtubeApiUtils, VideoType } from "../utils/youtube-api-utils.js";

interface RSSVideo {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: Date;
  channelTitle: string;
  channelThumbnail: string | null;
  videoType?: VideoType;
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

      // Find first valid video (skip shorts, skip upcoming)
      for (const entryMatch of entryMatches) {
        const parsedEntry = this.parseRSSEntry(entryMatch);
        if (!parsedEntry) continue;

        // Check if it's a short
        const skipCheck = this.isVideoSkippable(parsedEntry);
        if (skipCheck.skip) {
          logWithTimestamp(`[YOUTUBE_MONITOR] Skipping video: ${parsedEntry.title} (${parsedEntry.videoId}) - ${skipCheck.reason}`);
          continue;
        }

        // Check video type (live, upcoming, none)
        const videoType = await youtubeApiUtils.getVideoType(parsedEntry.videoId);

        // Skip upcoming videos
        if (videoType === 'upcoming') {
          logWithTimestamp(`[YOUTUBE_MONITOR] Skipping upcoming video: ${parsedEntry.title} (${parsedEntry.videoId})`);
          continue;
        }

        // Valid video found (not shorts, not upcoming)
        const channel = await storage.getYoutubeChannel(channelId);
        logWithTimestamp(`[YOUTUBE_MONITOR] Latest valid video from channel ${channelId}: ${parsedEntry.title} (${parsedEntry.videoId}) [${videoType}]`);

        return {
          videoId: parsedEntry.videoId,
          channelId,
          title: parsedEntry.title,
          publishedAt: new Date(parsedEntry.publishedAt),
          channelTitle: channel?.title || 'Unknown Channel',
          channelThumbnail: channel?.thumbnail || null,
          videoType,
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

  /**
   * Find up to maxCount latest valid videos from a channel's RSS feed
   * Used when adding new channels to get initial video batch
   */
  private async findLatestValidVideos(channelId: string, maxCount: number = 3): Promise<RSSVideo[]> {
    try {
      const xmlText = await this.fetchRSSContent(channelId);
      this.logRSSEntries(xmlText);

      const entryMatches = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g);
      if (!entryMatches || entryMatches.length === 0) {
        logWithTimestamp(`[YOUTUBE_MONITOR] No videos found in RSS feed for channel ${channelId}`);
        return [];
      }

      const validVideos: RSSVideo[] = [];
      const channel = await storage.getYoutubeChannel(channelId);

      // Find up to maxCount valid videos (skip shorts, skip upcoming)
      for (const entryMatch of entryMatches) {
        if (validVideos.length >= maxCount) {
          break; // Stop when we have enough videos
        }

        const parsedEntry = this.parseRSSEntry(entryMatch);
        if (!parsedEntry) continue;

        // Check if it's a short
        const skipCheck = this.isVideoSkippable(parsedEntry);
        if (skipCheck.skip) {
          logWithTimestamp(`[YOUTUBE_MONITOR] Skipping video: ${parsedEntry.title} (${parsedEntry.videoId}) - ${skipCheck.reason}`);
          continue;
        }

        // Check video type (live, upcoming, none)
        const videoType = await youtubeApiUtils.getVideoType(parsedEntry.videoId);

        // Skip upcoming videos
        if (videoType === 'upcoming') {
          logWithTimestamp(`[YOUTUBE_MONITOR] Skipping upcoming video: ${parsedEntry.title} (${parsedEntry.videoId})`);
          continue;
        }

        // Valid video found (not shorts, not upcoming)
        validVideos.push({
          videoId: parsedEntry.videoId,
          channelId,
          title: parsedEntry.title,
          publishedAt: new Date(parsedEntry.publishedAt),
          channelTitle: channel?.title || 'Unknown Channel',
          channelThumbnail: channel?.thumbnail || null,
          videoType,
        });

        logWithTimestamp(`[YOUTUBE_MONITOR] Found valid video ${validVideos.length}/${maxCount}: ${parsedEntry.title} (${parsedEntry.videoId}) [${videoType}]`);
      }

      logWithTimestamp(`[YOUTUBE_MONITOR] Found ${validVideos.length} valid videos from channel ${channelId}`);
      return validVideos;

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

      return [];
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

    // Check if video already exists in database (any status)
    const existingVideo = await storage.getVideo(video.videoId);
    if (existingVideo) {
      logWithTimestamp(`[YOUTUBE_MONITOR] Skipping ${video.videoId} - already exists (status: ${existingVideo.processingStatus})`);

      // Sync recentVideoId to prevent future mismatches
      if (channel.recentVideoId !== video.videoId) {
        await storage.updateChannelRecentVideo(video.channelId, video.videoId);
      }
      return false;
    }

    return true;
  }

  private async saveNewVideo(video: RSSVideo): Promise<void> {
    const newVideo = {
      videoId: video.videoId,
      channelId: video.channelId,
      title: video.title,
      publishedAt: video.publishedAt,
      channelTitle: video.channelTitle,
      channelThumbnail: video.channelThumbnail,
      processingStatus: video.videoType === 'live' ? 'pending' : 'pending', // live videos stay pending until they become 'none'
      summary: null,
      transcript: null,
      processed: false,
      videoType: video.videoType || 'none',
    } as InsertVideo;

    await storage.createVideo(newVideo);
    await storage.updateChannelRecentVideo(video.channelId, video.videoId);

    logWithTimestamp(`[YOUTUBE_MONITOR] New video saved: ${video.title} (${video.videoId}) [${video.videoType || 'none'}]`);
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

      // Save video to DB with pending status (live stream check already done in findLatestValidVideo)
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
    logWithTimestamp(`[YOUTUBE_MONITOR] Processing summary for: ${video.title} (${video.videoId}) [${video.videoType || 'none'}]`);

    // Skip live videos - they will be processed when they become 'none'
    if (video.videoType === 'live') {
      logWithTimestamp(`[YOUTUBE_MONITOR] Skipping live video: ${video.title} (${video.videoId})`);
      return;
    }

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

    // Get current retry count and increment
    const existingVideo = await storage.getVideo(video.videoId);
    const currentRetryCount = existingVideo?.retryCount || 0;
    const newRetryCount = currentRetryCount + 1;

    if (newRetryCount >= 3) {
      // Max retries reached - mark as processed and stop retrying
      logWithTimestamp(`[YOUTUBE_MONITOR] Max retries reached (${newRetryCount}/3) for ${video.title}, marking as processed`);
      await storage.updateVideoProcessingStatus(video.videoId, {
        processingStatus: 'failed',
        processingCompletedAt: new Date(),
        errorMessage: `처리 실패: ${errorMsg} (재시도 3회 완료)`,
        processed: true, // Stop retrying
        retryCount: newRetryCount,
        summary: null,
        transcript: null
      });
    } else {
      // Retry available - keep as pending for next cycle
      logWithTimestamp(`[YOUTUBE_MONITOR] Will retry for ${video.title} in next cycle (attempt ${newRetryCount + 1}/3)`);
      await storage.updateVideoProcessingStatus(video.videoId, {
        processingStatus: 'pending',
        processingCompletedAt: new Date(),
        errorMessage: `처리 실패: ${errorMsg} (재시도 ${newRetryCount}/3)`,
        processed: false, // Will be retried
        retryCount: newRetryCount,
        summary: null,
        transcript: null
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

      // Phase 1.5: Add pending videos for retry (processed=false with retryCount < 3)
      const pendingVideos = await storage.getPendingVideos(300); // Get all pending videos
      logWithTimestamp(`[YOUTUBE_MONITOR] Found ${pendingVideos.length} pending videos for retry`);

      for (const video of pendingVideos) {
        // Convert Video to RSSVideo format
        const rssVideo: RSSVideo = {
          videoId: video.videoId,
          channelId: video.channelId,
          title: video.title,
          publishedAt: video.publishedAt,
          channelTitle: video.channelTitle,
          channelThumbnail: video.channelThumbnail,
          videoType: video.videoType as VideoType | undefined,
        };
        this.state.summaryQueue.push(rssVideo);
      }

      // Phase 1.6: Check live videos to see if they've become 'none'
      const liveVideos = await storage.getLiveVideos(50); // Check up to 50 live videos
      logWithTimestamp(`[YOUTUBE_MONITOR] Found ${liveVideos.length} live videos to check status`);

      for (const video of liveVideos) {
        const currentType = await youtubeApiUtils.getVideoType(video.videoId);

        if (currentType === 'none') {
          // Live stream ended, update videoType and add to processing queue
          logWithTimestamp(`[YOUTUBE_MONITOR] Live stream ended for ${video.title} (${video.videoId}), adding to queue`);

          await storage.updateVideoProcessingStatus(video.videoId, {
            videoType: 'none',
          });

          const rssVideo: RSSVideo = {
            videoId: video.videoId,
            channelId: video.channelId,
            title: video.title,
            publishedAt: video.publishedAt,
            channelTitle: video.channelTitle,
            channelThumbnail: video.channelThumbnail,
            videoType: 'none',
          };
          this.state.summaryQueue.push(rssVideo);
        } else {
          logWithTimestamp(`[YOUTUBE_MONITOR] Live stream still ${currentType}: ${video.title} (${video.videoId})`);
        }
      }

      const liveEndedCount = liveVideos.filter(async v => await youtubeApiUtils.getVideoType(v.videoId) === 'none').length;
      logWithTimestamp(`[YOUTUBE_MONITOR] Total videos to process: ${this.state.summaryQueue.length} (new + retry + ${liveEndedCount} live ended)`);

      // Phase 2: Summary Processing (if any videos found)
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
   * Get up to maxCount latest videos from a channel's RSS feed
   * Used by ChannelService when adding new channels to get initial video batch
   */
  public async getLatestVideosFromChannel(channelId: string, maxCount: number = 3): Promise<RSSVideo[]> {
    logWithTimestamp(`[YOUTUBE_MONITOR] getLatestVideosFromChannel called for ${channelId} (maxCount: ${maxCount})`);
    return this.findLatestValidVideos(channelId, maxCount);
  }

  /**
   * Process a specific video (transcript extraction + AI summary)
   * Used by ChannelService when adding new channels
   */
  public async processVideo(channelId: string, video: RSSVideo): Promise<void> {
    logWithTimestamp(`[YOUTUBE_MONITOR] processVideo called for ${video.videoId}`);

    // Check if channel exists in DB (prevent foreign key constraint violation)
    const channel = await storage.getYoutubeChannel(channelId);
    if (!channel) {
      errorWithTimestamp(`[YOUTUBE_MONITOR] Channel ${channelId} not found in DB, cannot process video ${video.videoId}`);
      throw new Error(`Channel ${channelId} does not exist in database`);
    }

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

    // Save video to DB (only if it doesn't exist)
    if (!existingVideo) {
      await this.saveNewVideo(video);
    }

    // Skip live/upcoming videos - they will be processed later
    if (video.videoType === 'live') {
      logWithTimestamp(`[YOUTUBE_MONITOR] Skipping live video for now: ${video.title} (${video.videoId})`);
      return;
    }
    if (video.videoType === 'upcoming') {
      logWithTimestamp(`[YOUTUBE_MONITOR] Skipping upcoming video: ${video.title} (${video.videoId})`);
      return;
    }

    // Process summary immediately for 'none' type videos
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