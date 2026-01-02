import { Router } from "express";
import { channelService } from "../services/index.js";
import { isAuthenticated, authorizeUser } from "../utils/auth-utils.js";
import { errorLogger } from "../services/error-logging-service.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

const router = Router();

// Search for channels
router.get("/search", isAuthenticated, async (req, res) => {
  try {
    const { query } = req.query;
    if (typeof query !== 'string') {
      return res.status(400).json({ error: 'Query parameter must be a string.' });
    }
    const results = await channelService.searchChannels(query);
    res.json(results);
  } catch (error) {
    errorWithTimestamp("[CHANNELS] Error searching channels:", error);
    await errorLogger.logError(error as Error, {
      service: 'ChannelRoutes',
      operation: 'searchChannels',
      userId: req.user!.id,
      additionalInfo: { query: req.query.query }
    });
    res.status(500).json({ error: "Failed to search channels" });
  }
});

// Get user's channels
router.get("/:userId", isAuthenticated, authorizeUser, async (req, res) => {
  try {
    const forceSync = req.session.forceKakaoSync?.channels === true;
    if (forceSync) {
      delete req.headers["if-none-match"];
      res.set("Cache-Control", "no-store");
    }

    const channels = await channelService.getUserChannels(req.user!.id);
    res.json(channels);

    if (forceSync && req.session.forceKakaoSync) {
      req.session.forceKakaoSync.channels = false;
      if (!req.session.forceKakaoSync.videos) {
        delete req.session.forceKakaoSync;
      }
    }
  } catch (error) {
    errorWithTimestamp("[CHANNELS] Error getting user channels:", error);
    await errorLogger.logError(error as Error, {
      service: 'ChannelRoutes',
      operation: 'getUserChannels',
      userId: req.user!.id
    });
    res.status(500).json({ error: "Failed to get channels" });
  }
});

// Add new channel
router.post("/", isAuthenticated, async (req, res) => {
  try {
    const { channelId } = req.body;
    logWithTimestamp("[CHANNELS] Received channelId in POST request:", channelId);

    // 테스트용: test=true 쿼리 파라미터가 있으면 일부러 에러 발생
    if (req.query.test === 'true') {
      throw new Error('슬랙 에러 알림 테스트: 채널 추가 중 의도적인 에러 발생');
    }

    const result = await channelService.addChannel(req.user!.id, channelId);

    // Log the response being sent to client
    logWithTimestamp("[CHANNELS] Response data:", {
      success: result.success,
      hasLatestVideo: !!result.latestVideo,
      latestVideoId: result.latestVideo?.videoId,
      latestVideoProcessed: result.latestVideo?.processed,
      latestVideoHasSummary: !!result.latestVideo?.summary,
      latestVideoSummaryLength: result.latestVideo?.summary?.length || 0
    });

    res.json(result);
  } catch (error) {
    errorWithTimestamp("[CHANNELS] Error adding channel:", error);
    await errorLogger.logError(error as Error, {
      service: 'ChannelRoutes',
      operation: 'addChannel',
      userId: req.user!.id,
      additionalInfo: { channelId: req.body.channelId }
    });
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to add channel" });
  }
});

// Delete channel
router.delete("/:channelId", isAuthenticated, async (req, res) => {
  try {
    await channelService.deleteChannel(req.user!.id, req.params.channelId);
    res.json({ success: true });
  } catch (error) {
    errorWithTimestamp("[CHANNELS] Error deleting channel:", error);
    await errorLogger.logError(error as Error, {
      service: 'ChannelRoutes',
      operation: 'deleteChannel',
      userId: req.user!.id,
      channelId: req.params.channelId
    });
    res.status(500).json({ error: "Failed to delete channel" });
  }
});



export default router;
