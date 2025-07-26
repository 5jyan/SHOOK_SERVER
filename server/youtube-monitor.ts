import { eq, notInArray, and } from "drizzle-orm";
import { db } from "./db.js";
import { youtubeChannels, userChannels, monitoredVideos, users } from "../shared/schema.js";
import { YouTubeSummaryService } from "./youtube-summary.js";

interface RSSVideo {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: Date;
  duration?: string;
}

export class YouTubeMonitor {
  private summaryService: YouTubeSummaryService;
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.summaryService = new YouTubeSummaryService();
  }

  // RSS 피드에서 YouTube 영상 정보 파싱
  private async fetchChannelRSS(channelId: string): Promise<RSSVideo[]> {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    
    try {
      console.log(`[YOUTUBE_MONITOR] Fetching RSS for channel: ${channelId}`);
      const response = await fetch(rssUrl);
      
      if (!response.ok) {
        throw new Error(`RSS fetch failed: ${response.status}`);
      }

      const xmlText = await response.text();
      console.log(`[YOUTUBE_MONITOR] RSS response length: ${xmlText.length} characters`);
      
      // XML 파싱 (간단한 regex 사용)
      const videos: RSSVideo[] = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match;

      while ((match = entryRegex.exec(xmlText)) !== null) {
        const entryXml = match[1];
        
        // 비디오 ID 추출
        const videoIdMatch = entryXml.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
        const titleMatch = entryXml.match(/<title>(.*?)<\/title>/);
        const publishedMatch = entryXml.match(/<published>(.*?)<\/published>/);
        
        if (videoIdMatch && titleMatch && publishedMatch) {
          const videoId = videoIdMatch[1];
          const title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1');
          const publishedAt = new Date(publishedMatch[1]);
          
          // 24시간 이내 영상만 처리
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          if (publishedAt > oneDayAgo) {
            videos.push({
              videoId,
              channelId,
              title,
              publishedAt
            });
          }
        }
      }

      console.log(`[YOUTUBE_MONITOR] Found ${videos.length} recent videos from channel ${channelId}`);
      return videos;
    } catch (error) {
      console.error(`[YOUTUBE_MONITOR] Error fetching RSS for channel ${channelId}:`, error);
      return [];
    }
  }

  // YouTube API를 통해 영상 길이 확인
  private async getVideoDuration(videoId: string): Promise<string | null> {
    try {
      // YouTube Data API가 없으므로 기본적으로 모든 영상을 처리
      // 실제 구현에서는 YouTube Data API를 사용하여 duration을 가져와야 함
      console.log(`[YOUTUBE_MONITOR] Getting duration for video: ${videoId}`);
      return null; // 일단 null로 반환하고 나중에 처리 중에 판단
    } catch (error) {
      console.error(`[YOUTUBE_MONITOR] Error getting duration for video ${videoId}:`, error);
      return null;
    }
  }

  // 영상 길이가 2분 이상인지 확인 (ISO 8601 duration format)
  private isDurationValid(duration: string | null): boolean {
    if (!duration) {
      // duration을 가져올 수 없는 경우 일단 처리해보도록 함
      return true;
    }

    // PT4M13S 형식에서 분과 초 추출
    const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return true;

    const minutes = parseInt(match[1] || '0', 10);
    const seconds = parseInt(match[2] || '0', 10);
    const totalSeconds = minutes * 60 + seconds;

    console.log(`[YOUTUBE_MONITOR] Video duration: ${minutes}:${seconds} (${totalSeconds}s)`);
    return totalSeconds >= 120; // 2분(120초) 이상
  }

  // 새로운 영상을 데이터베이스에 저장
  private async saveNewVideo(video: RSSVideo): Promise<void> {
    try {
      await db.insert(monitoredVideos).values({
        videoId: video.videoId,
        channelId: video.channelId,
        title: video.title,
        publishedAt: video.publishedAt,
        duration: video.duration || null,
        processed: false,
      });
      
      console.log(`[YOUTUBE_MONITOR] Saved new video: ${video.title} (${video.videoId})`);
    } catch (error) {
      console.error(`[YOUTUBE_MONITOR] Error saving video ${video.videoId}:`, error);
    }
  }

  // 영상 처리 (자막 추출, 요약, Slack 전송)
  private async processVideo(video: RSSVideo): Promise<void> {
    console.log(`[YOUTUBE_MONITOR] Processing video: ${video.title} (${video.videoId})`);
    
    try {
      const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
      
      // 해당 채널을 구독한 모든 사용자 찾기
      const subscribedUsers = await db
        .select({
          userId: users.id,
          slackChannelId: users.slackChannelId,
        })
        .from(userChannels)
        .innerJoin(users, eq(userChannels.userId, users.id))
        .where(eq(userChannels.channelId, video.channelId));

      console.log(`[YOUTUBE_MONITOR] Found ${subscribedUsers.length} subscribed users for channel ${video.channelId}`);

      // 각 사용자에게 요약 전송
      for (const user of subscribedUsers) {
        if (!user.slackChannelId) {
          console.log(`[YOUTUBE_MONITOR] User ${user.userId} has no Slack channel, skipping`);
          continue;
        }

        try {
          console.log(`[YOUTUBE_MONITOR] Processing for user ${user.userId}, channel ${user.slackChannelId}`);
          await this.summaryService.processYouTubeUrl(videoUrl, user.slackChannelId);
        } catch (error) {
          console.error(`[YOUTUBE_MONITOR] Error processing video for user ${user.userId}:`, error);
        }
      }

      // 처리 완료 표시
      await db
        .update(monitoredVideos)
        .set({
          processed: true,
          processedAt: new Date(),
        })
        .where(eq(monitoredVideos.videoId, video.videoId));

      console.log(`[YOUTUBE_MONITOR] Successfully processed video: ${video.videoId}`);
    } catch (error) {
      console.error(`[YOUTUBE_MONITOR] Error processing video ${video.videoId}:`, error);
      
      // 에러 메시지 저장
      await db
        .update(monitoredVideos)
        .set({
          processed: true,
          processedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .where(eq(monitoredVideos.videoId, video.videoId));
    }
  }

  // 모든 구독 채널 모니터링
  public async monitorAllChannels(): Promise<void> {
    console.log(`[YOUTUBE_MONITOR] Starting channel monitoring cycle at ${new Date().toISOString()}`);
    
    try {
      // 모든 YouTube 채널 가져오기
      const channels = await db.select().from(youtubeChannels);
      console.log(`[YOUTUBE_MONITOR] Monitoring ${channels.length} channels`);

      for (const channel of channels) {
        try {
          // RSS에서 새 영상 가져오기
          const rssVideos = await this.fetchChannelRSS(channel.channelId);
          
          if (rssVideos.length === 0) {
            console.log(`[YOUTUBE_MONITOR] No new videos found for channel: ${channel.title}`);
            continue;
          }

          // 이미 모니터링된 영상 제외
          const existingVideoIds = await db
            .select({ videoId: monitoredVideos.videoId })
            .from(monitoredVideos)
            .where(eq(monitoredVideos.channelId, channel.channelId));

          const existingIds = existingVideoIds.map(v => v.videoId);
          const newVideos = rssVideos.filter(v => !existingIds.includes(v.videoId));

          console.log(`[YOUTUBE_MONITOR] Found ${newVideos.length} new videos for channel: ${channel.title}`);

          // 새 영상 처리
          for (const video of newVideos) {
            // 영상 길이 확인
            const duration = await this.getVideoDuration(video.videoId);
            video.duration = duration || undefined;

            // 일단 모든 영상을 데이터베이스에 저장
            await this.saveNewVideo(video);

            // 2분 이상인 영상만 처리 (duration이 없으면 일단 처리)
            if (this.isDurationValid(duration)) {
              console.log(`[YOUTUBE_MONITOR] Video ${video.videoId} is valid for processing`);
              await this.processVideo(video);
            } else {
              console.log(`[YOUTUBE_MONITOR] Video ${video.videoId} is too short (shorts), skipping processing`);
              // 짧은 영상은 처리 완료로 표시
              await db
                .update(monitoredVideos)
                .set({
                  processed: true,
                  processedAt: new Date(),
                  errorMessage: "Video too short (shorts)",
                })
                .where(eq(monitoredVideos.videoId, video.videoId));
            }
          }
        } catch (error) {
          console.error(`[YOUTUBE_MONITOR] Error monitoring channel ${channel.channelId}:`, error);
        }
      }
    } catch (error) {
      console.error(`[YOUTUBE_MONITOR] Error in monitoring cycle:`, error);
    }
    
    console.log(`[YOUTUBE_MONITOR] Monitoring cycle completed at ${new Date().toISOString()}`);
  }

  // 5분 간격 모니터링 시작
  public startMonitoring(): void {
    if (this.monitorInterval) {
      console.log(`[YOUTUBE_MONITOR] Monitoring already running`);
      return;
    }

    console.log(`[YOUTUBE_MONITOR] Starting YouTube channel monitoring (5-minute intervals)`);
    
    // 즉시 첫 번째 실행
    this.monitorAllChannels();
    
    // 5분(300,000ms) 간격으로 실행
    this.monitorInterval = setInterval(() => {
      this.monitorAllChannels();
    }, 5 * 60 * 1000);
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