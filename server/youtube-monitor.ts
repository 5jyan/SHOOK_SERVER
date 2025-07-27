import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { youtubeChannels, userChannels, users } from "../shared/schema.js";
import { YouTubeSummaryService } from "./youtube-summary.js";
import { SlackService } from "./slack.js";

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

  // YouTube API를 사용하여 영상이 쇼츠인지 확인 (60초 이하면 쇼츠로 간주)
  private async checkIfVideoIsShorts(videoId: string): Promise<boolean> {
    try {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        console.log(`[YOUTUBE_MONITOR] YouTube API key not available, skipping shorts check for video: ${videoId}`);
        return false; // API 키가 없으면 쇼츠 체크를 건너뛰고 처리
      }

      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoId}&key=${apiKey}`;
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        console.log(`[YOUTUBE_MONITOR] YouTube API request failed for video ${videoId}: ${response.status}`);
        return false; // API 실패 시 쇼츠가 아닌 것으로 간주
      }

      const data = await response.json();
      
      if (data.items && data.items.length > 0) {
        const duration = data.items[0].contentDetails.duration; // ISO 8601 duration format (PT1M30S)
        
        // ISO 8601 duration을 초로 변환
        const durationInSeconds = this.parseDurationToSeconds(duration);
        
        // 60초 이하면 쇼츠로 간주
        const isShorts = durationInSeconds <= 60;
        
        if (isShorts) {
          console.log(`[YOUTUBE_MONITOR] Video ${videoId} is shorts (${durationInSeconds}s)`);
        } else {
          console.log(`[YOUTUBE_MONITOR] Video ${videoId} is regular video (${durationInSeconds}s)`);
        }
        
        return isShorts;
      }
      
      return false; // 비디오 정보를 찾을 수 없으면 쇼츠가 아닌 것으로 간주
    } catch (error) {
      console.error(`[YOUTUBE_MONITOR] Error checking if video ${videoId} is shorts:`, error);
      return false; // 에러 시 쇼츠가 아닌 것으로 간주
    }
  }

  // ISO 8601 duration (PT1M30S) 을 초로 변환
  private parseDurationToSeconds(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    
    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');
    
    return hours * 3600 + minutes * 60 + seconds;
  }

  // RSS 피드에서 YouTube 영상 정보 파싱 (쇼츠 영상 제외, 가장 최신 일반 영상만 가져오기)
  private async fetchLatestVideoFromRSS(channelId: string): Promise<RSSVideo | null> {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    
    try {
      console.log(`[YOUTUBE_MONITOR] Fetching RSS for channel: ${channelId}`);
      const response = await fetch(rssUrl);
      
      if (!response.ok) {
        throw new Error(`RSS fetch failed: ${response.status}`);
      }

      const xmlText = await response.text();
      console.log(`[YOUTUBE_MONITOR] RSS response length: ${xmlText.length} characters`);
      
      // XML에서 모든 entry 찾기 (쇼츠가 아닌 첫 번째 영상을 찾기 위해)
      const entryMatches = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g);
      
      if (!entryMatches || entryMatches.length === 0) {
        console.log(`[YOUTUBE_MONITOR] No videos found in RSS feed for channel ${channelId}`);
        return null;
      }

      // 각 entry를 확인하여 쇼츠가 아닌 첫 번째 영상 찾기
      for (const entryMatch of entryMatches) {
        const entryXml = entryMatch.replace(/<entry>|<\/entry>/g, '');
        
        // 비디오 ID, 제목, 게시 날짜 추출
        const videoIdMatch = entryXml.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
        const titleMatch = entryXml.match(/<title>(.*?)<\/title>/);
        const publishedMatch = entryXml.match(/<published>(.*?)<\/published>/);
        
        if (videoIdMatch && titleMatch && publishedMatch) {
          const videoId = videoIdMatch[1];
          const title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1');
          const publishedAt = new Date(publishedMatch[1]);
          
          // 쇼츠 영상인지 확인 - YouTube API를 사용하여 영상 길이 체크
          const isShorts = await this.checkIfVideoIsShorts(videoId);
          
          if (isShorts) {
            console.log(`[YOUTUBE_MONITOR] Skipping shorts video: ${title} (${videoId})`);
            continue;
          }
          
          console.log(`[YOUTUBE_MONITOR] Latest non-shorts video from channel ${channelId}: ${title} (${videoId})`);
          
          return {
            videoId,
            channelId,
            title,
            publishedAt
          };
        }
      }

      console.log(`[YOUTUBE_MONITOR] No non-shorts videos found in RSS feed for channel ${channelId}`);
      return null;
    } catch (error) {
      console.error(`[YOUTUBE_MONITOR] Error fetching RSS for channel ${channelId}:`, error);
      return null;
    }
  }

  // 채널의 최신 영상 정보 처리
  private async processChannelVideo(channel: any, latestVideo: RSSVideo): Promise<void> {
    console.log(`[YOUTUBE_MONITOR] Processing new video for channel ${channel.title}: ${latestVideo.title}`);
    
    try {
      // 1. 채널 정보 업데이트 (processed = false로 설정)
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

      console.log(`[YOUTUBE_MONITOR] Updated channel ${channel.channelId} with new video info`);

      // 2. 자막 추출 및 요약 생성
      const videoUrl = `https://www.youtube.com/watch?v=${latestVideo.videoId}`;
      console.log(`[YOUTUBE_MONITOR] Extracting transcript and generating summary for: ${videoUrl}`);
      
      const { transcript, summary } = await this.summaryService.processYouTubeUrl(videoUrl);
      
      // 3. 요약본을 caption 컬럼에 저장
      await db
        .update(youtubeChannels)
        .set({
          caption: summary,
        })
        .where(eq(youtubeChannels.channelId, channel.channelId));

      console.log(`[YOUTUBE_MONITOR] Generated and saved summary for video: ${latestVideo.videoId}`);

      // 4. 해당 채널을 구독한 모든 사용자 찾기
      const subscribedUsers = await db
        .select({
          userId: users.id,
          slackChannelId: users.slackChannelId,
        })
        .from(userChannels)
        .innerJoin(users, eq(userChannels.userId, users.id))
        .where(eq(userChannels.channelId, channel.channelId));

      console.log(`[YOUTUBE_MONITOR] Found ${subscribedUsers.length} subscribed users for channel ${channel.channelId}`);

      // 5. 각 사용자의 Slack 채널로 요약 전송
      for (const user of subscribedUsers) {
        if (!user.slackChannelId) {
          console.log(`[YOUTUBE_MONITOR] User ${user.userId} has no Slack channel, skipping`);
          continue;
        }

        try {
          console.log(`[YOUTUBE_MONITOR] Sending summary to user ${user.userId}, channel ${user.slackChannelId}`);
          
          const slackMessage = {
            channel: user.slackChannelId,
            text: `🎥 새 영상: ${latestVideo.title}\n\n📝 요약:\n${summary}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🎥 *새 영상 알림* - ${channel.title}`
                }
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn", 
                  text: `📹 *제목:* ${latestVideo.title}\n🔗 *링크:* <${videoUrl}|YouTube에서 보기>`
                }
              },
              {
                type: "divider"
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `📝 *요약:*\n${summary}`
                }
              }
            ]
          };

          await this.slackService.sendMessage(slackMessage);
          console.log(`[YOUTUBE_MONITOR] Successfully sent summary to user ${user.userId}`);
        } catch (error) {
          console.error(`[YOUTUBE_MONITOR] Error sending message to user ${user.userId}:`, error);
        }
      }

      // 6. 모든 처리 완료 후 processed = true로 설정
      await db
        .update(youtubeChannels)
        .set({
          processed: true,
        })
        .where(eq(youtubeChannels.channelId, channel.channelId));

      console.log(`[YOUTUBE_MONITOR] Successfully completed processing for video: ${latestVideo.videoId}`);

    } catch (error) {
      console.error(`[YOUTUBE_MONITOR] Error processing video ${latestVideo.videoId}:`, error);
      
      // 에러 발생 시 에러 메시지 저장하고 processed = true로 설정
      await db
        .update(youtubeChannels)
        .set({
          processed: true,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .where(eq(youtubeChannels.channelId, channel.channelId));
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
          // RSS에서 최신 영상 가져오기
          const latestVideo = await this.fetchLatestVideoFromRSS(channel.channelId);
          
          if (!latestVideo) {
            console.log(`[YOUTUBE_MONITOR] No videos found for channel: ${channel.title}`);
            continue;
          }

          // 현재 저장된 영상 ID와 비교
          if (channel.recentVideoId === latestVideo.videoId) {
            console.log(`[YOUTUBE_MONITOR] No new video for channel ${channel.title} (latest: ${latestVideo.videoId})`);
            continue;
          }

          console.log(`[YOUTUBE_MONITOR] New video detected for channel ${channel.title}: ${latestVideo.title} (${latestVideo.videoId})`);
          
          // 새 영상 처리
          await this.processChannelVideo(channel, latestVideo);

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