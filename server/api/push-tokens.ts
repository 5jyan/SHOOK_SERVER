import { Router } from "express";
import { isAuthenticated } from "../utils/auth-utils.js";
import { storage } from "../repositories/storage.js";
import { errorLogger } from "../services/error-logging-service.js";
import { pushNotificationService } from "../services/push-notification-service.js";
import type { InsertPushToken } from "@shared/schema";

const router = Router();

// POST /api/push-tokens - Register or update push token
router.post("/", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const { token, deviceId, platform, appVersion } = req.body;
  
  try {
    console.log(`[PUSH-TOKENS] Registering push token for user ${userId}, device: ${deviceId}`);
    
    // Validate required fields
    if (!token || !deviceId || !platform || !appVersion) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: token, deviceId, platform, appVersion" 
      });
    }

    // Check if token already exists for this device
    const existingTokens = await storage.getPushTokensByUserId(userId);
    const existingToken = existingTokens.find(t => t.deviceId === deviceId);

    if (existingToken) {
      // Update existing token
      await storage.updatePushToken(deviceId, {
        token,
        platform,
        appVersion,
        isActive: true
      });
      console.log(`[PUSH-TOKENS] Updated existing push token for device: ${deviceId}`);
    } else {
      // Create new token
      const newPushToken: InsertPushToken = {
        userId,
        token,
        deviceId,
        platform,
        appVersion,
        isActive: true
      };
      
      await storage.createPushToken(newPushToken);
      console.log(`[PUSH-TOKENS] Created new push token for device: ${deviceId}`);
    }

    res.json({ 
      success: true, 
      message: existingToken ? "Push token updated successfully" : "Push token registered successfully" 
    });
    
  } catch (error) {
    console.error(`[PUSH-TOKENS] Error registering push token for user ${userId}:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'registerPushToken',
      userId,
      deviceId
    });
    res.status(500).json({ 
      success: false, 
      error: "Failed to register push token" 
    });
  }
});

// PUT /api/push-tokens/:deviceId - Update existing push token
router.put("/:deviceId", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const { deviceId } = req.params;
  const { token, platform, appVersion } = req.body;
  
  try {
    console.log(`[PUSH-TOKENS] Updating push token for user ${userId}, device: ${deviceId}`);
    
    // Validate that user owns this device token
    const existingTokens = await storage.getPushTokensByUserId(userId);
    const existingToken = existingTokens.find(t => t.deviceId === deviceId);
    
    if (!existingToken) {
      return res.status(404).json({ 
        success: false, 
        error: "Push token not found for this device" 
      });
    }

    // Update token
    await storage.updatePushToken(deviceId, {
      token,
      platform,
      appVersion,
      isActive: true
    });

    console.log(`[PUSH-TOKENS] Successfully updated push token for device: ${deviceId}`);
    res.json({ 
      success: true, 
      message: "Push token updated successfully" 
    });
    
  } catch (error) {
    console.error(`[PUSH-TOKENS] Error updating push token for user ${userId}:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'updatePushToken',
      userId,
      deviceId
    });
    res.status(500).json({ 
      success: false, 
      error: "Failed to update push token" 
    });
  }
});

// DELETE /api/push-tokens/:deviceId - Delete push token (logout/uninstall)
router.delete("/:deviceId", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const { deviceId } = req.params;
  
  try {
    console.log(`[PUSH-TOKENS] Deleting push token for user ${userId}, device: ${deviceId}`);
    
    // Validate that user owns this device token
    const existingTokens = await storage.getPushTokensByUserId(userId);
    const existingToken = existingTokens.find(t => t.deviceId === deviceId);
    
    if (!existingToken) {
      return res.status(404).json({ 
        success: false, 
        error: "Push token not found for this device" 
      });
    }

    // Delete token
    await storage.deletePushToken(deviceId);

    console.log(`[PUSH-TOKENS] Successfully deleted push token for device: ${deviceId}`);
    res.json({ 
      success: true, 
      message: "Push token deleted successfully" 
    });
    
  } catch (error) {
    console.error(`[PUSH-TOKENS] Error deleting push token for user ${userId}:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'deletePushToken',
      userId,
      deviceId
    });
    res.status(500).json({ 
      success: false, 
      error: "Failed to delete push token" 
    });
  }
});

// GET /api/push-tokens - Get user's push tokens (for debugging)
router.get("/", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  
  try {
    console.log(`[PUSH-TOKENS] Getting push tokens for user ${userId}`);
    
    const pushTokens = await storage.getPushTokensByUserId(userId);

    console.log(`[PUSH-TOKENS] Found ${pushTokens.length} push tokens for user ${userId}`);
    res.json({ 
      success: true, 
      data: pushTokens.map(token => ({
        id: token.id,
        deviceId: token.deviceId,
        platform: token.platform,
        appVersion: token.appVersion,
        isActive: token.isActive,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
        // Don't expose the actual token for security
        tokenPrefix: token.token.substring(0, 20) + '...'
      }))
    });
    
  } catch (error) {
    console.error(`[PUSH-TOKENS] Error getting push tokens for user ${userId}:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'getPushTokens',
      userId
    });
    res.status(500).json({ 
      success: false, 
      error: "Failed to get push tokens" 
    });
  }
});

// POST /api/push-tokens/test - Send test notification
router.post("/test", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  
  try {
    console.log(`[PUSH-TOKENS] Sending test notification to user ${userId}`);
    
    const success = await pushNotificationService.sendTestNotification(userId);
    
    if (success) {
      console.log(`[PUSH-TOKENS] Test notification sent successfully to user ${userId}`);
      res.json({ 
        success: true, 
        message: "Test notification sent successfully" 
      });
    } else {
      console.log(`[PUSH-TOKENS] Failed to send test notification to user ${userId}`);
      res.status(400).json({ 
        success: false, 
        error: "No active push tokens found or notification failed" 
      });
    }
    
  } catch (error) {
    console.error(`[PUSH-TOKENS] Error sending test notification to user ${userId}:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'sendTestNotification',
      userId
    });
    res.status(500).json({ 
      success: false, 
      error: "Failed to send test notification" 
    });
  }
});

export default router;