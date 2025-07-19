import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";

export function registerRoutes(app: Express): Server {
  // sets up /api/register, /api/login, /api/logout, /api/user
  setupAuth(app);

  // YouTube Channel Management Routes
  app.get("/api/channels", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      console.log(`[CHANNELS] Getting channels for user ${req.user.id}`);
      const channels = await storage.getUserChannels(req.user.id);
      console.log(`[CHANNELS] Found ${channels.length} channels for user ${req.user.id}`);
      res.json(channels);
    } catch (error) {
      console.error("[CHANNELS] Error getting user channels:", error);
      res.status(500).json({ error: "Failed to get channels" });
    }
  });

  app.post("/api/channels", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      console.log(`[CHANNELS] Adding channel request from user ${req.user.id}:`, req.body);
      
      const { handle } = req.body;
      if (!handle || !handle.startsWith('@')) {
        console.log(`[CHANNELS] Invalid handle format: ${handle}`);
        return res.status(400).json({ error: "핸들러는 @로 시작해야 합니다" });
      }

      // 1. 먼저 YouTube 채널 테이블에서 handle로 검색
      console.log(`[CHANNELS] Checking if channel exists in database for handle: ${handle}`);
      let youtubeChannel = await storage.getYoutubeChannelByHandle(handle);
      let channelId: string;

      if (youtubeChannel) {
        // 기존 채널이 있는 경우
        console.log(`[CHANNELS] Found existing channel in database:`, youtubeChannel);
        channelId = youtubeChannel.channelId;
      } else {
        // 새로운 채널인 경우 YouTube API 호출
        const channelHandle = handle.substring(1); // Remove @ from handle for API call
        console.log(`[CHANNELS] Channel not found in database, calling YouTube API for handle: ${channelHandle}`);

        const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${channelHandle}&key=${process.env.YOUTUBE_API_KEY}`;
        console.log(`[CHANNELS] Making YouTube API request to: ${youtubeApiUrl}`);
        
        const response = await fetch(youtubeApiUrl);
        const data = await response.json();
        
        console.log(`[CHANNELS] YouTube API response status: ${response.status}`);
        console.log(`[CHANNELS] YouTube API response:`, JSON.stringify(data, null, 2));

        if (!response.ok) {
          console.error(`[CHANNELS] YouTube API error: ${response.status} - ${data.error?.message || 'Unknown error'}`);
          return res.status(400).json({ error: "YouTube API 요청이 실패했습니다" });
        }

        if (!data.items || data.items.length === 0) {
          console.log(`[CHANNELS] No channel found for handle: ${channelHandle}`);
          return res.status(404).json({ error: "채널 정보가 확인되지 않습니다" });
        }

        const channelData = data.items[0];
        console.log(`[CHANNELS] Found channel data from API:`, {
          id: channelData.id,
          title: channelData.snippet.title,
          subscriberCount: channelData.statistics.subscriberCount,
          videoCount: channelData.statistics.videoCount
        });

        channelId = channelData.id;

        // YouTube 채널 테이블에 새 채널 추가
        youtubeChannel = await storage.createOrUpdateYoutubeChannel({
          channelId: channelData.id,
          handle: handle,
          title: channelData.snippet.title,
          description: channelData.snippet.description || "",
          thumbnail: channelData.snippet.thumbnails?.default?.url || "",
          subscriberCount: channelData.statistics.subscriberCount || "0",
          videoCount: channelData.statistics.videoCount || "0"
        });
        console.log(`[CHANNELS] Created new channel in database:`, youtubeChannel);
      }

      // 2. 사용자가 이미 구독하고 있는지 확인
      const isSubscribed = await storage.isUserSubscribedToChannel(req.user.id, channelId);
      if (isSubscribed) {
        console.log(`[CHANNELS] User ${req.user.id} already subscribed to channel: ${channelId}`);
        return res.status(409).json({ error: "이미 추가된 채널입니다" });
      }

      // 3. user_channels 테이블에 매핑 추가
      const subscription = await storage.subscribeUserToChannel(req.user.id, channelId);
      console.log(`[CHANNELS] Successfully subscribed user ${req.user.id} to channel ${channelId}:`, {
        youtubeChannel,
        subscription
      });
      
      res.status(201).json({
        ...youtubeChannel,
        subscriptionId: subscription.id,
        subscribedAt: subscription.createdAt
      });

    } catch (error) {
      console.error("[CHANNELS] Error adding channel:", error);
      res.status(500).json({ error: "채널 추가 중 오류가 발생했습니다" });
    }
  });

  app.delete("/api/channels/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { channelId } = req.params;
      console.log(`[CHANNELS] Unsubscribing user ${req.user.id} from channel ${channelId}`);
      
      await storage.unsubscribeUserFromChannel(req.user.id, channelId);
      console.log(`[CHANNELS] Successfully unsubscribed user ${req.user.id} from channel ${channelId}`);
      
      res.status(200).json({ message: "Channel unsubscribed successfully" });
    } catch (error) {
      console.error("[CHANNELS] Error unsubscribing from channel:", error);
      res.status(500).json({ error: "Failed to unsubscribe from channel" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
