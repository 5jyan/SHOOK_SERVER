import type { Express } from "express";
import { channelService } from "../services";
import { isAuthenticated, authorizeUser } from "../utils/auth-utils";
import { errorLogger } from "../services/error-logging-service";

export function setupChannelRoutes(app: Express) {
  // Get user's channels
  app.get("/api/channels/:userId", isAuthenticated, authorizeUser, async (req, res) => {
    try {
      const channels = await channelService.getUserChannels(req.user!.id);
      res.json(channels);
    } catch (error) {
      console.error("[CHANNELS] Error getting user channels:", error);
      await errorLogger.logError(error as Error, {
        service: 'ChannelRoutes',
        operation: 'getUserChannels',
        userId: req.user!.id
      });
      res.status(500).json({ error: "Failed to get channels" });
    }
  });

  // Add new channel
  app.post("/api/channels", isAuthenticated, async (req, res) => {
    try {
      const { handle } = req.body;
      const result = await channelService.addChannel(req.user!.id, handle);
      res.json(result);
    } catch (error) {
      console.error("[CHANNELS] Error adding channel:", error);
      await errorLogger.logError(error as Error, {
        service: 'ChannelRoutes',
        operation: 'addChannel',
        userId: req.user!.id,
        additionalInfo: { handle: req.body.handle }
      });
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to add channel" });
    }
  });

  // Delete channel
  app.delete("/api/channels/:channelId", isAuthenticated, async (req, res) => {
    try {
      await channelService.deleteChannel(req.user!.id, req.params.channelId);
      res.json({ success: true });
    } catch (error) {
      console.error("[CHANNELS] Error deleting channel:", error);
      await errorLogger.logError(error as Error, {
        service: 'ChannelRoutes',
        operation: 'deleteChannel',
        userId: req.user!.id,
        channelId: req.params.channelId
      });
      res.status(500).json({ error: "Failed to delete channel" });
    }
  });

  // Get channel videos
  app.get("/api/channel-videos/:userId", isAuthenticated, authorizeUser, async (req, res) => {
    try {
      const videos = await channelService.getChannelVideos(req.user!.id);
      res.json(videos);
    } catch (error) {
      console.error("[CHANNEL_VIDEOS] Error getting channel videos:", error);
      await errorLogger.logError(error as Error, {
        service: 'ChannelRoutes',
        operation: 'getChannelVideos',
        userId: req.user!.id
      });
      res.status(500).json({ error: "Failed to get channel videos" });
    }
  });
}