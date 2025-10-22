import { google, youtube_v3 } from 'googleapis';
import { storage } from "../repositories/storage";
import { validateYouTubeHandle } from "../utils/validation";
import { errorLogger } from "./error-logging-service";
import { YoutubeChannel } from "../../shared/schema"; // YoutubeChannel 타입 임포트
import { decodeYouTubeTitle, decodeHtmlEntities } from "../utils/html-decode.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

export class ChannelService {
  private youtube: youtube_v3.Youtube;

  constructor() {
    if (!process.env.YOUTUBE_API_KEY) {
      errorWithTimestamp("[CHANNEL_SERVICE] YOUTUBE_API_KEY is not set in environment variables.");
    } else {
      logWithTimestamp("[CHANNEL_SERVICE] YOUTUBE_API_KEY is loaded.");
    }
    this.youtube = google.youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY,
    });
  }

  async searchChannels(query: string, maxResults = 10) {
    logWithTimestamp(`[CHANNEL_SERVICE] Searching for channels with query: ${query}`);
    try {
      const searchParams = {
        part: ['snippet'],
        q: query,
        type: ['channel'],
        maxResults: Math.min(maxResults, 5),
      };
      logWithTimestamp("[CHANNEL_SERVICE] YouTube search.list request params:", searchParams);
      const searchResponse = await this.youtube.search.list(searchParams);
      logWithTimestamp("[CHANNEL_SERVICE] YouTube search.list raw response data:", JSON.stringify(searchResponse.data, null, 2));

      const searchItems = searchResponse.data.items;
      if (!searchItems || searchItems.length === 0) {
        logWithTimestamp("[CHANNEL_SERVICE] No search results found.");
        return [];
      }

      const channelIds = searchItems.map((item) => item.id!.channelId!);
      const channelsParams = {
        part: ['snippet', 'statistics'],
        id: channelIds,
      };
      logWithTimestamp("[CHANNEL_SERVICE] YouTube channels.list request params:", channelsParams);
      const channelsResponse = await this.youtube.channels.list(channelsParams);
      logWithTimestamp("[CHANNEL_SERVICE] YouTube channels.list raw response data:", JSON.stringify(channelsResponse.data, null, 2));

      const channelItems = channelsResponse.data.items;
      if (!channelItems) {
        logWithTimestamp("[CHANNEL_SERVICE] No detailed channel information found.");
        return [];
      }

      const channels = searchItems.map((searchItem) => {
        const channelDetail = channelItems.find(
          (channel) => channel.id === searchItem.id!.channelId!
        );
        return {
          channelId: searchItem.id!.channelId!,
          handle: channelDetail?.snippet?.customUrl || '',
          title: decodeYouTubeTitle(searchItem.snippet!.title!),
          description: decodeHtmlEntities(searchItem.snippet!.description || ''),
          thumbnail: searchItem.snippet!.thumbnails?.default?.url || '',
          subscriberCount: parseInt(channelDetail?.statistics?.subscriberCount || '0', 10),
          videoCount: parseInt(channelDetail?.statistics?.videoCount || '0', 10),
        };
      });

      logWithTimestamp("[CHANNEL_SERVICE] Formatted channels for frontend:", channels);
      return channels;
    } catch (error: any) {
      // Check if it's a quota exceeded error
      const errorMessage = error.message || '';
      const isQuotaError = errorMessage.includes('quota') || error.code === 403;

      if (isQuotaError) {
        errorWithTimestamp("[CHANNEL_SERVICE] YouTube API quota exceeded");
        const quotaError = new Error('채널 검색이 원활하지 않습니다.');
        await errorLogger.logError(quotaError, {
          service: 'ChannelService',
          operation: 'searchChannels',
          additionalInfo: { query, originalError: 'Quota exceeded' },
        });
        throw quotaError;
      }

      errorWithTimestamp("[CHANNEL_SERVICE] Error during channel search:", error);
      await errorLogger.logError(error as Error, {
        service: 'ChannelService',
        operation: 'searchChannels',
        additionalInfo: { query },
      });
      throw error;
    }
  }
  async getUserChannels(userId: number) {
    logWithTimestamp(`[CHANNEL_SERVICE] getUserChannels for user ${userId}`);
    try {
      return await storage.getUserChannels(userId);
    }
    catch (error) {
      await errorLogger.logError(error as Error, {
        service: 'ChannelService',
        operation: 'getUserChannels',
        userId
      });
      throw error;
    }
  }

  async getChannelVideos(userId: number) {
    logWithTimestamp(`[CHANNEL_SERVICE] getChannelVideos for user ${userId}`);
    try {
      return await storage.getVideosForUser(userId);
    }
    catch (error) {
      await errorLogger.logError(error as Error, {
        service: 'ChannelService',
        operation: 'getChannelVideos',
        userId
      });
      throw error;
    }
  }

  // --- Helper functions for addChannel ---

  private async checkUserSubscription(userId: number, channelId: string) {
    logWithTimestamp(`[CHANNEL_SERVICE] checkUserSubscription for user ${userId} and channel ${channelId}`);
    const isSubscribed = await storage.isUserSubscribedToChannel(userId, channelId);
    if (isSubscribed) {
      throw new Error("이미 추가된 채널입니다");
    }
  }

  private async checkChannelLimit(userId: number) {
    logWithTimestamp(`[CHANNEL_SERVICE] checkChannelLimit for user ${userId}`);
    const userChannels = await storage.getUserChannels(userId);
    const user = await storage.getUser(userId);
    const maxChannels = 5;

    // manager 역할 사용자는 채널 제한이 없음
    if (user?.role !== 'manager' && userChannels.length >= maxChannels) {
      throw new Error(`최대 ${maxChannels}개의 채널만 구독할 수 있습니다`);
    }
  }

  private async subscribeUser(userId: number, channelId: string) {
    logWithTimestamp(`[CHANNEL_SERVICE] subscribeUser for user ${userId} and channel ${channelId}`);
    const subscription = await storage.subscribeUserToChannel(userId, channelId);
    const channel = await storage.getYoutubeChannel(channelId);
    return { subscription, channel };
  }

  // --- Main addChannel method ---
  async addChannel(userId: number, channelId: string) {
    logWithTimestamp(`[CHANNEL_SERVICE] addChannel received channelId: ${channelId} for user ${userId}`);

    try {
      const channelInfo = await this.getChannelById(channelId);

      if (!channelInfo) {
        throw new Error("채널을 찾을 수 없습니다.");
      }

      await this.checkChannelLimit(userId);
      await this.checkUserSubscription(userId, channelId);

      // Check if this is a brand new channel (not in DB yet) BEFORE creating/updating
      const existingChannel = await storage.getYoutubeChannel(channelId);
      const isNewChannel = !existingChannel;

      logWithTimestamp(`[CHANNEL_SERVICE] Channel existence check: ${isNewChannel ? 'NEW CHANNEL' : 'EXISTING CHANNEL'}`);

      // Save to database if not already exists or update
      logWithTimestamp(`[CHANNEL_SERVICE] createOrUpdateYoutubeChannel for channel ${channelInfo.channelId}`);
      await storage.createOrUpdateYoutubeChannel(channelInfo);

      const { subscription, channel } = await this.subscribeUser(userId, channelId);

      // Scenario 1: Brand new channel - process latest 3 videos in background
      if (isNewChannel) {
        logWithTimestamp(`[CHANNEL_SERVICE] New channel detected, processing latest videos in background`);

        // Process videos asynchronously (don't await)
        this.processLatestVideosForChannel(channelId).catch(async (videoError) => {
          errorWithTimestamp(`[CHANNEL_SERVICE] Failed to process latest videos for channel ${channelId}:`, videoError);
          await errorLogger.logError(videoError as Error, {
            service: 'ChannelService',
            operation: 'addChannel.processLatestVideos',
            userId,
            channelId
          });
        });

        return {
          success: true,
          message: "채널이 성공적으로 추가되었습니다",
          channel,
          subscription,
          latestVideo: null // Videos processing in background
        };
      }

      // Scenario 2: Existing channel - return latest 3 videos from DB
      logWithTimestamp(`[CHANNEL_SERVICE] Existing channel, fetching latest videos from DB`);
      const existingVideos = await storage.getVideosByChannel(channelId, 3);

      if (existingVideos.length > 0) {
        logWithTimestamp(`[CHANNEL_SERVICE] Found ${existingVideos.length} latest videos`);
      } else {
        logWithTimestamp(`[CHANNEL_SERVICE] No videos found for existing channel`);
      }

      return {
        success: true,
        message: "채널이 성공적으로 추가되었습니다",
        channel,
        subscription,
        latestVideo: existingVideos.length > 0 ? existingVideos[0] : null // Return first video for backwards compatibility
      };
    }
    catch (error) {
      await errorLogger.logError(error as Error, {
        service: 'ChannelService',
        operation: 'addChannel',
        userId,
        additionalInfo: { channelId }
      });
      throw error;
    }
  }

  /**
   * Process the most recent videos from a channel (used when adding new channel)
   * Fetches and processes up to 3 latest videos
   */
  private async processLatestVideosForChannel(channelId: string): Promise<void> {
    logWithTimestamp(`[CHANNEL_SERVICE] processLatestVideosForChannel for ${channelId}`);

    // Import YouTube monitoring service dynamically to avoid circular dependency
    const { youtubeMonitor } = await import('./index.js');

    // Fetch latest 3 videos from RSS feed
    const latestVideos = await youtubeMonitor.getLatestVideosFromChannel(channelId, 3);

    if (!latestVideos || latestVideos.length === 0) {
      logWithTimestamp(`[CHANNEL_SERVICE] No videos found for channel ${channelId}`);
      return;
    }

    logWithTimestamp(`[CHANNEL_SERVICE] Found ${latestVideos.length} latest videos for channel ${channelId}`);

    // Process each video (get transcript, generate summary)
    for (const video of latestVideos) {
      logWithTimestamp(`[CHANNEL_SERVICE] Processing video: ${video.videoId} - ${video.title}`);
      await youtubeMonitor.processVideo(channelId, video);
    }
  }

  async deleteChannel(userId: number, channelId: string) {
    logWithTimestamp(`[CHANNEL_SERVICE] deleteChannel for user ${userId} and channel ${channelId}`);
    try {
      // First unsubscribe the user from the channel
      logWithTimestamp(`[CHANNEL_SERVICE] unsubscribeUserFromChannel for user ${userId} and channel ${channelId}`);
      await storage.unsubscribeUserFromChannel(userId, channelId);
      
      // Check if any users are still subscribed to this channel
      logWithTimestamp(`[CHANNEL_SERVICE] getChannelSubscriberCount for channel ${channelId}`);
      const subscriberCount = await storage.getChannelSubscriberCount(channelId);
      logWithTimestamp(`[CHANNEL_SERVICE] Channel ${channelId} has ${subscriberCount} remaining subscribers`);
      
      // If no users are connected to this channel, remove it from youtube_channels table
      if (subscriberCount === 0) {
        logWithTimestamp(`[CHANNEL_SERVICE] deleteYoutubeChannel for channel ${channelId}`);
        await storage.deleteYoutubeChannel(channelId);
      }
    }
    catch (error) {
      await errorLogger.logError(error as Error, {
        service: 'ChannelService',
        operation: 'deleteChannel',
        userId,
        channelId
      });
      throw error;
    }
  }

  async getChannelById(channelId: string) {
    logWithTimestamp("[CHANNEL_SERVICE] getChannelById called with channelId:", channelId);
    try {
      const response = await this.youtube.channels.list({
        part: ['snippet', 'statistics'],
        id: channelId
      });

      if (!response.data.items || response.data.items.length === 0) {
        return null;
      }

      const channel = response.data.items[0];
      return {
        channelId: channel.id!,
        handle: channel.snippet?.customUrl || '',
        title: decodeYouTubeTitle(channel.snippet!.title!),
        description: decodeHtmlEntities(channel.snippet!.description || ''),
        thumbnail: channel.snippet!.thumbnails?.default?.url || '',
        subscriberCount: parseInt(channel.statistics?.subscriberCount || '0', 10),
        videoCount: parseInt(channel.statistics?.videoCount || '0', 10),
      };

    } catch (error: any) {
      errorWithTimestamp('[CHANNEL_SERVICE] Full error object in getChannelById:', error);
      errorWithTimestamp('[CHANNEL_SERVICE] Error in getChannelById:', error.response?.data || error.message);
      throw new Error('Failed to get channel information');
    }
  }
}

