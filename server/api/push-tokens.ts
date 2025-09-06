import { Router } from "express";
import { Expo } from "expo-server-sdk";
import { isAuthenticated } from "../utils/auth-utils.js";
import { storage } from "../repositories/storage.js";
import { errorLogger } from "../services/error-logging-service.js";
import { pushNotificationService } from "../services/push-notification-service.js";
import type { InsertPushToken } from "@shared/schema";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

const router = Router();

// Helper function to clean up duplicate tokens and return existing tokens
async function cleanupDuplicateTokens(userId: number, deviceId: string, newToken: string): Promise<any[]> {
  try {
    logWithTimestamp(`[PUSH-TOKENS] Cleaning up duplicate tokens for user ${userId}, device ${deviceId}`);
    
    const existingTokens = await storage.getPushTokensByUserId(userId);
    
    // Find tokens to remove:
    // 1. Same token but different device (user might have changed device ID)
    // 2. Same device but different token (old tokens for same device)
    // 3. Inactive tokens older than 30 days
    const tokensToRemove = existingTokens.filter(token => {
      // Skip the exact match (current token for current device)
      if (token.deviceId === deviceId && token.token === newToken) {
        return false;
      }
      
      // Remove if same token but different device
      if (token.token === newToken && token.deviceId !== deviceId) {
        logWithTimestamp(`[PUSH-TOKENS] Found duplicate token with different device: ${token.deviceId}`);
        return true;
      }
      
      // Remove old inactive tokens (older than 30 days)
      if (!token.isActive && token.updatedAt) {
        const daysSinceUpdate = (Date.now() - new Date(token.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate > 30) {
          logWithTimestamp(`[PUSH-TOKENS] Found old inactive token: ${token.deviceId} (${daysSinceUpdate.toFixed(1)} days old)`);
          return true;
        }
      }
      
      return false;
    });

    // Additionally, find any active tokens for the same deviceId but with a different token string
    const oldTokensForSameDevice = existingTokens.filter(token => 
      token.deviceId === deviceId && 
      token.token !== newToken && 
      token.isActive
    );

    for (const oldToken of oldTokensForSameDevice) {
      logWithTimestamp(`[PUSH-TOKENS] Marking old token for device ${oldToken.deviceId} as inactive: ${oldToken.token}`);
      await storage.markPushTokenAsInactive(oldToken.deviceId);
    }

    // Combine tokens to remove and old tokens to mark inactive
    const allTokensToProcess = [...tokensToRemove, ...oldTokensForSameDevice];
    
    // Remove duplicate/old tokens
    for (const tokenToRemove of tokensToRemove) {
      logWithTimestamp(`[PUSH-TOKENS] Removing duplicate/old token: ${tokenToRemove.deviceId}`);
      await storage.deletePushToken(tokenToRemove.deviceId);
    }
    
    if (allTokensToProcess.length > 0) {
      logWithTimestamp(`[PUSH-TOKENS] Processed ${allTokensToProcess.length} duplicate/old tokens for user ${userId}`);
    }
    
    return existingTokens;
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error cleaning up duplicate tokens:`, error);
    // Don't throw error - just log it, so the main token registration can continue
    // Return empty array on error so main function can continue
    return [];
  }
}

// POST /api/push-tokens - Register or update push token
router.post("/", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const { token, deviceId, platform, appVersion } = req.body;
  
  try {
    logWithTimestamp(`[PUSH-TOKENS] Registering push token for user ${userId}, device: ${deviceId}`);
    
    // Validate required fields
    if (!token || !deviceId || !platform || !appVersion) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: token, deviceId, platform, appVersion" 
      });
    }

    // Validate token format - reject fallback/dev tokens
    if (!Expo.isExpoPushToken(token) || 
        token.startsWith('ExponentPushToken[fallback-') || 
        token.startsWith('ExponentPushToken[dev-')) {
      logWithTimestamp(`[PUSH-TOKENS] Rejected invalid token for user ${userId}: ${token.substring(0, 30)}...`);
      return res.status(400).json({ 
        success: false, 
        error: "Invalid push token format. Please restart the app to generate a valid token." 
      });
    }

    // Clean up any duplicate or old tokens first and get existing tokens
    const existingTokens = await cleanupDuplicateTokens(userId, deviceId, token);
    const existingToken = existingTokens.find(t => t.deviceId === deviceId);

    if (existingToken) {
      // Update existing token
      await storage.updatePushToken(deviceId, {
        token,
        platform,
        appVersion,
        isActive: true
      });
      logWithTimestamp(`[PUSH-TOKENS] Updated existing push token for device: ${deviceId}`);
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
      logWithTimestamp(`[PUSH-TOKENS] Created new push token for device: ${deviceId}`);
    }

    res.json({ 
      success: true, 
      message: existingToken ? "Push token updated successfully" : "Push token registered successfully" 
    });
    
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error registering push token for user ${userId}:`, error);
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
    logWithTimestamp(`[PUSH-TOKENS] Updating push token for user ${userId}, device: ${deviceId}`);
    
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

    logWithTimestamp(`[PUSH-TOKENS] Successfully updated push token for device: ${deviceId}`);
    res.json({ 
      success: true, 
      message: "Push token updated successfully" 
    });
    
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error updating push token for user ${userId}:`, error);
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
    logWithTimestamp(`[PUSH-TOKENS] Deleting push token for user ${userId}, device: ${deviceId}`);
    
    // Get all tokens for better logging
    const allTokens = await storage.getPushTokensByUserId(userId);
    logWithTimestamp(`[PUSH-TOKENS] User ${userId} currently has ${allTokens.length} active tokens`);
    
    // Validate that user owns this device token
    const existingToken = allTokens.find(t => t.deviceId === deviceId);
    
    if (!existingToken) {
      logWithTimestamp(`[PUSH-TOKENS] Token not found for device ${deviceId}, considering as already deleted`);
      // Consider this success - token is already gone
      return res.json({ 
        success: true, 
        message: "Push token already deleted or not found" 
      });
    }

    // Delete the token directly (no need to mark inactive first)
    await storage.deletePushToken(deviceId);
    logWithTimestamp(`[PUSH-TOKENS] Successfully deleted push token for device: ${deviceId}`);
    
    // Log the change without additional DB query (use cached count)
    logWithTimestamp(`[PUSH-TOKENS] User ${userId} now has ${allTokens.length - 1} active tokens (was ${allTokens.length})`);

    res.json({ 
      success: true, 
      message: "Push token deleted successfully" 
    });
    
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error deleting push token for user ${userId}:`, error);
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
    logWithTimestamp(`[PUSH-TOKENS] Getting push tokens for user ${userId}`);
    
    const pushTokens = await storage.getPushTokensByUserId(userId);

    logWithTimestamp(`[PUSH-TOKENS] Found ${pushTokens.length} push tokens for user ${userId}`);
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
    errorWithTimestamp(`[PUSH-TOKENS] Error getting push tokens for user ${userId}:`, error);
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

// POST /api/push/unregister - Alternative unregister endpoint (more explicit)  
router.post("/unregister", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  const { deviceId } = req.body;
  
  try {
    logWithTimestamp(`[PUSH-TOKENS] Unregistering push token for user ${userId}, device: ${deviceId}`);
    
    if (!deviceId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required field: deviceId" 
      });
    }
    
    // Validate that user owns this device token
    const existingTokens = await storage.getPushTokensByUserId(userId);
    const existingToken = existingTokens.find(t => t.deviceId === deviceId);
    
    if (!existingToken) {
      // Even if token doesn't exist, consider it a success (idempotent operation)
      logWithTimestamp(`[PUSH-TOKENS] No push token found for device ${deviceId}, considering as already unregistered`);
      return res.json({ 
        success: true, 
        message: "Push token already unregistered or not found" 
      });
    }

    // Delete the token directly (no need to mark inactive first)
    await storage.deletePushToken(deviceId);
    logWithTimestamp(`[PUSH-TOKENS] Successfully deleted push token for device: ${deviceId}`);

    res.json({ 
      success: true, 
      message: "Push token unregistered successfully" 
    });
    
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error unregistering push token for user ${userId}:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'unregisterPushToken',
      userId,
      deviceId
    });
    res.status(500).json({ 
      success: false, 
      error: "Failed to unregister push token" 
    });
  }
});

// POST /api/push-tokens/test - Send test notification
router.post("/test", isAuthenticated, async (req, res) => {
  const userId = req.user!.id;
  
  try {
    logWithTimestamp(`[PUSH-TOKENS] Sending test notification to user ${userId}`);
    
    // Get user's push tokens to check their status
    const pushTokens = await storage.getPushTokensByUserId(userId);
    logWithTimestamp(`[PUSH-TOKENS] User has ${pushTokens.length} active tokens for test notification`);
    
    // Log token details for debugging
    pushTokens.forEach((token, index) => {
      logWithTimestamp(`[PUSH-TOKENS] Token ${index + 1}: ${token.token.substring(0, 30)}... (Device: ${token.deviceId})`);
    });
    
    const success = await pushNotificationService.sendTestNotification(userId);
    
    if (success) {
      logWithTimestamp(`[PUSH-TOKENS] Test notification sent successfully to user ${userId}`);
      res.json({ 
        success: true, 
        message: "Test notification sent successfully",
        tokenCount: pushTokens.length
      });
    } else {
      logWithTimestamp(`[PUSH-TOKENS] Failed to send test notification to user ${userId}`);
      
      res.status(400).json({ 
        success: false, 
        error: pushTokens.length === 0 ? "No push tokens found for user" : "Test notification failed to send",
        tokenCount: pushTokens.length
      });
    }
    
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error sending test notification to user ${userId}:`, error);
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