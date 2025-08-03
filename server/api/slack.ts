import { Router } from "express";
import { slackService } from "../services/index.js";
import { isAuthenticated } from "../utils/auth-utils.js";
import { errorLogger } from "../services/error-logging-service.js";

const router = Router();

// Setup Slack integration
router.post("/setup", isAuthenticated, async (req, res) => {
  try {
    const { email } = req.body;
    const result = await slackService.setupSlackIntegration(req.user, email);
    res.json(result);
  } catch (error) {
    console.error("[SLACK_SETUP] Error setting up Slack:", error);
    await errorLogger.logError(error as Error, {
      service: 'SlackRoutes',
      operation: 'setupSlackIntegration',
      userId: req.user!.id,
      additionalInfo: { email: req.body.email }
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Slack 설정 중 오류가 발생했습니다." 
    });
  }
});

// Check Slack status
router.get("/status", isAuthenticated, async (req, res) => {
  try {
    const status = await slackService.getSlackStatus(req.user);
    res.json(status);
  } catch (error) {
    console.error("[SLACK_STATUS] Error getting Slack status:", error);
    await errorLogger.logError(error as Error, {
      service: 'SlackRoutes',
      operation: 'getSlackStatus',
      userId: req.user!.id
    });
    res.status(500).json({ error: "Failed to get Slack status" });
  }
});

export default router;
