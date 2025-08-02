import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { youtubeChannels, userChannels, users } from "../shared/schema.js";
import { YouTubeSummaryService } from "./youtube-summary.js";
import { SlackService } from "./slack.js";
import { errorLogger } from "./services/error-logging-service";

interface RSSVideo {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: Date;
}

export class YouTubeMonitor {
  private summaryService: YouTubeSummaryService;
  private slackService: SlackService;
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.summaryService = new YouTubeSummaryService();
    this.slackService = new SlackService();
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
          const title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, "$1");
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

  private async updateChannelVideoInfo(channel: any, latestVideo: RSSVideo) {
    await db
      .update(youtubeChannels)
      .set({
        recentVideoId: latestVideo.videoId,
        recentVideoTitle: latestVideo.title,
        videoPublishedAt: latestVideo.publishedAt,
        processed: false,
        errorMessage: null,
        caption: null,
      })
      .where(eq(youtubeChannels.channelId, channel.channelId));
    console.log(
      `[YOUTUBE_MONITOR] Updated channel ${channel.channelId} with new video info`,
    );
  }

  private async generateSummary(videoUrl: string) {
    console.log(
      `[YOUTUBE_MONITOR] Extracting transcript and generating summary for: ${videoUrl}`,
    );
    return await this.summaryService.processYouTubeUrl(videoUrl);
  }

  private async saveSummaryToChannel(channelId: string, summary: string) {
    await db
      .update(youtubeChannels)
      .set({
        caption: summary,
      })
      .where(eq(youtubeChannels.channelId, channelId));
    console.log(
      `[YOUTUBE_MONITOR] Generated and saved summary for video: ${channelId}`,
    );
  }

  private async findSubscribedUsers(channelId: string) {
    const subscribedUsers = await db
      .select({
        userId: users.id,
        slackChannelId: users.slackChannelId,
      })
      .from(userChannels)
      .innerJoin(users, eq(userChannels.userId, users.id))
      .where(eq(userChannels.channelId, channelId));
    console.log(
      `[YOUTUBE_MONITOR] Found ${subscribedUsers.length} subscribed users for channel ${channelId}`,
    );
    return subscribedUsers;
  }

  private formatSlackMessage(channelTitle: string, videoTitle: string, videoUrl: string, summary: string) {
    return {
      text: `새 영상: ${videoTitle}\n\n 요약:\n${summary}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${channelTitle}의 새 영상 알림*`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*제목:* ${videoTitle}\n*링크:* <${videoUrl}|YouTube에서 보기>`,
          },
        },
        {
          type: "divider",
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*요약:*\\n${summary}`,
          },
        },
      ],
    };
  }

  private async sendSlackNotification(
    userSlackChannelId: string,
    channelTitle: string,
    latestVideo: RSSVideo,
    summary: string,
  ) {
    const videoUrl = `https://www.youtube.com/watch?v=${latestVideo.videoId}`;
    const slackMessage = this.formatSlackMessage(
      channelTitle,
      latestVideo.title,
      videoUrl,
      summary,
    );
    await this.slackService.sendMessage({
      channel: userSlackChannelId,
      ...slackMessage,
    });
    console.log(
      `[YOUTUBE_MONITOR] Successfully sent summary to Slack channel ${userSlackChannelId}`,
    );
  }

  private async markChannelProcessed(channelId: string, error: Error | null = null) {
    await db
      .update(youtubeChannels)
      .set({
        processed: true,
        errorMessage: error ? error.message : null,
      })
      .where(eq(youtubeChannels.channelId, channelId));
    if (error) {
      console.error(`[YOUTUBE_MONITOR] Marked channel ${channelId} as processed with error: ${error.message}`);
    } else {
      console.log(`[YOUTUBE_MONITOR] Marked channel ${channelId} as processed`);
    }
  }

  // 채널의 최신 영상 정보 처리
  private async processChannelVideo(
    channel: any,
    latestVideo: RSSVideo,
  ): Promise<void> {
    console.log(
      `[YOUTUBE_MONITOR] Processing new video for channel ${channel.title}: ${latestVideo.title}`,
    );

    try {
      await this.updateChannelVideoInfo(channel, latestVideo);

      const videoUrl = `https://www.youtube.com/watch?v=${latestVideo.videoId}`;
      const { transcript, summary } = await this.generateSummary(videoUrl);

      await this.saveSummaryToChannel(channel.channelId, summary);

      const subscribedUsers = await this.findSubscribedUsers(channel.channelId);

      for (const user of subscribedUsers) {
        if (!user.slackChannelId) {
          console.log(
            `[YOUTUBE_MONITOR] User ${user.userId} has no Slack channel, skipping`,
          );
          continue;
        }

        try {
          await this.sendSlackNotification(
            user.slackChannelId,
            channel.title,
            latestVideo,
            summary,
          );
        } catch (error) {
          console.error(
            `[YOUTUBE_MONITOR] Error sending message to user ${user.userId}:`,
            error,
          );
          await errorLogger.logError(error as Error, {
            service: "YouTubeMonitor",
            operation: "sendSlackMessage",
            userId: user.userId,
            channelId: channel.channelId,
            additionalInfo: {
              videoId: latestVideo.videoId,
              slackChannelId: user.slackChannelId,
            },
          });
        }
      }

      await this.markChannelProcessed(channel.channelId);
      console.log(
        `[YOUTUBE_MONITOR] Successfully completed processing for video: ${latestVideo.videoId}`,
      );
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

      await this.markChannelProcessed(channel.channelId, error as Error);
    }
  }

  // 모든 구독 채널 모니터링
  public async monitorAllChannels(): Promise<void> {
    console.log(
      `[YOUTUBE_MONITOR] Starting channel monitoring cycle at ${new Date().toISOString()}`,
    );

    try {
      // 모든 YouTube 채널 가져오기
      const channels = await db.select().from(youtubeChannels);
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
          await errorLogger.logError(error as Error, {
            service: "YouTubeMonitor",
            operation: "monitorChannel",
            channelId: channel.channelId,
            additionalInfo: { channelTitle: channel.title },
          });
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