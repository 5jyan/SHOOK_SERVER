import { storage } from "../storage";
import { validateYouTubeHandle } from "../utils/validation";

class ChannelService {
  async getUserChannels(userId: number) {
    console.log(`[CHANNEL_SERVICE] Getting channels for user ${userId}`);
    return await storage.getUserChannels(userId);
  }

  async getChannelVideos(userId: number) {
    console.log(`[CHANNEL_SERVICE] Getting channel videos for user ${userId}`);
    return await storage.getChannelVideos(userId);
  }

  async addChannel(userId: number, handle: string) {
    console.log(`[CHANNEL_SERVICE] Adding channel ${handle} for user ${userId}`);
    
    // Validate handle
    const validation = validateYouTubeHandle(handle);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Check if channel already exists in database
    let youtubeChannel = await storage.getYoutubeChannelByHandle(handle);
    let channelId: string;

    if (youtubeChannel) {
      console.log(`[CHANNEL_SERVICE] Found existing channel:`, youtubeChannel);
      channelId = youtubeChannel.channelId;
    } else {
      // Fetch from YouTube API
      channelId = await this.fetchChannelFromYouTube(handle);
    }

    // Check if user is already subscribed
    const isSubscribed = await storage.isUserSubscribedToChannel(userId, channelId);
    if (isSubscribed) {
      throw new Error("이미 추가된 채널입니다");
    }

    // Add subscription
    const subscription = await storage.subscribeUserToChannel(userId, channelId);
    const channel = await storage.getYoutubeChannel(channelId);
    
    return {
      success: true,
      message: "채널이 성공적으로 추가되었습니다",
      channel,
      subscription
    };
  }

  async deleteChannel(userId: number, channelId: string) {
    console.log(`[CHANNEL_SERVICE] Deleting channel ${channelId} for user ${userId}`);
    await storage.unsubscribeUserFromChannel(userId, channelId);
  }

  private async fetchChannelFromYouTube(handle: string): Promise<string> {
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
    const channelInfo = {
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
}

export const channelService = new ChannelService();