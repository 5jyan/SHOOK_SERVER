import { Router } from "express";
import channelRoutes from "./channels.js";
import summaryRoutes from "./summary.js";
import videoRoutes from "./videos.js";
import userRoutes from "./user.js";
import pushTokenRoutes from "./push-tokens.js";
import adminRoutes from "./admin.js";
import { isAuthenticated, authorizeUser } from "../utils/auth-utils.js";
import { channelService, youtubeMonitor } from "../services/index.js";
import { errorLogger } from "../services/error-logging-service.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";
import { storage } from "../repositories/storage.js";

import authRoutes from "./auth.js";

const router = Router();

logWithTimestamp('✅ Main API router loaded');

// GET /api/health - Public health check endpoint (no authentication required)
router.get("/health", async (req, res) => {
  const startTime = Date.now();

  try {
    // Quick DB connection test
    await storage.db.execute('SELECT 1');

    const responseTime = Date.now() - startTime;
    const monitorStatus = youtubeMonitor.getStatus();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      uptime: `${Math.floor(process.uptime())}s`,
      monitor: {
        isMonitoring: monitorStatus.isMonitoring,
        isProcessing: monitorStatus.isProcessingSummaries,
        queueLength: monitorStatus.queueLength,
      },
      memory: {
        used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      }
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    errorWithTimestamp("[HEALTH] Health check failed:", error);

    res.status(503).json({
      status: "unhealthy",
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
    });
  }
});

router.use("/", authRoutes);

router.use("/channels", channelRoutes);
router.use("/summary", summaryRoutes);
router.use("/videos", videoRoutes);
router.use("/user", userRoutes);
router.use("/push-tokens", pushTokenRoutes);
router.use("/push", pushTokenRoutes); // Also register under /push for /api/push/unregister
router.use("/admin", adminRoutes);

// GET /api/channel-videos/:userId
router.get("/channel-videos/:userId", isAuthenticated, authorizeUser, async (req, res) => {
  try {
    const videos = await channelService.getChannelVideos(req.user!.id);
    res.json(videos);
  } catch (error) {
    errorWithTimestamp("[CHANNEL_VIDEOS] Error getting channel videos:", error);
    await errorLogger.logError(error as Error, {
      service: 'ChannelVideosRoute',
      operation: 'getChannelVideos',
      userId: req.user!.id
    });
    res.status(500).json({ error: "Failed to get channel videos" });
  }
});

export default router;