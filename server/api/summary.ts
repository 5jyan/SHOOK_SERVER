import { Router } from "express";
import { summaryService } from "../services/index.js";
import { isAuthenticated } from "../utils/auth-utils.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

const router = Router();

// Generate summary for a YouTube URL
router.post("/generate", isAuthenticated, async (req, res) => {
  try {
    const { url } = req.body;
    const result = await summaryService.generateSummary(url);
    res.json(result);
  } catch (error) {
    errorWithTimestamp("[SUMMARY] Error generating summary:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "요약 생성 중 오류가 발생했습니다." 
    });
  }
});

// Get summary status
router.get("/status/:videoId", isAuthenticated, async (req, res) => {
  try {
    const status = await summaryService.getSummaryStatus(req.params.videoId);
    res.json(status);
  } catch (error) {
    errorWithTimestamp("[SUMMARY] Error getting summary status:", error);
    res.status(500).json({ error: "Failed to get summary status" });
  }
});

export default router;
