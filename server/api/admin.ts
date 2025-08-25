/**
 * Admin API endpoints for database maintenance and debugging
 */

import { Router } from "express";
import { isAuthenticated } from "../utils/auth-utils.js";
import { fixHtmlEntitiesInDatabase } from "../utils/fix-html-entities.js";
import { errorLogger } from "../services/error-logging-service.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

const router = Router();

// POST /api/admin/fix-html-entities - Fix HTML entities in existing database records
router.post("/fix-html-entities", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const username = req.user!.username;
  
  try {
    logWithTimestamp(`[ADMIN] fix-html-entities requested by user ${userId} (${username})`);
    
    // Run the cleanup script
    const result = await fixHtmlEntitiesInDatabase();
    
    logWithTimestamp(`[ADMIN] fix-html-entities completed successfully:`, result);
    
    res.json({
      success: true,
      message: "HTML entities fixed successfully",
      result
    });
    
  } catch (error) {
    errorWithTimestamp(`[ADMIN] Error in fix-html-entities:`, error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fix HTML entities",
      details: (error as Error).message 
    });
  }
});

// POST /api/admin/trigger-monitoring - Manually trigger YouTube monitoring
router.post("/trigger-monitoring", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const username = req.user!.username;
  
  try {
    logWithTimestamp(`[ADMIN] trigger-monitoring requested by user ${userId} (${username})`);
    
    // Import YouTube monitor service
    const { youtubeMonitor } = await import("../services/index.js");
    
    // Run monitoring once
    logWithTimestamp(`[ADMIN] Starting manual YouTube monitoring cycle...`);
    await youtubeMonitor.monitorAllChannels();
    logWithTimestamp(`[ADMIN] Manual YouTube monitoring cycle completed`);
    
    res.json({
      success: true,
      message: "YouTube monitoring completed successfully",
      timestamp: new Date().toISOString(),
      triggeredBy: { userId, username }
    });
    
  } catch (error) {
    errorWithTimestamp(`[ADMIN] Error in trigger-monitoring:`, error);
    await errorLogger.logError(error as Error, {
      service: 'AdminRoutes',
      operation: 'triggerMonitoring',
      userId,
      username
    });
    res.status(500).json({ 
      success: false,
      error: "Failed to trigger YouTube monitoring",
      details: (error as Error).message 
    });
  }
});

// GET /api/admin/monitoring-status - Get YouTube monitoring status
router.get("/monitoring-status", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const username = req.user!.username;
  
  try {
    logWithTimestamp(`[ADMIN] monitoring-status requested by user ${userId} (${username})`);
    
    // Import YouTube monitor service
    const { youtubeMonitor } = await import("../services/index.js");
    
    const isRunning = youtubeMonitor.isMonitoring();
    
    res.json({ 
      success: true, 
      data: {
        isRunning,
        intervalMinutes: 5,
        lastChecked: new Date().toISOString(),
        status: isRunning ? "running" : "stopped"
      },
      requestedBy: { userId, username }
    });
    
  } catch (error) {
    errorWithTimestamp(`[ADMIN] Error in monitoring-status:`, error);
    await errorLogger.logError(error as Error, {
      service: 'AdminRoutes',
      operation: 'getMonitoringStatus',
      userId,
      username
    });
    res.status(500).json({ 
      success: false,
      error: "Failed to get monitoring status",
      details: (error as Error).message 
    });
  }
});

// GET /api/admin/database-stats - Get database statistics
router.get("/database-stats", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const username = req.user!.username;
  
  try {
    logWithTimestamp(`[ADMIN] database-stats requested by user ${userId} (${username})`);
    
    // This could be expanded to show various database statistics
    const stats = {
      message: "Database statistics endpoint - implement as needed",
      timestamp: new Date().toISOString(),
      requestedBy: { userId, username }
    };
    
    res.json(stats);
    
  } catch (error) {
    errorWithTimestamp(`[ADMIN] Error in database-stats:`, error);
    res.status(500).json({ 
      error: "Failed to get database statistics" 
    });
  }
});

export default router;