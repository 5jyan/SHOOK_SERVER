// Expo Push Notification Service
import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from "expo-server-sdk";
import { storage } from "../repositories/storage.js";
import { errorLogger } from "./error-logging-service.js";
import type { PushToken } from "@shared/schema";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: {
    videoId?: string;
    channelId?: string;
    channelName?: string;
    type?: string;
    [key: string]: any;
  };
  sound?: 'default' | null;
  badge?: number;
}

export class PushNotificationService {
  private expo: Expo;

  constructor() {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN, // Optional: for higher rate limits
      useFcmV1: true, // Use FCM v1 API (recommended)
    });
    logWithTimestamp('🔔 [PushNotificationService] Initialized');
  }

  // Send push notification to specific user
  async sendToUser(userId: number, notification: PushNotificationPayload): Promise<boolean> {
    logWithTimestamp(`🔔 [PushNotificationService] Sending notification to user ${userId}`);
    
    try {
      // Get all active push tokens for this user
      const pushTokens = await storage.getPushTokensByUserId(userId);
      
      if (pushTokens.length === 0) {
        console.warn(`🔔 [PushNotificationService] No push tokens found for user ${userId}`);
        return false;
      }

      logWithTimestamp(`🔔 [PushNotificationService] Found ${pushTokens.length} push tokens for user ${userId}`);

      // Send to all user's devices
      const result = await this.sendToTokens(pushTokens, notification);
      return result;
    } catch (error) {
      errorWithTimestamp(`🔔 [PushNotificationService] Error sending to user ${userId}:`, error);
      await errorLogger.logError(error as Error, {
        service: 'PushNotificationService',
        operation: 'sendToUser',
        userId,
        notification: JSON.stringify(notification)
      });
      return false;
    }
  }

  // Send push notification to all users subscribed to a channel
  async sendToChannelSubscribers(channelId: string, notification: PushNotificationPayload): Promise<number> {
    logWithTimestamp(`🔔 [PushNotificationService] Sending notification to subscribers of channel ${channelId}`);
    
    try {
      // Get users and their push tokens for this channel
      const usersWithTokens = await storage.findUsersByChannelId(channelId);
      
      if (usersWithTokens.length === 0) {
        console.warn(`🔔 [PushNotificationService] No subscribers with push tokens found for channel ${channelId}`);
        return 0;
      }

      let successCount = 0;
      
      // Send to each user
      for (const userWithTokens of usersWithTokens) {
        if (userWithTokens.pushTokens.length > 0) {
          logWithTimestamp(`🔔 [PushNotificationService] Sending to user ${userWithTokens.userId} with ${userWithTokens.pushTokens.length} tokens`);
          const success = await this.sendToTokens(userWithTokens.pushTokens, notification);
          if (success) {
            successCount++;
          }
        }
      }

      logWithTimestamp(`🔔 [PushNotificationService] Successfully sent notifications to ${successCount}/${usersWithTokens.length} users for channel ${channelId}`);
      return successCount;
    } catch (error) {
      errorWithTimestamp(`🔔 [PushNotificationService] Error sending to channel subscribers:`, error);
      await errorLogger.logError(error as Error, {
        service: 'PushNotificationService',
        operation: 'sendToChannelSubscribers',
        channelId,
        notification: JSON.stringify(notification)
      });
      return 0;
    }
  }

  // Send push notification to specific tokens
  private async sendToTokens(tokens: PushToken[], notification: PushNotificationPayload): Promise<boolean> {
    logWithTimestamp(`🔔 [PushNotificationService] Sending to ${tokens.length} tokens`);
    
    try {
      // Extract token strings (validation already done at API level)
      const tokenStrings = tokens.map(tokenRecord => tokenRecord.token);

      if (tokenStrings.length === 0) {
        console.warn('🔔 [PushNotificationService] No tokens provided');
        return false;
      }

      // Create push messages (trusting API-validated tokens)
      const messages: ExpoPushMessage[] = tokenStrings.map(token => ({
        to: token,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        sound: notification.sound || 'default',
        badge: notification.badge,
        priority: 'high',
      }));

      let allTickets: ExpoPushTicket[] = [];

      // Send messages in chunks (Expo recommends chunks of 100)
      if (messages.length > 0) {
        const chunks = this.expo.chunkPushNotifications(messages);
        logWithTimestamp(`🔔 [PushNotificationService] Sending ${chunks.length} chunks`);
        
        for (const chunk of chunks) {
          try {
            const tickets = await this.expo.sendPushNotificationsAsync(chunk);
            allTickets.push(...tickets);
            logWithTimestamp(`🔔 [PushNotificationService] Sent chunk with ${chunk.length} messages, got ${tickets.length} tickets`);
          } catch (error) {
            errorWithTimestamp('🔔 [PushNotificationService] Error sending chunk:', error);
          }
        }
      }

      // Check for errors in tickets and handle invalid tokens
      const errorCount = await this.processTickets(allTickets, tokens);
      const successCount = allTickets.length - errorCount;
      
      logWithTimestamp(`🔔 [PushNotificationService] Results: ${successCount} successful, ${errorCount} errors out of ${allTickets.length} total`);

      // Later, we can implement receipt checking for delivery confirmation
      // this.checkReceipts(allTickets);

      return successCount > 0;
    } catch (error) {
      errorWithTimestamp('🔔 [PushNotificationService] Error in sendToTokens:', error);
      await errorLogger.logError(error as Error, {
        service: 'PushNotificationService',
        operation: 'sendToTokens',
        tokenCount: tokens.length,
        notification: JSON.stringify(notification)
      });
      return false;
    }
  }

  // Process push tickets and handle errors
  private async processTickets(tickets: ExpoPushTicket[], originalTokens: PushToken[]): Promise<number> {
    let errorCount = 0;

    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        errorWithTimestamp(`🔔 [PushNotificationService] Push ticket error:`, ticket.message);
        
        // Handle specific error types
        if (ticket.details && ticket.details.error) {
          const errorType = ticket.details.error;
          
          switch (errorType) {
            case 'DeviceNotRegistered':
              console.warn('🔔 [PushNotificationService] Device token is no longer valid');
              // Mark token as inactive in database
              const tokenRecord = originalTokens.find(t => t.token === ticket.details!.expoPushToken);
              if (tokenRecord) {
                await storage.markPushTokenAsInactive(tokenRecord.deviceId);
                logWithTimestamp(`🔔 [PushNotificationService] Marked token ${tokenRecord.deviceId} as inactive.`);
              }
              break;
            case 'InvalidCredentials':
              // This might be due to invalid token format that passed API validation
              console.warn('🔔 [PushNotificationService] Invalid push token format detected');
              const invalidTokenRecord = originalTokens.find(t => t.token === ticket.details!.expoPushToken);
              if (invalidTokenRecord) {
                await storage.markPushTokenAsInactive(invalidTokenRecord.deviceId);
                logWithTimestamp(`🔔 [PushNotificationService] Marked invalid token ${invalidTokenRecord.deviceId} as inactive.`);
              }
              break;
            case 'MessageTooBig':
              console.warn('🔔 [PushNotificationService] Message size exceeded limit');
              break;
            case 'MessageRateExceeded':
              console.warn('🔔 [PushNotificationService] Message rate exceeded');
              break;
            case 'MismatchSenderId':
              console.warn('🔔 [PushNotificationService] Invalid sender ID');
              break;
          }
        }
        
        errorCount++;
      } else if (ticket.status === 'ok') {
        logWithTimestamp(`🔔 [PushNotificationService] Push ticket success: ${ticket.id}`);
      }
    }

    return errorCount;
  }

  // Check delivery receipts (optional - can be called later)
  async checkReceipts(ticketIds: string[]): Promise<void> {
    try {
      const receiptIdChunks = this.expo.chunkPushNotificationReceiptIds(ticketIds);
      
      for (const chunk of receiptIdChunks) {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(chunk);
        
        for (const receiptId in receipts) {
          const receipt = receipts[receiptId];
          
          if (receipt.status === 'ok') {
            logWithTimestamp(`🔔 [PushNotificationService] Receipt ${receiptId}: delivered successfully`);
          } else if (receipt.status === 'error') {
            errorWithTimestamp(`🔔 [PushNotificationService] Receipt ${receiptId} error:`, receipt.message);
            
            if (receipt.details && receipt.details.error === 'DeviceNotRegistered') {
              // TODO: Remove the token from database
              console.warn('🔔 [PushNotificationService] Should remove invalid token from database');
            }
          }
        }
      }
    } catch (error) {
      errorWithTimestamp('🔔 [PushNotificationService] Error checking receipts:', error);
    }
  }

  // Test notification (useful for debugging)
  async sendTestNotification(userId: number): Promise<boolean> {
    logWithTimestamp(`🔔 [PushNotificationService] Sending test notification to user ${userId}`);
    
    const testNotification: PushNotificationPayload = {
      title: "🔔 Shook 테스트 알림",
      body: "알림을 탭하면 요약 탭으로 이동합니다!",
      data: {
        type: 'test_navigation',
        videoId: 'test-video-123',
        channelId: 'test-channel-456', 
        channelName: '테스트 채널',
        timestamp: new Date().toISOString()
      },
      sound: 'default',
      badge: 1
    };

    return await this.sendToUser(userId, testNotification);
  }

  // Send new video summary notification
  async sendNewVideoSummaryNotification(channelId: string, videoData: {
    videoId: string;
    title: string;
    channelName: string;
    summary: string;
  }): Promise<number> {
    logWithTimestamp(`🔔 [PushNotificationService] Sending new video summary notification for channel ${channelId}`);
    
    const notification: PushNotificationPayload = {
      title: `📺 ${videoData.channelName}`,
      body: `새 영상: ${videoData.title}`,
      data: {
        type: 'new_video_summary',
        videoId: videoData.videoId,
        channelId: channelId,
        channelName: videoData.channelName,
      },
      sound: 'default',
      badge: 1
    };

    return await this.sendToChannelSubscribers(channelId, notification);
  }
}

// Export singleton instance
export const pushNotificationService = new PushNotificationService();