import { Router } from "express";
import { Expo } from "expo-server-sdk";
import { isAuthenticated } from "../utils/auth-utils.js";
import { storage } from "../repositories/storage.js";
import { errorLogger } from "../services/error-logging-service.js";
import { pushNotificationService } from "../services/push-notification-service.js";
import type { InsertPushToken } from "@shared/schema";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

const router = Router();

// Industry-standard push token management with token-based deduplication
async function upsertPushToken(userId: number, deviceId: string, token: string, platform: string, appVersion: string): Promise<{wasUpdated: boolean, cleanedUp: number}> {
  try {
    // Get all existing tokens for this user
    const existingTokens = await storage.getPushTokensByUserId(userId);
    
    logWithTimestamp(`[PUSH-TOKENS] User ${userId} currently has ${existingTokens.length} tokens`);
    
    // Step 1: Check if exact same token already exists (industry standard)
    const exactTokenMatch = existingTokens.find(t => t.token === token);
    
    if (exactTokenMatch) {
      // Same token exists - update metadata and clean up duplicates
      let wasUpdated = false;
      
      if (!(exactTokenMatch.deviceId === deviceId && 
            exactTokenMatch.platform === platform && 
            exactTokenMatch.appVersion === appVersion &&
            exactTokenMatch.isActive)) {
        // Update metadata for existing token (keep original deviceId)
        await storage.updatePushToken(exactTokenMatch.deviceId, {
          token,
          platform,
          appVersion, 
          isActive: true
        });
        logWithTimestamp(`[PUSH-TOKENS] Updated metadata for existing token: ${exactTokenMatch.deviceId} (requested as ${deviceId})`);
        wasUpdated = true;
      } else {
        logWithTimestamp(`[PUSH-TOKENS] Token already exists and up-to-date for device: ${deviceId}`);
      }
      
      // IMPORTANT: Clean up duplicate tokens with same token string
      const duplicateTokens = existingTokens.filter(t => 
        t.token === token && t.deviceId !== exactTokenMatch.deviceId
      );
      
      let cleanedUpCount = 0;
      for (const duplicate of duplicateTokens) {
        await storage.deletePushToken(duplicate.deviceId);
        logWithTimestamp(`[PUSH-TOKENS] Removed duplicate token: ${duplicate.deviceId} (kept: ${exactTokenMatch.deviceId})`);
        cleanedUpCount++;
      }
      
      if (cleanedUpCount > 0) {
        logWithTimestamp(`[PUSH-TOKENS] Cleaned up ${cleanedUpCount} duplicate tokens for same token string`);
      }
      
      return { wasUpdated, cleanedUp: cleanedUpCount };
    }
    
    // Step 2: Clean up potential duplicates BEFORE creating new token
    let cleanedUpCount = 0;
    
    // Remove old tokens from same device (deviceId changed scenario)
    const oldDeviceTokens = existingTokens.filter(t => 
      t.deviceId === deviceId && t.token !== token
    );
    
    for (const oldToken of oldDeviceTokens) {
      await storage.deletePushToken(oldToken.deviceId);
      logWithTimestamp(`[PUSH-TOKENS] Removed old token from same device: ${oldToken.deviceId}`);
      cleanedUpCount++;
    }
    
    // Optional: Remove very old tokens from same platform (prevents accumulation)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const oldPlatformTokens = existingTokens.filter(t => 
      t.platform === platform && 
      t.token !== token && 
      t.deviceId !== deviceId &&
      new Date(t.updatedAt || t.createdAt) < thirtyDaysAgo
    );
    
    for (const oldToken of oldPlatformTokens) {
      await storage.deletePushToken(oldToken.deviceId);
      logWithTimestamp(`[PUSH-TOKENS] Removed stale token from same platform: ${oldToken.deviceId} (age: ${Math.floor((Date.now() - new Date(oldToken.createdAt).getTime()) / (1000 * 60 * 60 * 24))} days)`);
      cleanedUpCount++;
    }
    
    // Step 3: Create new token
    const newPushToken: InsertPushToken = {
      userId,
      token,
      deviceId,
      platform,
      appVersion,
      isActive: true
    };
    
    await storage.createPushToken(newPushToken);
    logWithTimestamp(`[PUSH-TOKENS] Created new token for device: ${deviceId} (cleaned up ${cleanedUpCount} old tokens)`);
    return { wasUpdated: false, cleanedUp: cleanedUpCount };
    
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error upserting token:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'upsertPushToken',
      userId,
      deviceId
    });
    throw error;
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

    // Enhanced upsert operation with cleanup
    const result = await upsertPushToken(userId, deviceId, token, platform, appVersion);

    const message = result.wasUpdated 
      ? "Push token updated successfully"
      : "Push token registered successfully";
    
    const finalMessage = result.cleanedUp > 0 
      ? `${message} (cleaned up ${result.cleanedUp} duplicate tokens)`
      : message;

    res.json({ 
      success: true, 
      message: finalMessage,
      stats: {
        wasUpdated: result.wasUpdated,
        cleanedUp: result.cleanedUp
      }
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

// GET /api/push-tokens/retry-queue-status - Monitor retry queue status (admin only)
router.get("/retry-queue-status", isAuthenticated, async (req, res) => {
  try {
    // Basic auth check - only allow managers to see retry queue status
    if (req.user?.role !== 'manager') {
      return res.status(403).json({
        success: false,
        error: "Insufficient privileges"
      });
    }

    const queueStatus = pushNotificationService.getRetryQueueStatus();
    
    res.json({
      success: true,
      data: {
        ...queueStatus,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error getting retry queue status:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'getRetryQueueStatus',
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      error: "Failed to get retry queue status"
    });
  }
});

// POST /api/push-tokens/cleanup-retry-queue - Clean up old retry entries (admin only)
router.post("/cleanup-retry-queue", isAuthenticated, async (req, res) => {
  try {
    // Basic auth check - only allow managers to cleanup retry queue
    if (req.user?.role !== 'manager') {
      return res.status(403).json({
        success: false,
        error: "Insufficient privileges"
      });
    }

    const cleanedCount = pushNotificationService.cleanupRetryQueue();
    logWithTimestamp(`[PUSH-TOKENS] Manual retry queue cleanup completed, removed ${cleanedCount} entries`);
    
    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} old retry entries`,
      cleanedCount
    });
    
  } catch (error) {
    errorWithTimestamp(`[PUSH-TOKENS] Error cleaning up retry queue:`, error);
    await errorLogger.logError(error as Error, {
      service: 'PushTokensRoute',
      operation: 'cleanupRetryQueue',
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      error: "Failed to cleanup retry queue"
    });
  }
});

export default router;