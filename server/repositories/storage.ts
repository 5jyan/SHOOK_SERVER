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
import { eq, and, isNotNull, desc, inArray, gte } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "../lib/db";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserEmail(userId: number, email: string): Promise<void>;
  
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
  getVideosByChannel(channelId: string, limit?: number): Promise<Video[]>;
  getVideosForUser(userId: number, limit?: number, since?: number | null): Promise<(Video & { channelTitle: string })[]>;
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

  async updateUserEmail(userId: number, email: string): Promise<void> {
    logWithTimestamp("[storage.ts] updateUserEmail");
    await db
      .update(users)
      .set({ email })
      .where(eq(users.id, userId));
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
        isActive: youtubeChannels.isActive,
        lastRssError: youtubeChannels.lastRssError,
        lastRssErrorAt: youtubeChannels.lastRssErrorAt,
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

  async getVideosByChannel(channelId: string, limit: number = 20): Promise<Video[]> {
    logWithTimestamp("[storage.ts] getVideosByChannel");
    return db.select().from(videos).where(eq(videos.channelId, channelId)).orderBy(desc(videos.publishedAt)).limit(limit);
  }

  async getVideosForUser(userId: number, limit: number = 20, since?: number | null): Promise<(Video & { channelTitle: string })[]> {
    const sinceDate = since ? new Date(since) : null;
    logWithTimestamp(`[storage.ts] getVideosForUser for userId: ${userId}, limit: ${limit}${sinceDate ? `, since: ${sinceDate.toISOString()}` : ''}`);
    
    // First get all channels the user is subscribed to
    const subscribedChannels = await db
      .select({ channelId: userChannels.channelId })
      .from(userChannels)
      .where(eq(userChannels.userId, userId));
    
    logWithTimestamp(`[storage.ts] User ${userId} is subscribed to ${subscribedChannels.length} channels`);
    
    if (subscribedChannels.length === 0) {
      return [];
    }
    
    const channelIds = subscribedChannels.map(c => c.channelId);
    logWithTimestamp(`[storage.ts] Fetching videos for channels:`, channelIds);
    
    // Base where clause for channel filtering
    let baseWhereClause = inArray(videos.channelId, channelIds);
    
    // Build query with JOIN to include channel names only (thumbnails now handled by frontend)
    let query = db
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
        channelTitle: youtubeChannels.title, // Include channel title from JOIN
      })
      .from(videos)
      .innerJoin(youtubeChannels, eq(videos.channelId, youtubeChannels.channelId))
      .where(baseWhereClause)
      .orderBy(desc(videos.createdAt))
      .limit(limit);
    
    // For incremental sync, add createdAt filter
    if (sinceDate) {
      logWithTimestamp(`[storage.ts] Incremental sync: filtering videos created after ${sinceDate.toISOString()}`);
      query = db
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
          channelTitle: youtubeChannels.title, // Include channel title from JOIN
        })
        .from(videos)
        .innerJoin(youtubeChannels, eq(videos.channelId, youtubeChannels.channelId))
        .where(and(
          baseWhereClause,
          gte(videos.createdAt as any, sinceDate)
        ))
        .orderBy(desc(videos.createdAt))
        .limit(limit);
    }
    
    const userVideos = await query;
    
    if (sinceDate) {
      logWithTimestamp(`[storage.ts] Incremental sync found ${userVideos.length} new videos for user ${userId} since ${sinceDate.toISOString()}`);
    } else {
      logWithTimestamp(`[storage.ts] Full sync found ${userVideos.length} videos for user ${userId}`);
    }
    
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

  async updateChannelActiveStatus(channelId: string, isActive: boolean, errorMessage: string | null): Promise<void> {
    logWithTimestamp(`[storage.ts] updateChannelActiveStatus - channelId: ${channelId}, isActive: ${isActive}, errorMessage: ${errorMessage}`);
    
    const updateData: any = {
      isActive,
      updatedAt: new Date(),
    };

    if (!isActive && errorMessage) {
      updateData.lastRssError = errorMessage;
      updateData.lastRssErrorAt = new Date();
    } else if (isActive) {
      updateData.lastRssError = null;
      updateData.lastRssErrorAt = null;
    }

    await db
      .update(youtubeChannels)
      .set(updateData)
      .where(eq(youtubeChannels.channelId, channelId));
  }
}

export const storage = new DatabaseStorage();
