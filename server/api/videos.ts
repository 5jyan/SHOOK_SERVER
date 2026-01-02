import { Router } from "express";
import { isAuthenticated } from "../utils/auth-utils.js";
// import { channelService } from "../services/index.js";
import { storage } from "../repositories/storage.js";
import { errorLogger } from "../services/error-logging-service.js";
import { decodeVideoHtmlEntities } from "../utils/html-decode.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

const router = Router();

// GET /api/videos - Get all videos for authenticated user
router.get("/", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const username = req.user!.username;
  const forceSync = req.session.forceKakaoSync?.videos === true;
  
  // Check for incremental sync parameter (move to outer scope for error handling)
  const sinceParam = req.query.since as string;
  const since = forceSync ? null : sinceParam ? parseInt(sinceParam) : null;
  
  try {
    if (forceSync) {
      delete req.headers["if-none-match"];
      res.set("Cache-Control", "no-store");
      logWithTimestamp(`[VIDEOS] Forcing full sync after Kakao login for user ${userId}`);
    }

    logWithTimestamp(`[VIDEOS] Getting videos for user ${userId} (${username})`);
    
    // Get limit from query parameter (default: 50, max: 100)
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    
    if (since) {
      logWithTimestamp(`[VIDEOS] Incremental sync requested since ${new Date(since).toISOString()}`);
      logWithTimestamp(`[VIDEOS] Requesting up to ${limit} new videos`);
    } else {
      logWithTimestamp(`[VIDEOS] Full sync requested, limit: ${limit}`);
    }
    
    // Bypass service layer to avoid circular import issues
    const rawVideos = await storage.getVideosForUser(userId, limit, since || undefined);
    
    logWithTimestamp(`[VIDEOS] Successfully retrieved ${rawVideos.length} videos for user ${userId}`);
    
    if (since) {
      logWithTimestamp(`[VIDEOS] Incremental sync result: ${rawVideos.length} new videos since ${new Date(since).toISOString()}`);
    }
    
    // Decode HTML entities in titles and summaries
    const videos = decodeVideoHtmlEntities(rawVideos);
    
    // Log first video as sample (without full content to avoid spam)
    if (videos.length > 0) {
      const sampleVideo = videos[0];
      logWithTimestamp(`[VIDEOS] Sample video with channel:`, {
        videoId: sampleVideo.videoId,
        title: sampleVideo.title.substring(0, 50) + '...',
        channelTitle: sampleVideo.channelTitle,
        publishedAt: sampleVideo.publishedAt,
        processed: sampleVideo.processed,
        summaryLength: sampleVideo.summary?.length || 0
      });
    }
    
    res.json(videos);

    if (forceSync && req.session.forceKakaoSync) {
      req.session.forceKakaoSync.videos = false;
      if (!req.session.forceKakaoSync.channels) {
        delete req.session.forceKakaoSync;
      }
    }
  } catch (error) {
    errorWithTimestamp(`[VIDEOS] Error getting videos for user ${userId}:`, error);
    await errorLogger.logError(error as Error, {
      service: 'VideosRoute',
      operation: 'getVideos',
      userId,
      since: since || undefined
    });
    res.status(500).json({ error: "Failed to get videos." });
  }
});

// POST /api/videos/sample - Create sample data for testing (development only)
router.post("/sample", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  
  try {
    logWithTimestamp(`[VIDEOS] Creating sample data for user ${userId}`);
    
    // This is just for testing - in real app, videos are created by the monitoring system
    const sampleVideos = [
      {
        videoId: "dQw4w9WgXcQ",
        channelId: "UCuAXFkgsw1L7xaCfnd5JJOw", // Sample channel ID
        title: "리액트 네이티브 완전 정복하기 - 2024년 최신 가이드",
        publishedAt: new Date("2024-01-15T08:00:00Z"),
        summary: "리액트 네이티브의 최신 기능들과 함께 완전한 앱 개발 가이드를 제공합니다. Expo SDK 50의 새로운 기능들과 성능 최적화 방법에 대해 자세히 다룹니다.",
        transcript: "안녕하세요 여러분, 오늘은 리액트 네이티브에 대해 알아보겠습니다...",
        processed: true,
        errorMessage: null
      },
      {
        videoId: "abc123xyz",
        channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
        title: "TypeScript 고급 패턴과 실무 활용법",
        publishedAt: new Date("2024-01-14T12:00:00Z"),
        summary: "TypeScript의 고급 타입 시스템을 활용하여 더 안전하고 유지보수가 쉬운 코드를 작성하는 방법을 알아봅니다.",
        transcript: "TypeScript는 JavaScript의 상위집합으로...",
        processed: true,
        errorMessage: null
      }
    ];
    
    res.json({ 
      message: "Sample data creation endpoint - implement if needed for testing",
      sampleCount: sampleVideos.length 
    });
  } catch (error) {
    errorWithTimestamp(`[VIDEOS] Error creating sample data:`, error);
    await errorLogger.logError(error as Error, {
      service: 'VideosRoute',
      operation: 'createSampleData',
      userId
    });
    res.status(500).json({ error: "Failed to create sample data" });
  }
});

export default router;
