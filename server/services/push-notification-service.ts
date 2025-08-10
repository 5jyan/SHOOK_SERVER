// Expo Push Notification Service
import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from "expo-server-sdk";
import { storage } from "../repositories/storage.js";
import { errorLogger } from "./error-logging-service.js";
import type { PushToken } from "@shared/schema";

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
    console.log('🔔 [PushNotificationService] Initialized');
  }

  // Send push notification to specific user
  async sendToUser(userId: number, notification: PushNotificationPayload): Promise<boolean> {
    console.log(`🔔 [PushNotificationService] Sending notification to user ${userId}`);
    
    try {
      // Get all active push tokens for this user
      const pushTokens = await storage.getPushTokensByUserId(userId);
      
      if (pushTokens.length === 0) {
        console.warn(`🔔 [PushNotificationService] No push tokens found for user ${userId}`);
        return false;
      }

      console.log(`🔔 [PushNotificationService] Found ${pushTokens.length} push tokens for user ${userId}`);

      // Send to all user's devices
      const result = await this.sendToTokens(pushTokens, notification);
      return result;
    } catch (error) {
      console.error(`🔔 [PushNotificationService] Error sending to user ${userId}:`, error);
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
    console.log(`🔔 [PushNotificationService] Sending notification to subscribers of channel ${channelId}`);
    
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
          console.log(`🔔 [PushNotificationService] Sending to user ${userWithTokens.userId} with ${userWithTokens.pushTokens.length} tokens`);
          const success = await this.sendToTokens(userWithTokens.pushTokens, notification);
          if (success) {
            successCount++;
          }
        }
      }

      console.log(`🔔 [PushNotificationService] Successfully sent notifications to ${successCount}/${usersWithTokens.length} users for channel ${channelId}`);
      return successCount;
    } catch (error) {
      console.error(`🔔 [PushNotificationService] Error sending to channel subscribers:`, error);
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
    console.log(`🔔 [PushNotificationService] Sending to ${tokens.length} tokens`);
    
    try {
      // Filter valid Expo push tokens (including development mock tokens)
      const validTokens = tokens
        .filter(tokenRecord => {
          // Accept real Expo tokens or development mock tokens
          return Expo.isExpoPushToken(tokenRecord.token) || 
                 tokenRecord.token.startsWith('ExponentPushToken[dev-') ||
                 tokenRecord.token.startsWith('ExponentPushToken[fallback-');
        })
        .map(tokenRecord => tokenRecord.token);

      if (validTokens.length === 0) {
        console.warn('🔔 [PushNotificationService] No valid Expo push tokens found');
        return false;
      }

      // Create push messages
      const messages: ExpoPushMessage[] = validTokens.map(token => ({
        to: token,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        sound: notification.sound || 'default',
        badge: notification.badge,
        priority: 'high',
      }));

      // Filter out mock tokens for actual sending
      const realMessages = messages.filter(msg => 
        Expo.isExpoPushToken(msg.to) && 
        !msg.to.startsWith('ExponentPushToken[dev-') && 
        !msg.to.startsWith('ExponentPushToken[fallback-')
      );
      
      const mockMessages = messages.filter(msg => 
        msg.to.startsWith('ExponentPushToken[dev-') || 
        msg.to.startsWith('ExponentPushToken[fallback-')
      );

      // Log mock messages for development
      if (mockMessages.length > 0) {
        console.log(`🔔 [PushNotificationService] Mock notifications (development):`, mockMessages.map(msg => ({
          token: msg.to.substring(0, 30) + '...',
          title: msg.title,
          body: msg.body
        })));
      }

      let allTickets: ExpoPushTicket[] = [];

      // Send real messages if any
      if (realMessages.length > 0) {
        // Send in chunks (Expo recommends chunks of 100)
        const chunks = this.expo.chunkPushNotifications(realMessages);
        console.log(`🔔 [PushNotificationService] Sending ${chunks.length} real chunks`);
        
        for (const chunk of chunks) {
          try {
            const tickets = await this.expo.sendPushNotificationsAsync(chunk);
            allTickets.push(...tickets);
            console.log(`🔔 [PushNotificationService] Sent chunk with ${chunk.length} messages, got ${tickets.length} tickets`);
          } catch (error) {
            console.error('🔔 [PushNotificationService] Error sending chunk:', error);
          }
        }
      }

      // Create mock tickets for development tokens
      const mockTickets: ExpoPushTicket[] = mockMessages.map(() => ({
        status: 'ok' as const,
        id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      }));
      
      allTickets.push(...mockTickets);

      // Check for errors in tickets
      const errorCount = await this.processTickets(allTickets);
      const successCount = allTickets.length - errorCount;
      
      console.log(`🔔 [PushNotificationService] Results: ${successCount} successful, ${errorCount} errors out of ${allTickets.length} total`);

      // Later, we can implement receipt checking for delivery confirmation
      // this.checkReceipts(allTickets);

      return successCount > 0;
    } catch (error) {
      console.error('🔔 [PushNotificationService] Error in sendToTokens:', error);
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
  private async processTickets(tickets: ExpoPushTicket[]): Promise<number> {
    let errorCount = 0;

    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        console.error(`🔔 [PushNotificationService] Push ticket error:`, ticket.message);
        
        // Handle specific error types
        if (ticket.details && ticket.details.error) {
          const errorType = ticket.details.error;
          
          switch (errorType) {
            case 'DeviceNotRegistered':
              console.warn('🔔 [PushNotificationService] Device token is no longer valid');
              // Mark token as inactive in database
              const tokenRecord = tokens.find(t => t.token === ticket.details!.expoPushToken);
              if (tokenRecord) {
                await storage.markPushTokenAsInactive(tokenRecord.deviceId);
                console.log(`🔔 [PushNotificationService] Marked token ${tokenRecord.deviceId} as inactive.`);
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
            case 'InvalidCredentials':
              console.error('🔔 [PushNotificationService] Invalid push credentials');
              break;
          }
        }
        
        errorCount++;
      } else if (ticket.status === 'ok') {
        console.log(`🔔 [PushNotificationService] Push ticket success: ${ticket.id}`);
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
            console.log(`🔔 [PushNotificationService] Receipt ${receiptId}: delivered successfully`);
          } else if (receipt.status === 'error') {
            console.error(`🔔 [PushNotificationService] Receipt ${receiptId} error:`, receipt.message);
            
            if (receipt.details && receipt.details.error === 'DeviceNotRegistered') {
              // TODO: Remove the token from database
              console.warn('🔔 [PushNotificationService] Should remove invalid token from database');
            }
          }
        }
      }
    } catch (error) {
      console.error('🔔 [PushNotificationService] Error checking receipts:', error);
    }
  }

  // Test notification (useful for debugging)
  async sendTestNotification(userId: number): Promise<boolean> {
    console.log(`🔔 [PushNotificationService] Sending test notification to user ${userId}`);
    
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
    console.log(`🔔 [PushNotificationService] Sending new video summary notification for channel ${channelId}`);
    
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