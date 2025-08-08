import { google, youtube_v3 } from 'googleapis';
import { storage } from "../repositories/storage";
import { validateYouTubeHandle } from "../utils/validation";
import { errorLogger } from "./error-logging-service";
import { YoutubeChannel } from "../../shared/schema"; // YoutubeChannel 타입 임포트

export class ChannelService {
  private youtube: youtube_v3.Youtube;

  constructor() {
    if (!process.env.YOUTUBE_API_KEY) {
      console.error("[CHANNEL_SERVICE] YOUTUBE_API_KEY is not set in environment variables.");
    } else {
      console.log("[CHANNEL_SERVICE] YOUTUBE_API_KEY is loaded.");
    }
    this.youtube = google.youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY,
    });
  }

  async searchChannels(query: string, maxResults = 10) {
    console.log(`[CHANNEL_SERVICE] Searching for channels with query: ${query}`);
    try {
      const searchParams = {
        part: ['snippet'],
        q: query,
        type: ['channel'],
        maxResults: Math.min(maxResults, 5),
      };
      console.log("[CHANNEL_SERVICE] YouTube search.list request params:", searchParams);
      const searchResponse = await this.youtube.search.list(searchParams);
      console.log("[CHANNEL_SERVICE] YouTube search.list raw response data:", JSON.stringify(searchResponse.data, null, 2));

      const searchItems = searchResponse.data.items;
      if (!searchItems || searchItems.length === 0) {
        console.log("[CHANNEL_SERVICE] No search results found.");
        return [];
      }

      const channelIds = searchItems.map((item) => item.id!.channelId!);
      const channelsParams = {
        part: ['snippet', 'statistics'],
        id: channelIds,
      };
      console.log("[CHANNEL_SERVICE] YouTube channels.list request params:", channelsParams);
      const channelsResponse = await this.youtube.channels.list(channelsParams);
      console.log("[CHANNEL_SERVICE] YouTube channels.list raw response data:", JSON.stringify(channelsResponse.data, null, 2));

      const channelItems = channelsResponse.data.items;
      if (!channelItems) {
        console.log("[CHANNEL_SERVICE] No detailed channel information found.");
        return [];
      }

      const channels = searchItems.map((searchItem) => {
        const channelDetail = channelItems.find(
          (channel) => channel.id === searchItem.id!.channelId!
        );
        return {
          channelId: searchItem.id!.channelId!,
          handle: channelDetail?.snippet?.customUrl || '',
          title: searchItem.snippet!.title!,
          description: searchItem.snippet!.description || '',
          thumbnail: searchItem.snippet!.thumbnails?.default?.url || '',
          subscriberCount: channelDetail?.statistics?.subscriberCount || '0',
          videoCount: channelDetail?.statistics?.videoCount || '0',
        };
      });

      console.log("[CHANNEL_SERVICE] Formatted channels for frontend:", channels);
      return channels;
    } catch (error) {
      console.error("[CHANNEL_SERVICE] Error during channel search:", error);
      await errorLogger.logError(error as Error, {
        service: 'ChannelService',
        operation: 'searchChannels',
        additionalInfo: { query },
      });
      throw error;
    }
  }
  async getUserChannels(userId: number) {
    console.log(`[CHANNEL_SERVICE] Getting channels for user ${userId}`);
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
    console.log(`[CHANNEL_SERVICE] Getting channel videos for user ${userId}`);
    try {
      return await storage.getChannelVideos(userId);
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
    const isSubscribed = await storage.isUserSubscribedToChannel(userId, channelId);
    if (isSubscribed) {
      throw new Error("이미 추가된 채널입니다");
    }
  }

  private async subscribeUser(userId: number, channelId: string) {
    const subscription = await storage.subscribeUserToChannel(userId, channelId);
    const channel = await storage.getYoutubeChannel(channelId);
    return { subscription, channel };
  }

  // --- Main addChannel method ---
  async addChannel(userId: number, channelId: string) {
    console.log(`[CHANNEL_SERVICE] addChannel received channelId: ${channelId} for user ${userId}`);

    try {
      const channelInfo = await this.getChannelById(channelId);

      if (!channelInfo) {
        throw new Error("채널을 찾을 수 없습니다.");
      }

      await this.checkUserSubscription(userId, channelId);

      // Save to database if not already exists or update
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
    console.log(`[CHANNEL_SERVICE] Deleting channel ${channelId} for user ${userId}`);
    try {
      // First unsubscribe the user from the channel
      await storage.unsubscribeUserFromChannel(userId, channelId);
      
      // Check if any users are still subscribed to this channel
      const subscriberCount = await storage.getChannelSubscriberCount(channelId);
      console.log(`[CHANNEL_SERVICE] Channel ${channelId} has ${subscriberCount} remaining subscribers`);
      
      // If no users are connected to this channel, remove it from youtube_channels table
      if (subscriberCount === 0) {
        console.log(`[CHANNEL_SERVICE] No users connected to channel ${channelId}, removing from youtube_channels table`);
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
    console.log("[CHANNEL_SERVICE] getChannelById called with channelId:", channelId);
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
        title: channel.snippet!.title!,
        description: channel.snippet!.description || '',
        thumbnail: channel.snippet!.thumbnails?.default?.url || '',
        subscriberCount: channel.statistics?.subscriberCount || '0',
        videoCount: channel.statistics?.videoCount || '0',
      };

    } catch (error: any) {
      console.error('[CHANNEL_SERVICE] Full error object in getChannelById:', error);
      console.error('[CHANNEL_SERVICE] Error in getChannelById:', error.response?.data || error.message);
      throw new Error('Failed to get channel information');
    }
  }
}

