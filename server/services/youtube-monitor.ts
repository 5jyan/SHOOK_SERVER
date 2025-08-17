import { storage } from "../repositories/storage.js";
import { YouTubeSummaryService } from "./youtube-summary.js";
import { errorLogger } from "./error-logging-service.js";
import { pushNotificationService } from "./push-notification-service.js";
import { YoutubeChannel, Video } from "../../shared/schema.js";
import { decodeYouTubeTitle } from "../utils/html-decode.js";

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
      console.log(`[YOUTUBE_MONITOR] Fetching RSS for channel: ${channelId}`);
      const response = await fetch(rssUrl);

      if (!response.ok) {
        throw new Error(`RSS fetch failed: ${response.status}`);
      }

      const xmlText = await response.text();
      console.log(
        `[YOUTUBE_MONITOR] RSS response length: ${xmlText.length} characters`,
      );

      // XML에서 모든 entry 찾기 (쇼츠가 아닌 첫 번째 영상을 찾기 위해)
      const entryMatches = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g);

      if (!entryMatches || entryMatches.length === 0) {
        console.log(
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
          const linkMatch = entryXml.match(/<link\s+href=\"([^\"]*)\"[^>]*>/);
          let actualUrl = videoUrl; // 기본값

          if (linkMatch && linkMatch[1]) {
            actualUrl = linkMatch[1];
          }

          // URL에 "shorts"가 포함되어 있으면 쇼츠로 간주
          if (actualUrl.includes("/shorts/")) {
            console.log(
              `[YOUTUBE_MONITOR] Skipping shorts video: ${title} (${videoId}) - URL contains 'shorts'`,
            );
            continue;
          }

          console.log(
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

      console.log(
        `[YOUTUBE_MONITOR] No non-shorts videos found in RSS feed for channel ${channelId}`,
      );
      return null;
    } catch (error) {
      console.error(
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
    console.log(
      `[YOUTUBE_MONITOR] Processing new video for channel ${channel.title}: ${latestVideo.title}`,
    );

    try {
      const videoUrl = `https://www.youtube.com/watch?v=${latestVideo.videoId}`;
      const { transcript, summary } = await this.summaryService.processYouTubeUrl(videoUrl);

      const newVideo: Omit<Video, 'createdAt'> = {
        videoId: latestVideo.videoId,
        channelId: channel.channelId,
        title: latestVideo.title,
        publishedAt: latestVideo.publishedAt,
        summary,
        transcript,
        processed: true,
        errorMessage: null,
      };

      await storage.createVideo(newVideo);
      await storage.updateChannelRecentVideo(channel.channelId, latestVideo.videoId);

      // Send push notifications to mobile users
      console.log(`[YOUTUBE_MONITOR] Sending push notifications for channel ${channel.channelId}`);
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
        console.log(`[YOUTUBE_MONITOR] Sent push notifications to ${pushNotificationsSent} users`);
      } catch (error) {
        console.error(`[YOUTUBE_MONITOR] Error sending push notifications:`, error);
        await errorLogger.logError(error as Error, {
          service: "YouTubeMonitor",
          operation: "sendPushNotifications",
          channelId: channel.channelId,
          additionalInfo: {
            videoId: latestVideo.videoId,
          },
        });
      }

    } catch (error) {
      console.error(
        `[YOUTUBE_MONITOR] Error processing video ${latestVideo.videoId}:`,
        error,
      );

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

  // 모든 구독 채널 모니터링
  public async monitorAllChannels(): Promise<void> {
    console.log(
      `[YOUTUBE_MONITOR] monitorAllChannels at ${new Date().toISOString()}`,
    );

    try {
      // 모든 YouTube 채널 가져오기
      console.log(`[YOUTUBE_MONITOR] monitorAllChannels - fetching all channels`);
      const channels = await storage.getAllYoutubeChannels();
      console.log(`[YOUTUBE_MONITOR] Monitoring ${channels.length} channels`);

      for (const channel of channels) {
        try {
          // RSS에서 최신 영상 가져오기
          const latestVideo = await this.fetchLatestVideoFromRSS(
            channel.channelId,
          );

          if (!latestVideo) {
            console.log(
              `[YOUTUBE_MONITOR] No videos found for channel: ${channel.title}`,
            );
            continue;
          }

          // RSS 성공 시 채널 활성화 상태 복구
          if (!channel.isActive) {
            console.log(`[YOUTUBE_MONITOR] Reactivating channel: ${channel.title}`);
            await storage.updateChannelActiveStatus(channel.channelId, true, null);
          }

          // 현재 저장된 영상 ID와 비교
          if (channel.recentVideoId === latestVideo.videoId) {
            console.log(
              `[YOUTUBE_MONITOR] No new video for channel ${channel.title} (latest: ${latestVideo.videoId})`,
            );
            continue;
          }

          console.log(
            `[YOUTUBE_MONITOR] New video detected for channel ${channel.title}: ${latestVideo.title} (${latestVideo.videoId})`,
          );

          // 새 영상 처리
          await this.processChannelVideo(channel, latestVideo);
        } catch (error) {
          console.error(
            `[YOUTUBE_MONITOR] Error monitoring channel ${channel.channelId}:`,
            error,
          );

          // RSS 404 오류 처리 - 채널 비활성화
          if (error instanceof Error && error.message.includes('404')) {
            console.log(`[YOUTUBE_MONITOR] RSS 404 error - deactivating channel: ${channel.title}`);
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
      console.error(`[YOUTUBE_MONITOR] Error in monitoring cycle:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeMonitor",
        operation: "monitorAllChannels",
      });
    }

    console.log(
      `[YOUTUBE_MONITOR] Monitoring cycle completed at ${new Date().toISOString()}`,
    );
  }

  // 5분 간격 모니터링 시작
  public startMonitoring(): void {
    if (this.monitorInterval) {
      console.log(`[YOUTUBE_MONITOR] Monitoring already running`);
      return;
    }

    console.log(
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
      console.log(`[YOUTUBE_MONITOR] YouTube channel monitoring stopped`);
    }
  }

  // 상태 확인
  public isMonitoring(): boolean {
    return this.monitorInterval !== null;
  }
}