import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertChannelSchema } from "@shared/schema";

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

      // Remove @ from handle for API call
      const channelHandle = handle.substring(1);
      console.log(`[CHANNELS] Searching for YouTube channel with handle: ${channelHandle}`);

      // Call YouTube Data API
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
      console.log(`[CHANNELS] Found channel data:`, {
        id: channelData.id,
        title: channelData.snippet.title,
        subscriberCount: channelData.statistics.subscriberCount,
        videoCount: channelData.statistics.videoCount
      });

      // Check if channel already exists
      const existingChannel = await storage.getChannelByChannelId(channelData.id);
      if (existingChannel) {
        console.log(`[CHANNELS] Channel already exists: ${channelData.id}`);
        return res.status(409).json({ error: "이미 추가된 채널입니다" });
      }

      // Create channel record
      const newChannel = await storage.createChannel({
        userId: req.user.id,
        channelId: channelData.id,
        handle: handle,
        title: channelData.snippet.title,
        description: channelData.snippet.description || "",
        thumbnail: channelData.snippet.thumbnails?.default?.url || "",
        subscriberCount: channelData.statistics.subscriberCount || "0",
        videoCount: channelData.statistics.videoCount || "0"
      });

      console.log(`[CHANNELS] Successfully created channel record:`, newChannel);
      res.status(201).json(newChannel);

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
      console.log(`[CHANNELS] Deleting channel ${channelId} for user ${req.user.id}`);
      
      await storage.deleteChannel(channelId, req.user.id);
      console.log(`[CHANNELS] Successfully deleted channel ${channelId}`);
      
      res.status(200).json({ message: "Channel deleted successfully" });
    } catch (error) {
      console.error("[CHANNELS] Error deleting channel:", error);
      res.status(500).json({ error: "Failed to delete channel" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
