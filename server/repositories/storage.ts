import { 
  users, 
  youtubeChannels, 
  userChannels,
  videos,
  pushTokens,
  type User, 
  type InsertUser, 
  type YoutubeChannel, 
  type InsertYoutubeChannel,
  type UserChannel,
  type InsertUserChannel,
  type Video,
  type InsertVideo,
  type PushToken,
  type InsertPushToken
} from "@shared/schema";
import { db } from "../lib/db";
import { eq, and, isNotNull, desc, inArray, gte, sql } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "../lib/db";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByKakaoId(kakaoId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserEmail(userId: number, email: string): Promise<void>;
  deleteUser(userId: number): Promise<void>;
  linkKakaoAccount(userId: number, kakaoId: string, email: string | null): Promise<User>;
  
  // YouTube Channel methods
  getYoutubeChannel(channelId: string): Promise<YoutubeChannel | undefined>;
  getYoutubeChannelByHandle(handle: string): Promise<YoutubeChannel | undefined>;
  createOrUpdateYoutubeChannel(channel: InsertYoutubeChannel): Promise<YoutubeChannel>;
  updateChannelRecentVideo(channelId: string, videoId: string): Promise<void>;

  // User Channel subscription methods
  getUserChannels(userId: number): Promise<(YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]>;
  isUserSubscribedToChannel(userId: number, channelId: string): Promise<boolean>;
  subscribeUserToChannel(userId: number, channelId: string): Promise<UserChannel>;
  unsubscribeUserFromChannel(userId: number, channelId: string): Promise<void>;
  getChannelSubscriberCount(channelId: string): Promise<number>;
  deleteYoutubeChannel(channelId: string): Promise<void>;
  
  // Video methods
  createVideo(video: InsertVideo): Promise<Video>;
  getVideo(videoId: string): Promise<Video | undefined>;
  getVideosByChannel(channelId: string, limit?: number): Promise<Video[]>;
  getVideosForUser(userId: number, limit?: number, since?: number): Promise<Video[]>;
  updateVideoProcessingStatus(videoId: string, updates: Partial<Video>): Promise<void>;
  getPendingVideos(limit: number): Promise<Video[]>;
  getLiveVideos(limit: number): Promise<Video[]>;
  findSubscribedUsers(channelId: string): Promise<{ id: number }[]>;
  getAllYoutubeChannels(): Promise<YoutubeChannel[]>;

  // Push token methods
  createPushToken(pushToken: InsertPushToken): Promise<PushToken>;
  updatePushToken(deviceId: string, pushToken: Partial<InsertPushToken>): Promise<void>;
  deletePushToken(deviceId: string): Promise<void>;
  markPushTokenAsInactive(deviceId: string): Promise<void>;
  getPushTokensByUserId(userId: number): Promise<PushToken[]>;
  findUsersByChannelId(channelId: string): Promise<{ userId: number; pushTokens: PushToken[] }[]>;

  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true 
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    logWithTimestamp("[storage.ts] getUser");
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    logWithTimestamp("[storage.ts] getUserByUsername");
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    logWithTimestamp("[storage.ts] createUser");
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    logWithTimestamp("[storage.ts] getUserByEmail");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByKakaoId(kakaoId: string): Promise<User | undefined> {
    logWithTimestamp("[storage.ts] getUserByKakaoId");
    const [user] = await db.select().from(users).where(eq(users.kakaoId, kakaoId));
    return user || undefined;
  }

  async updateUserEmail(userId: number, email: string): Promise<void> {
    logWithTimestamp("[storage.ts] updateUserEmail");
    await db
      .update(users)
      .set({ email })
      .where(eq(users.id, userId));
  }

  async deleteUser(userId: number): Promise<void> {
    logWithTimestamp("[storage.ts] deleteUser");

    // Delete user's push tokens first
    await db.delete(pushTokens).where(eq(pushTokens.userId, userId));

    // Delete user's channel subscriptions
    await db.delete(userChannels).where(eq(userChannels.userId, userId));

    // Delete the user
    await db.delete(users).where(eq(users.id, userId));

    logWithTimestamp(`[storage.ts] User ${userId} and all associated data deleted`);
  }

  async convertGuestToKakao(userId: number, kakaoId: string, email: string | null): Promise<User> {
    logWithTimestamp(`[storage.ts] Converting guest user ${userId} to Kakao account`);

    const [updatedUser] = await db
      .update(users)
      .set({
        username: `kakao_${kakaoId}`,
        kakaoId: kakaoId,
        email: email,
        authProvider: "kakao",
      })
      .where(eq(users.id, userId))
      .returning();

    logWithTimestamp(`[storage.ts] Guest user ${userId} successfully converted to Kakao account`);
    return updatedUser;
  }

  async linkKakaoAccount(userId: number, kakaoId: string, email: string | null): Promise<User> {
    logWithTimestamp(`[storage.ts] linkKakaoAccount for user ${userId}`);

    return db.transaction(async (tx) => {
      const [currentUser] = await tx.select().from(users).where(eq(users.id, userId));
      if (!currentUser) {
        throw new Error(`User ${userId} not found`);
      }

      const [linkedUser] = await tx.select().from(users).where(eq(users.kakaoId, kakaoId));
      let linkedUserRole: User["role"] | undefined = undefined;

      if (linkedUser && linkedUser.id !== userId) {
        logWithTimestamp(`[storage.ts] Unlinking Kakao from user ${linkedUser.id}`);
        await tx
          .update(users)
          .set({ kakaoId: null, authProvider: "guest" })
          .where(eq(users.id, linkedUser.id));
        linkedUserRole = linkedUser.role;

        logWithTimestamp(`[storage.ts] Migrating channels from user ${linkedUser.id} to user ${userId}`);
        const sourceChannels = await tx
          .select({
            channelId: userChannels.channelId,
            createdAt: userChannels.createdAt,
          })
          .from(userChannels)
          .where(eq(userChannels.userId, linkedUser.id));

        await tx.delete(userChannels).where(eq(userChannels.userId, userId));

        if (sourceChannels.length > 0) {
          await tx.insert(userChannels).values(
            sourceChannels.map((channel) => ({
              userId,
              channelId: channel.channelId,
              createdAt: channel.createdAt,
            }))
          );
        }
      }

      const updateData: { kakaoId: string; email?: string; authProvider?: string; role?: User["role"] } = {
        kakaoId,
      };

      if (!currentUser.email && email) {
        updateData.email = email;
      }

      if (currentUser.authProvider === "guest") {
        updateData.authProvider = "kakao";
      }

      if (linkedUserRole && currentUser.role !== linkedUserRole) {
        updateData.role = linkedUserRole;
      }

      const [updatedUser] = await tx
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      return updatedUser;
    });
  }

  async getYoutubeChannel(channelId: string): Promise<YoutubeChannel | undefined> {
    logWithTimestamp("[storage.ts] getYoutubeChannel");
    const [channel] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.channelId, channelId));
    return channel || undefined;
  }

  async getYoutubeChannelByHandle(handle: string): Promise<YoutubeChannel | undefined> {
    logWithTimestamp("[storage.ts] getYoutubeChannelByHandle");
    const [channel] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.handle, handle));
    return channel || undefined;
  }

  async createOrUpdateYoutubeChannel(channel: InsertYoutubeChannel): Promise<YoutubeChannel> {
    logWithTimestamp("[storage.ts] createOrUpdateYoutubeChannel");
    const [existingChannel] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.channelId, channel.channelId));
    
    if (existingChannel) {
      // Update existing channel
      const [updatedChannel] = await db
        .update(youtubeChannels)
        .set({
          ...channel,
          updatedAt: new Date()
        })
        .where(eq(youtubeChannels.channelId, channel.channelId))
        .returning();
      return updatedChannel;
    } else {
      // Create new channel
      const [newChannel] = await db
        .insert(youtubeChannels)
        .values(channel)
        .returning();
      return newChannel;
    }
  }

  async updateChannelRecentVideo(channelId: string, videoId: string): Promise<void> {
    logWithTimestamp("[storage.ts] updateChannelRecentVideo");
    await db
      .update(youtubeChannels)
      .set({ recentVideoId: videoId, processed: true })
      .where(eq(youtubeChannels.channelId, channelId));
  }

  async getUserChannels(userId: number): Promise<(YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]> {
    logWithTimestamp("[storage.ts] getUserChannels");
    const result = await db
      .select({
        channelId: youtubeChannels.channelId,
        handle: youtubeChannels.handle,
        title: youtubeChannels.title,
        description: youtubeChannels.description,
        thumbnail: youtubeChannels.thumbnail,
        subscriberCount: youtubeChannels.subscriberCount,
        videoCount: youtubeChannels.videoCount,
        updatedAt: youtubeChannels.updatedAt,
        recentVideoId: youtubeChannels.recentVideoId,
        processed: youtubeChannels.processed,
        subscriptionId: userChannels.id,
        subscribedAt: userChannels.createdAt
      })
      .from(userChannels)
      .innerJoin(youtubeChannels, eq(userChannels.channelId, youtubeChannels.channelId))
      .where(eq(userChannels.userId, userId));
    
    return result;
  }

  async isUserSubscribedToChannel(userId: number, channelId: string): Promise<boolean> {
    logWithTimestamp("[storage.ts] isUserSubscribedToChannel");
    const [subscription] = await db
      .select()
      .from(userChannels)
      .where(and(
        eq(userChannels.userId, userId),
        eq(userChannels.channelId, channelId)
      ));
    
    return !!subscription;
  }

  async subscribeUserToChannel(userId: number, channelId: string): Promise<UserChannel> {
    logWithTimestamp("[storage.ts] subscribeUserToChannel");
    const [subscription] = await db
      .insert(userChannels)
      .values({ userId, channelId })
      .returning();
    
    return subscription;
  }

  async unsubscribeUserFromChannel(userId: number, channelId: string): Promise<void> {
    logWithTimestamp("[storage.ts] unsubscribeUserFromChannel");
    await db.delete(userChannels).where(
      and(
        eq(userChannels.userId, userId),
        eq(userChannels.channelId, channelId)
      )
    );
  }

  async getChannelSubscriberCount(channelId: string): Promise<number> {
    logWithTimestamp("[storage.ts] getChannelSubscriberCount");
    const result = await db
      .select({ count: userChannels.id })
      .from(userChannels)
      .where(eq(userChannels.channelId, channelId));
    
    return result.length;
  }

  async deleteYoutubeChannel(channelId: string): Promise<void> {
    logWithTimestamp("[storage.ts] deleteYoutubeChannel");
    await db.delete(videos).where(eq(videos.channelId, channelId));
    await db.delete(youtubeChannels).where(eq(youtubeChannels.channelId, channelId));
  }

  async createVideo(video: InsertVideo): Promise<Video> {
    logWithTimestamp("[storage.ts] createVideo");
    const [newVideo] = await db
      .insert(videos)
      .values(video)
      .returning();
    return newVideo;
  }

  async getVideo(videoId: string): Promise<Video | undefined> {
    logWithTimestamp("[storage.ts] getVideo");
    const [video] = await db.select().from(videos).where(eq(videos.videoId, videoId));
    return video || undefined;
  }

  async updateVideoProcessingStatus(videoId: string, updates: Partial<Video>): Promise<void> {
    logWithTimestamp(`[storage.ts] updateVideoProcessingStatus - videoId: ${videoId}`);
    await db
      .update(videos)
      .set(updates)
      .where(eq(videos.videoId, videoId));
  }

  async getPendingVideos(limit: number): Promise<Video[]> {
    logWithTimestamp(`[storage.ts] getPendingVideos - limit: ${limit}`);
    return db
      .select()
      .from(videos)
      .where(
        and(
          eq(videos.processingStatus, 'pending'),
          eq(videos.processed, false),
          sql`(${videos.retryCount} IS NULL OR ${videos.retryCount} < 3)`
        )
      )
      .orderBy(videos.createdAt)
      .limit(limit);
  }

  async getLiveVideos(limit: number): Promise<Video[]> {
    logWithTimestamp(`[storage.ts] getLiveVideos - limit: ${limit}`);
    return db
      .select()
      .from(videos)
      .where(eq(videos.videoType, 'live'))
      .orderBy(videos.createdAt)
      .limit(limit);
  }

  async getVideosByChannel(channelId: string, limit: number = 20): Promise<Video[]> {
    logWithTimestamp("[storage.ts] getVideosByChannel");
    return db.select().from(videos).where(eq(videos.channelId, channelId)).orderBy(desc(videos.publishedAt)).limit(limit);
  }

  async getVideosForUser(userId: number, limit: number = 20, since?: number): Promise<Video[]> {
    const sinceDate = since ? new Date(since) : null;
    logWithTimestamp(`[storage.ts] getVideosForUser for userId: ${userId}, limit: ${limit}${sinceDate ? `, since: ${sinceDate.toISOString()}` : ''}`);

    // Get user's channel subscriptions with subscription dates
    const userSubscriptions = await db
      .select({
        channelId: userChannels.channelId,
        subscribedAt: userChannels.createdAt,
      })
      .from(userChannels)
      .where(eq(userChannels.userId, userId));

    logWithTimestamp(`[storage.ts] User has ${userSubscriptions.length} channel subscriptions`);

    if (userSubscriptions.length === 0) {
      return [];
    }

    // Build query to get videos created after user's subscription to each channel
    const channelIds = userSubscriptions.map(sub => sub.channelId);

    // Get all videos from subscribed channels
    const allChannelVideos = await db
      .select({
        videoId: videos.videoId,
        channelId: videos.channelId,
        title: videos.title,
        publishedAt: videos.publishedAt,
        summary: videos.summary,
        transcript: videos.transcript,
        processed: videos.processed,
        errorMessage: videos.errorMessage,
        createdAt: videos.createdAt,
        channelTitle: videos.channelTitle,
        channelThumbnail: videos.channelThumbnail,
        processingStatus: videos.processingStatus,
        processingStartedAt: videos.processingStartedAt,
        processingCompletedAt: videos.processingCompletedAt,
      })
      .from(videos)
      .where(
        sinceDate
          ? and(
              eq(videos.channelId, channelIds[0]), // Use first channel for initial filter
              gte(videos.createdAt as any, sinceDate)
            )
          : eq(videos.channelId, channelIds[0]) // Use first channel for initial filter
      )
      .orderBy(desc(videos.createdAt));

    // Filter videos per channel based on subscription date
    const filteredVideos: Video[] = [];
    const channelLatestVideos: Map<string, Video> = new Map();

    for (const video of allChannelVideos) {
      const subscription = userSubscriptions.find(sub => sub.channelId === video.channelId);
      if (!subscription) continue;

      const subscribedAt = subscription.subscribedAt || new Date(0);

      // Track latest video per channel for fallback
      if (!channelLatestVideos.has(video.channelId)) {
        channelLatestVideos.set(video.channelId, video as Video);
      }

      // Include videos created after subscription
      if (new Date(video.createdAt) >= new Date(subscribedAt)) {
        filteredVideos.push(video as Video);
      }
    }

    // Get all videos from all subscribed channels (proper multi-channel query)
    const allVideosQuery = await db
      .select({
        videoId: videos.videoId,
        channelId: videos.channelId,
        title: videos.title,
        publishedAt: videos.publishedAt,
        summary: videos.summary,
        transcript: videos.transcript,
        processed: videos.processed,
        errorMessage: videos.errorMessage,
        createdAt: videos.createdAt,
        channelTitle: videos.channelTitle,
        channelThumbnail: videos.channelThumbnail,
        processingStatus: videos.processingStatus,
        processingStartedAt: videos.processingStartedAt,
        processingCompletedAt: videos.processingCompletedAt,
      })
      .from(videos)
      .where(
        sinceDate
          ? and(
              sql`${videos.channelId} IN ${channelIds}`,
              gte(videos.createdAt as any, sinceDate)
            )
          : sql`${videos.channelId} IN ${channelIds}`
      )
      .orderBy(desc(videos.createdAt));

    // Get all videos (without since filter) for fallback
    const allVideosWithoutSinceFilter = await db
      .select({
        videoId: videos.videoId,
        channelId: videos.channelId,
        title: videos.title,
        publishedAt: videos.publishedAt,
        summary: videos.summary,
        transcript: videos.transcript,
        processed: videos.processed,
        errorMessage: videos.errorMessage,
        createdAt: videos.createdAt,
        channelTitle: videos.channelTitle,
        channelThumbnail: videos.channelThumbnail,
        processingStatus: videos.processingStatus,
        processingStartedAt: videos.processingStartedAt,
        processingCompletedAt: videos.processingCompletedAt,
      })
      .from(videos)
      .where(sql`${videos.channelId} IN ${channelIds}`)
      .orderBy(desc(videos.createdAt));

    // Re-process with all videos
    const properFilteredVideos: Video[] = [];
    const properChannelLatestVideos: Map<string, Video[]> = new Map();

    // Build fallback map from unfiltered results
    for (const video of allVideosWithoutSinceFilter) {
      const existingVideos = properChannelLatestVideos.get(video.channelId) || [];
      if (existingVideos.length < 3) {
        existingVideos.push(video as Video);
        properChannelLatestVideos.set(video.channelId, existingVideos);
      }
    }

    // Process filtered results
    for (const video of allVideosQuery) {
      const subscription = userSubscriptions.find(sub => sub.channelId === video.channelId);
      if (!subscription) continue;

      const subscribedAt = subscription.subscribedAt || new Date(0);

      // Include videos created after subscription
      if (new Date(video.createdAt) >= new Date(subscribedAt)) {
        properFilteredVideos.push(video as Video);
      }
    }

    // For channels with no videos after subscription, add the latest videos (up to 3)
    for (const subscription of userSubscriptions) {
      const channelId = subscription.channelId;
      const hasVideosAfterSub = properFilteredVideos.some(v => v.channelId === channelId);

      if (!hasVideosAfterSub) {
        const latestVideos = properChannelLatestVideos.get(channelId) || [];
        if (latestVideos.length > 0) {
          logWithTimestamp(`[storage.ts] Channel ${channelId} has no videos after subscription, adding ${latestVideos.length} latest videos`);
          properFilteredVideos.push(...latestVideos);
        }
      }
    }

    // Sort by createdAt descending and apply limit
    const sortedVideos = properFilteredVideos.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ).slice(0, limit);

    logWithTimestamp(`[storage.ts] Filtered ${sortedVideos.length} videos for user ${userId} (after subscription filter + fallback)`);

    const userVideos = sortedVideos;
    
    // Log sample video with channel name for debugging
    if (userVideos.length > 0) {
      const sampleVideo = userVideos[0];
      logWithTimestamp(`[storage.ts] Sample video with channel:`, {
        videoId: sampleVideo.videoId,
        title: sampleVideo.title.substring(0, 50) + '...',
        channelTitle: sampleVideo.channelTitle,
        publishedAt: sampleVideo.publishedAt,
      });
    }
    
    return userVideos;
  }

  async findSubscribedUsers(channelId: string): Promise<{ id: number }[]> {
    logWithTimestamp("[storage.ts] findSubscribedUsers");
    const result = await db
      .select({
        id: users.id,
      })
      .from(userChannels)
      .innerJoin(users, eq(userChannels.userId, users.id))
      .where(eq(userChannels.channelId, channelId));
    return result;
  }

  async getAllYoutubeChannels(): Promise<YoutubeChannel[]> {
    logWithTimestamp("[storage.ts] getAllYoutubeChannels");
    return db.select().from(youtubeChannels);
  }

  // Push token methods implementation
  async createPushToken(pushToken: InsertPushToken): Promise<PushToken> {
    logWithTimestamp("[storage.ts] createPushToken");
    const [newPushToken] = await db
      .insert(pushTokens)
      .values(pushToken)
      .returning();
    return newPushToken;
  }

  async updatePushToken(deviceId: string, pushTokenData: Partial<InsertPushToken>): Promise<void> {
    logWithTimestamp("[storage.ts] updatePushToken");
    await db
      .update(pushTokens)
      .set({
        ...pushTokenData,
        updatedAt: new Date(),
      })
      .where(eq(pushTokens.deviceId, deviceId));
  }

  async deletePushToken(deviceId: string): Promise<void> {
    logWithTimestamp("[storage.ts] deletePushToken");
    await db
      .delete(pushTokens)
      .where(eq(pushTokens.deviceId, deviceId));
  }

  async markPushTokenAsInactive(deviceId: string): Promise<void> {
    logWithTimestamp("[storage.ts] markPushTokenAsInactive");
    await db
      .update(pushTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(pushTokens.deviceId, deviceId));
  }

  async getPushTokensByUserId(userId: number): Promise<PushToken[]> {
    logWithTimestamp("[storage.ts] getPushTokensByUserId");
    return db
      .select()
      .from(pushTokens)
      .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));
  }

  async findUsersByChannelId(channelId: string): Promise<{ userId: number; pushTokens: PushToken[] }[]> {
    logWithTimestamp("[storage.ts] findUsersByChannelId - using optimized JOIN query");
    
    // Single query with LEFT JOIN to get users and their active push tokens
    const result = await db
      .select({
        userId: userChannels.userId,
        // Push token fields (will be null if user has no active tokens)
        tokenId: pushTokens.id,
        token: pushTokens.token,
        deviceId: pushTokens.deviceId,
        platform: pushTokens.platform,
        appVersion: pushTokens.appVersion,
        isActive: pushTokens.isActive,
        tokenCreatedAt: pushTokens.createdAt,
        tokenUpdatedAt: pushTokens.updatedAt,
      })
      .from(userChannels)
      .leftJoin(
        pushTokens, 
        and(
          eq(userChannels.userId, pushTokens.userId),
          eq(pushTokens.isActive, true)
        )
      )
      .where(eq(userChannels.channelId, channelId));

    logWithTimestamp(`[storage.ts] JOIN query returned ${result.length} rows for channel ${channelId}`);

    // Group results by userId (more efficient than Map for small datasets)
    const userTokenMap: Record<number, PushToken[]> = {};
    
    for (const row of result) {
      // Initialize user entry if not exists
      if (!userTokenMap[row.userId]) {
        userTokenMap[row.userId] = [];
      }
      
      // Add token if it exists (LEFT JOIN might return null tokens)
      if (row.tokenId !== null) {
        userTokenMap[row.userId].push({
          id: row.tokenId,
          userId: row.userId,
          token: row.token!,
          deviceId: row.deviceId!,
          platform: row.platform!,
          appVersion: row.appVersion!,
          isActive: row.isActive!,
          createdAt: row.tokenCreatedAt!,
          updatedAt: row.tokenUpdatedAt!,
        });
      }
    }

    // Convert to required format
    const users = Object.keys(userTokenMap).map(userIdStr => ({
      userId: parseInt(userIdStr, 10),
      pushTokens: userTokenMap[parseInt(userIdStr, 10)]
    }));

    logWithTimestamp(`[storage.ts] Found ${users.length} subscribed users, total tokens: ${users.reduce((sum, u) => sum + u.pushTokens.length, 0)}`);
    
    return users;
  }

}

export const storage = new DatabaseStorage();
