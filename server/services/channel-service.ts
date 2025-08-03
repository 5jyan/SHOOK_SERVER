import { storage } from "../repositories/storage";
import { validateYouTubeHandle } from "../utils/validation";
import { errorLogger } from "./error-logging-service";
import { YoutubeChannel } from "../../shared/schema"; // YoutubeChannel 타입 임포트

export class ChannelService {
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

  private validateHandle(handle: string) {
    const validation = validateYouTubeHandle(handle);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }
  }

  private async getExistingChannel(handle: string): Promise<YoutubeChannel | undefined> {
    return await storage.getYoutubeChannelByHandle(handle);
  }

  private async fetchAndSaveChannel(handle: string): Promise<string> {
    return await this.fetchChannelFromYouTube(handle);
  }

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
  async addChannel(userId: number, handle: string) {
    console.log(`[CHANNEL_SERVICE] Adding channel ${handle} for user ${userId}`);

    try {
      this.validateHandle(handle);

      let youtubeChannel = await this.getExistingChannel(handle);
      let channelId: string;

      if (youtubeChannel) {
        console.log(`[CHANNEL_SERVICE] Found existing channel:`, youtubeChannel);
        channelId = youtubeChannel.channelId;
      } else {
        channelId = await this.fetchAndSaveChannel(handle);
      }

      await this.checkUserSubscription(userId, channelId);

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
        additionalInfo: { handle }
      });
      throw error;
    }
  }

  async deleteChannel(userId: number, channelId: string) {
    console.log(`[CHANNEL_SERVICE] Deleting channel ${channelId} for user ${userId}`);
    try {
      await storage.unsubscribeUserFromChannel(userId, channelId);
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

  private async fetchChannelFromYouTube(handle: string): Promise<string> {
    try {
      const channelHandle = handle.substring(1); // Remove @ from handle
      const apiKey = process.env.YOUTUBE_API_KEY;

      if (!apiKey) {
        throw new Error("YouTube API 키가 설정되지 않았습니다");
      }

      const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${channelHandle}&key=${apiKey}`;
      console.log(`[CHANNEL_SERVICE] Calling YouTube API for handle: ${channelHandle}`);

      const response = await fetch(youtubeApiUrl);
      if (!response.ok) {
        throw new Error(`YouTube API 호출 실패: ${response.status}`);
      }

      const data = await response.json();
      if (!data.items || data.items.length === 0) {
        throw new Error("채널을 찾을 수 없습니다. 핸들러를 확인해주세요.");
      }

      const channelData = data.items[0];
      const channelInfo: YoutubeChannel = { // 타입 명시
        channelId: channelData.id,
        handle: handle,
        title: channelData.snippet.title,
        description: channelData.snippet.description || "",
        thumbnail: channelData.snippet.thumbnails?.default?.url || "",
        subscriberCount: channelData.statistics.subscriberCount || "0",
        videoCount: channelData.statistics.videoCount || "0",
      };

      // Save to database
      await storage.createOrUpdateYoutubeChannel(channelInfo);
      console.log(`[CHANNEL_SERVICE] Created new YouTube channel:`, channelInfo);

      return channelData.id;
    }
    catch (error) {
      await errorLogger.logError(error as Error, {
        service: 'ChannelService',
        operation: 'fetchChannelFromYouTube',
        additionalInfo: { handle }
      });
      throw error;
    }
  }
}

