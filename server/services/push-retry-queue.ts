// Push notification retry queue system
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";
import { errorLogger } from "./error-logging-service.js";
import { storage } from "../repositories/storage.js";
import { 
  RetryableNotification, 
  PushErrorType, 
  shouldRetry, 
  calculateBackoffMs,
  ERROR_HANDLING_RULES 
} from "./error-types.js";

export class PushRetryQueue {
  private retryQueue: Map<string, RetryableNotification> = new Map();
  private retryTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.startRetryProcessor();
  }

  // Add failed notification to retry queue
  public addToRetryQueue(
    userId: number,
    deviceId: string, 
    token: string,
    notification: any,
    errorType: PushErrorType,
    lastError?: string
  ): boolean {
    const key = `${userId}:${deviceId}`;
    const existing = this.retryQueue.get(key);
    const attemptCount = existing ? existing.attemptCount + 1 : 1;

    // Check if should retry
    if (!shouldRetry(errorType, attemptCount)) {
      logWithTimestamp(`🔄 [PushRetryQueue] Max retries exceeded for ${key}, errorType: ${errorType}`);
      return false;
    }

    const backoffMs = calculateBackoffMs(errorType, attemptCount - 1);
    const nextRetryAt = new Date(Date.now() + backoffMs);

    const retryableNotification: RetryableNotification = {
      userId,
      deviceId,
      token,
      notification,
      attemptCount,
      nextRetryAt,
      lastError,
      errorType
    };

    this.retryQueue.set(key, retryableNotification);
    
    logWithTimestamp(`🔄 [PushRetryQueue] Added ${key} to retry queue (attempt ${attemptCount}, retry at ${nextRetryAt.toISOString()})`);
    return true;
  }

  // Remove from retry queue (success or permanent failure)
  public removeFromRetryQueue(userId: number, deviceId: string): void {
    const key = `${userId}:${deviceId}`;
    if (this.retryQueue.delete(key)) {
      logWithTimestamp(`🔄 [PushRetryQueue] Removed ${key} from retry queue`);
    }
  }

  // Get queue status for monitoring
  public getQueueStatus(): {
    totalQueued: number;
    readyForRetry: number;
    byErrorType: Record<string, number>;
  } {
    const now = new Date();
    let readyForRetry = 0;
    const byErrorType: Record<string, number> = {};

    for (const [key, item] of Array.from(this.retryQueue.entries())) {
      if (item.nextRetryAt <= now) {
        readyForRetry++;
      }
      
      const errorType = item.errorType || 'Unknown';
      byErrorType[errorType] = (byErrorType[errorType] || 0) + 1;
    }

    return {
      totalQueued: this.retryQueue.size,
      readyForRetry,
      byErrorType
    };
  }

  // Start the retry processor
  private startRetryProcessor(): void {
    if (this.retryTimer) {
      return;
    }

    logWithTimestamp('🔄 [PushRetryQueue] Starting retry processor');
    
    // Process retries every 30 seconds
    this.retryTimer = setInterval(() => {
      if (!this.isProcessing) {
        this.processRetryQueue();
      }
    }, 30000);
  }

  // Stop the retry processor
  public stopRetryProcessor(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
      logWithTimestamp('🔄 [PushRetryQueue] Stopped retry processor');
    }
  }

  // Process items ready for retry
  private async processRetryQueue(): Promise<void> {
    if (this.isProcessing || this.retryQueue.size === 0) {
      return;
    }

    this.isProcessing = true;
    const now = new Date();
    const readyItems: [string, RetryableNotification][] = [];

    // Find items ready for retry
    for (const [key, item] of Array.from(this.retryQueue.entries())) {
      if (item.nextRetryAt <= now) {
        readyItems.push([key, item]);
      }
    }

    if (readyItems.length === 0) {
      this.isProcessing = false;
      return;
    }

    logWithTimestamp(`🔄 [PushRetryQueue] Processing ${readyItems.length} retry items`);

    // Process each retry item
    for (const [key, item] of readyItems) {
      try {
        await this.retryNotification(key, item);
      } catch (error) {
        errorWithTimestamp(`🔄 [PushRetryQueue] Error processing retry for ${key}:`, error);
      }
    }

    this.isProcessing = false;
  }

  // Retry a single notification by directly calling Expo API
  private async retryNotification(key: string, item: RetryableNotification): Promise<void> {
    logWithTimestamp(`🔄 [PushRetryQueue] Retrying notification for ${key} (attempt ${item.attemptCount})`);

    try {
      // Get fresh token data from database
      const userTokens = await storage.getPushTokensByUserId(item.userId);
      const currentToken = userTokens.find(t => t.deviceId === item.deviceId);
      
      if (!currentToken) {
        logWithTimestamp(`🔄 [PushRetryQueue] Token no longer exists for ${key}, removing from queue`);
        this.removeFromRetryQueue(item.userId, item.deviceId);
        return;
      }

      // Import Expo here to avoid circular dependency
      const { Expo } = await import("expo-server-sdk");
      const expo = new Expo({
        accessToken: process.env.EXPO_ACCESS_TOKEN,
        useFcmV1: true,
      });

      // Send single notification directly
      const message = {
        to: currentToken.token,
        title: item.notification.title,
        body: item.notification.body,
        data: item.notification.data || {},
        sound: item.notification.sound || 'default',
        badge: item.notification.badge,
        priority: 'high' as const,
      };

      const tickets = await expo.sendPushNotificationsAsync([message]);
      
      if (tickets.length > 0 && tickets[0].status === 'ok') {
        logWithTimestamp(`🔄 [PushRetryQueue] Retry successful for ${key}`);
        this.removeFromRetryQueue(item.userId, item.deviceId);
      } else {
        // Check if we got an error
        const ticket = tickets[0];
        if (ticket.status === 'error') {
          logWithTimestamp(`🔄 [PushRetryQueue] Retry failed for ${key}: ${ticket.message}`);
          
          // Check if error is still retryable
          const { classifyError } = await import("./error-types.js");
          const errorType = ticket.details ? classifyError(ticket.details) : PushErrorType.UNKNOWN;
          
          if (shouldRetry(errorType, item.attemptCount)) {
            this.addToRetryQueue(
              item.userId,
              item.deviceId,
              item.token,
              item.notification,
              errorType,
              ticket.message || 'Retry failed'
            );
          } else {
            logWithTimestamp(`🔄 [PushRetryQueue] Max retries exceeded for ${key}, removing from queue`);
            this.removeFromRetryQueue(item.userId, item.deviceId);
          }
        }
      }
    } catch (error) {
      errorWithTimestamp(`🔄 [PushRetryQueue] Retry failed for ${key}:`, error);
      
      // Log the error and add back to queue
      await errorLogger.logError(error as Error, {
        service: 'PushRetryQueue',
        operation: 'retryNotification',
        userId: item.userId,
        deviceId: item.deviceId,
        attemptCount: item.attemptCount
      });

      // Add back to queue for another retry if attempts remain
      if (shouldRetry(item.errorType || PushErrorType.UNKNOWN, item.attemptCount)) {
        this.addToRetryQueue(
          item.userId,
          item.deviceId,
          item.token,
          item.notification,
          item.errorType || PushErrorType.UNKNOWN,
          (error as Error).message
        );
      } else {
        logWithTimestamp(`🔄 [PushRetryQueue] Max retries exceeded for ${key} after exception`);
        this.removeFromRetryQueue(item.userId, item.deviceId);
      }
    }
  }

  // Clean up old entries (housekeeping)
  public cleanupOldEntries(): number {
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    let cleaned = 0;

    for (const [key, item] of Array.from(this.retryQueue.entries())) {
      if (item.nextRetryAt < cutoffDate) {
        this.retryQueue.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logWithTimestamp(`🔄 [PushRetryQueue] Cleaned up ${cleaned} old retry entries`);
    }

    return cleaned;
  }
}

// Export singleton instance (will be initialized by PushNotificationService)
export let pushRetryQueue: PushRetryQueue;