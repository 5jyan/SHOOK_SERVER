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
}

export class YouTubeMonitor {
  private summaryService: YouTubeSummaryService;
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.summaryService = new YouTubeSummaryService();
  }

  // RSS 피드에서 YouTube 영상 정보 파싱 (쇼츠 영상 제외, 가장 최신 일반 영상만 가져오기)
  private async fetchLatestVideoFromRSS(
    channelId: string,
  ): Promise<RSSVideo | null> {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

    try {
      logWithTimestamp(`[YOUTUBE_MONITOR] Fetching RSS for channel: ${channelId}`);
      const response = await fetch(rssUrl);

      if (!response.ok) {
        throw new Error(`RSS fetch failed: ${response.status}`);
      }

      const xmlText = await response.text();
      logWithTimestamp(
        `[YOUTUBE_MONITOR] RSS response length: ${xmlText.length} characters`,
      );

      // XML에서 모든 entry 찾기 (쇼츠가 아닌 첫 번째 영상을 찾기 위해)
      const entryMatches = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g);

      if (!entryMatches || entryMatches.length === 0) {
        logWithTimestamp(
          `[YOUTUBE_MONITOR] No videos found in RSS feed for channel ${channelId}`,
        );
        return null;
      }

      // 각 entry를 확인하여 쇼츠가 아닌 첫 번째 영상 찾기
      for (const entryMatch of entryMatches) {
        const entryXml = entryMatch.replace(/<entry>|<\/entry>/g, "");

        // 비디오 ID, 제목, 게시 날짜 추출
        const videoIdMatch = entryXml.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
        const titleMatch = entryXml.match(/<title>(.*?)<\/title>/);
        const publishedMatch = entryXml.match(/<published>(.*?)<\/published>/);

        if (videoIdMatch && titleMatch && publishedMatch) {
          const videoId = videoIdMatch[1];
          let title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, "$1");
          
          // Decode HTML entities in the title (YouTube RSS feeds contain encoded entities like &quot;)
          title = decodeYouTubeTitle(title);
          
          const publishedAt = new Date(publishedMatch[1]);

          // 쇼츠 영상인지 확인 - URL에 "shorts"가 포함되어 있는지 체크
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

          // RSS 피드에서 link 태그를 찾아 실제 URL 확인
          const linkMatch = entryXml.match(/<link\s+rel="alternate"\s+href="([^"]*)"/);
          let actualUrl = videoUrl; // 기본값

          if (linkMatch && linkMatch[1]) {
            actualUrl = linkMatch[1];
          }

          // URL에 "shorts"가 포함되어 있으면 쇼츠로 간주
          if (actualUrl.includes("/shorts/")) {
            logWithTimestamp(
              `[YOUTUBE_MONITOR] Skipping shorts video: ${title} (${videoId}) - URL contains 'shorts'`,
            );
            continue;
          }

          logWithTimestamp(
            `[YOUTUBE_MONITOR] Latest non-shorts video from channel ${channelId}: ${title} (${videoId})`,
          );

          return {
            videoId,
            channelId,
            title,
            publishedAt,
          };
        }
      }

      logWithTimestamp(
        `[YOUTUBE_MONITOR] No non-shorts videos found in RSS feed for channel ${channelId}`,
      );
      return null;
    } catch (error) {
      errorWithTimestamp(
        `[YOUTUBE_MONITOR] Error fetching RSS for channel ${channelId}:`,
        error,
      );
      return null;
    }
  }

  // --- Helper functions for processChannelVideo ---

  private async processChannelVideo(
    channel: YoutubeChannel,
    latestVideo: RSSVideo,
  ): Promise<void> {
    logWithTimestamp(
      `[YOUTUBE_MONITOR] Processing new video for channel ${channel.title}: ${latestVideo.title}`,
    );

    let transcript: string | null = null;
    let summary: string | null = null;
    let errorMessage: string | null = null;
    let processed = false;

    try {
      const videoUrl = `https://www.youtube.com/watch?v=${latestVideo.videoId}`;
      const result = await this.summaryService.processYouTubeUrl(videoUrl);
      
      transcript = result.transcript;
      summary = result.summary;
      processed = true;

      logWithTimestamp(`[YOUTUBE_MONITOR] Successfully processed video with transcript and summary`);
    } catch (error) {
      errorWithTimestamp(
        `[YOUTUBE_MONITOR] Error processing video ${latestVideo.videoId}:`,
        error,
      );

      // 자막 관련 에러인지 확인
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('자막이 없거나') || errorMsg.includes('자막을 가져올 수 없습니다')) {
        logWithTimestamp(`[YOUTUBE_MONITOR] Video has no subtitles, saving basic info only`);
        errorMessage = '자막이 없는 영상';
      } else {
        // 다른 에러의 경우 로깅
        errorMessage = `처리 실패: ${errorMsg}`;
        await errorLogger.logError(error as Error, {
          service: "YouTubeMonitor",
          operation: "processChannelVideo",
          channelId: channel.channelId,
          additionalInfo: {
            videoId: latestVideo.videoId,
            videoTitle: latestVideo.title,
            channelTitle: channel.title,
          },
        });
      }
    }

    // 자막 유무에 관계없이 항상 영상 정보 저장
    try {
      const newVideo: InsertVideo = {
        videoId: latestVideo.videoId,
        channelId: channel.channelId,
        title: latestVideo.title,
        publishedAt: latestVideo.publishedAt,
        summary,
        transcript,
        processed,
        errorMessage,
        // New fields with values
        channelTitle: channel.title,
        channelThumbnail: channel.thumbnail,
        processingStatus: processed ? 'completed' : (errorMessage ? 'failed' : 'pending'),
      };

      await storage.createVideo(newVideo);
      await storage.updateChannelRecentVideo(channel.channelId, latestVideo.videoId);

      logWithTimestamp(`[YOUTUBE_MONITOR] Video saved to database, recentVideoId updated`);

      // 요약이 성공한 경우에만 푸시 알림 전송
      if (processed && summary) {
        logWithTimestamp(`[YOUTUBE_MONITOR] Sending push notifications for channel ${channel.channelId}`);
        try {
          const pushNotificationsSent = await pushNotificationService.sendNewVideoSummaryNotification(
            channel.channelId, 
            {
              videoId: latestVideo.videoId,
              title: latestVideo.title,
              channelName: channel.title,
              summary: summary,
            }
          );
          logWithTimestamp(`[YOUTUBE_MONITOR] Sent push notifications to ${pushNotificationsSent} users`);
        } catch (error) {
          errorWithTimestamp(`[YOUTUBE_MONITOR] Error sending push notifications:`, error);
          await errorLogger.logError(error as Error, {
            service: "YouTubeMonitor",
            operation: "sendPushNotifications",
            channelId: channel.channelId,
            additionalInfo: {
              videoId: latestVideo.videoId,
            },
          });
        }
      } else {
        logWithTimestamp(`[YOUTUBE_MONITOR] Skipping push notifications (no summary available)`);
      }

    } catch (dbError) {
      errorWithTimestamp(`[YOUTUBE_MONITOR] Error saving video to database:`, dbError);
      await errorLogger.logError(dbError as Error, {
        service: "YouTubeMonitor",
        operation: "saveVideoToDatabase",
        channelId: channel.channelId,
        additionalInfo: {
          videoId: latestVideo.videoId,
          videoTitle: latestVideo.title,
        },
      });
    }
  }

  // 모든 구독 채널 모니터링
  public async monitorAllChannels(): Promise<void> {
    logWithTimestamp(
      `[YOUTUBE_MONITOR] monitorAllChannels at ${new Date().toISOString()}`,
    );

    try {
      // 모든 YouTube 채널 가져오기
      logWithTimestamp(`[YOUTUBE_MONITOR] monitorAllChannels - fetching all channels`);
      const channels = await storage.getAllYoutubeChannels();
      logWithTimestamp(`[YOUTUBE_MONITOR] Monitoring ${channels.length} channels`);

      for (const channel of channels) {
        try {
          // RSS에서 최신 영상 가져오기
          const latestVideo = await this.fetchLatestVideoFromRSS(
            channel.channelId,
          );

          if (!latestVideo) {
            logWithTimestamp(
              `[YOUTUBE_MONITOR] No videos found for channel: ${channel.title}`,
            );
            continue;
          }

          // RSS 성공 시 채널 활성화 상태 복구
          if (!channel.isActive) {
            logWithTimestamp(`[YOUTUBE_MONITOR] Reactivating channel: ${channel.title}`);
            await storage.updateChannelActiveStatus(channel.channelId, true, null);
          }

          // 현재 저장된 영상 ID와 비교
          if (channel.recentVideoId === latestVideo.videoId) {
            logWithTimestamp(
              `[YOUTUBE_MONITOR] No new video for channel ${channel.title} (latest: ${latestVideo.videoId})`,
            );
            continue;
          }

          logWithTimestamp(
            `[YOUTUBE_MONITOR] New video detected for channel ${channel.title}: ${latestVideo.title} (${latestVideo.videoId})`,
          );

          // Check if the video is a live stream before processing
          try {
            const isLiveStream = await youtubeApiUtils.isLiveStream(latestVideo.videoId);
            if (isLiveStream) {
              logWithTimestamp(
                `[YOUTUBE_MONITOR] Skipping live stream video: ${latestVideo.title} (${latestVideo.videoId})`,
              );

              // Update the recentVideoId to avoid processing this video again, but don't save to videos table
              await storage.updateChannelRecentVideo(channel.channelId, latestVideo.videoId);
              continue;
            }
          } catch (error) {
            errorWithTimestamp(
              `[YOUTUBE_MONITOR] Error checking live stream status for video ${latestVideo.videoId}:`,
              error,
            );
            // Continue processing if live stream check fails to avoid blocking regular videos
          }

          // 새 영상 처리
          await this.processChannelVideo(channel, latestVideo);
        } catch (error) {
          errorWithTimestamp(
            `[YOUTUBE_MONITOR] Error monitoring channel ${channel.channelId}:`,
            error,
          );

          // RSS 404 오류 처리 - 채널 비활성화
          if (error instanceof Error && error.message.includes('404')) {
            logWithTimestamp(`[YOUTUBE_MONITOR] RSS 404 error - deactivating channel: ${channel.title}`);
            await storage.updateChannelActiveStatus(
              channel.channelId, 
              false, 
              `RSS 피드 접근 불가 (404) - ${new Date().toISOString()}`
            );
          } else {
            // 다른 에러들은 기존 방식대로 로깅
            await errorLogger.logError(error as Error, {
              service: "YouTubeMonitor",
              operation: "monitorChannel",
              channelId: channel.channelId,
              additionalInfo: { channelTitle: channel.title },
            });
          }
        }
      }
    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_MONITOR] Error in monitoring cycle:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeMonitor",
        operation: "monitorAllChannels",
      });
    }

    logWithTimestamp(
      `[YOUTUBE_MONITOR] Monitoring cycle completed at ${new Date().toISOString()}`,
    );
  }

  // 5분 간격 모니터링 시작
  public startMonitoring(): void {
    if (this.monitorInterval) {
      logWithTimestamp(`[YOUTUBE_MONITOR] Monitoring already running`);
      return;
    }

    logWithTimestamp(
      `[YOUTUBE_MONITOR] Starting YouTube channel monitoring (5-minute intervals)`,
    );

    // 즉시 첫 번째 실행
    this.monitorAllChannels();

    // 5분(300,000ms) 간격으로 실행
    this.monitorInterval = setInterval(
      () => {
        this.monitorAllChannels();
      },
      5 * 60 * 1000,
    );
  }

  // 모니터링 중지
  public stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      logWithTimestamp(`[YOUTUBE_MONITOR] YouTube channel monitoring stopped`);
    }
  }

  // 상태 확인
  public isMonitoring(): boolean {
    return this.monitorInterval !== null;
  }
}