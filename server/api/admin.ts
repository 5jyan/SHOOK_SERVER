/**
 * Admin API endpoints for database maintenance and debugging
 */

import { Router } from "express";
import { isAuthenticated } from "../utils/auth-utils.js";
import { fixHtmlEntitiesInDatabase } from "../utils/fix-html-entities.js";

const router = Router();

// POST /api/admin/fix-html-entities - Fix HTML entities in existing database records
router.post("/fix-html-entities", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const username = req.user!.username;
  
  try {
    console.log(`[ADMIN] fix-html-entities requested by user ${userId} (${username})`);
    
    // Run the cleanup script
    const result = await fixHtmlEntitiesInDatabase();
    
    console.log(`[ADMIN] fix-html-entities completed successfully:`, result);
    
    res.json({
      success: true,
      message: "HTML entities fixed successfully",
      result
    });
    
  } catch (error) {
    console.error(`[ADMIN] Error in fix-html-entities:`, error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fix HTML entities",
      details: (error as Error).message 
    });
  }
});

// GET /api/admin/database-stats - Get database statistics
router.get("/database-stats", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const username = req.user!.username;
  
  try {
    console.log(`[ADMIN] database-stats requested by user ${userId} (${username})`);
    
    // This could be expanded to show various database statistics
    const stats = {
      message: "Database statistics endpoint - implement as needed",
      timestamp: new Date().toISOString(),
      requestedBy: { userId, username }
    };
    
    res.json(stats);
    
  } catch (error) {
    console.error(`[ADMIN] Error in database-stats:`, error);
    res.status(500).json({ 
      error: "Failed to get database statistics" 
    });
  }
});

export default router;