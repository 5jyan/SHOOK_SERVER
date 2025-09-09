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
    } catch (error) {
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

      await this.checkUserSubscription(userId, channelId);

      // Save to database if not already exists or update
      logWithTimestamp(`[CHANNEL_SERVICE] createOrUpdateYoutubeChannel for channel ${channelInfo.channelId}`);
      await storage.createOrUpdateYoutubeChannel(channelInfo);

      const { subscription, channel } = await this.subscribeUser(userId, channelId);

      return {
        success: true,
        message: "채널이 성공적으로 추가되었습니다",
        channel,
        subscription
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

