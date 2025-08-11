import { Router } from "express";
import channelRoutes from "./channels.js";
import googleRoutes from "./google.js";
import summaryRoutes from "./summary.js";
import videoRoutes from "./videos.js";
import userRoutes from "./user.js";
import pushTokenRoutes from "./push-tokens.js";
import adminRoutes from "./admin.js";
import { isAuthenticated, authorizeUser } from "../utils/auth-utils.js";
import { channelService } from "../services/index.js";
import { errorLogger } from "../services/error-logging-service.js";

import authRoutes from "./auth.js";

const router = Router();

console.log('✅ Main API router loaded');

router.use("/", authRoutes);

router.use("/channels", channelRoutes);
console.log('📋 Registering Google routes at /auth/google');
router.use("/auth/google", googleRoutes);
router.use("/summary", summaryRoutes);
router.use("/videos", videoRoutes);
router.use("/user", userRoutes);
router.use("/push-tokens", pushTokenRoutes);
router.use("/admin", adminRoutes);

// GET /api/channel-videos/:userId
router.get("/channel-videos/:userId", isAuthenticated, authorizeUser, async (req, res) => {
  try {
    const videos = await channelService.getChannelVideos(req.user!.id);
    res.json(videos);
  } catch (error) {
    console.error("[CHANNEL_VIDEOS] Error getting channel videos:", error);
    await errorLogger.logError(error as Error, {
      service: 'ChannelVideosRoute',
      operation: 'getChannelVideos',
      userId: req.user!.id
    });
    res.status(500).json({ error: "Failed to get channel videos" });
  }
});

export default router;