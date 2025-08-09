import { 
  users, 
  youtubeChannels, 
  userChannels,
  videos,
  type User, 
  type InsertUser, 
  type YoutubeChannel, 
  type InsertYoutubeChannel,
  type UserChannel,
  type InsertUserChannel,
  type Video,
  type InsertVideo
} from "@shared/schema";
import { db } from "../lib/db";
import { eq, and, isNotNull, desc, inArray } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "../lib/db";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserEmail(userId: number, email: string): Promise<void>;
  updateUserSlackInfo(userId: number, slackInfo: { slackUserId: string; slackChannelId: string; slackEmail: string; slackJoinedAt: Date }): Promise<void>;
  
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
  getVideosForUser(userId: number, limit?: number): Promise<Video[]>;
  findSubscribedUsers(channelId: string): Promise<{ id: number; slackChannelId: string | null }[]>;
  getAllYoutubeChannels(): Promise<YoutubeChannel[]>;

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
    console.log("[storage.ts] getUser");
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    console.log("[storage.ts] getUserByUsername");
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    console.log("[storage.ts] createUser");
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    console.log("[storage.ts] getUserByEmail");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async updateUserEmail(userId: number, email: string): Promise<void> {
    console.log("[storage.ts] updateUserEmail");
    await db
      .update(users)
      .set({ email })
      .where(eq(users.id, userId));
  }

  async updateUserSlackInfo(userId: number, slackInfo: { slackUserId: string; slackChannelId: string; slackEmail: string; slackJoinedAt: Date }): Promise<void> {
    console.log("[storage.ts] updateUserSlackInfo");
    await db
      .update(users)
      .set({
        slackUserId: slackInfo.slackUserId,
        slackChannelId: slackInfo.slackChannelId,
        slackEmail: slackInfo.slackEmail,
        slackJoinedAt: slackInfo.slackJoinedAt
      })
      .where(eq(users.id, userId));
  }

  async getYoutubeChannel(channelId: string): Promise<YoutubeChannel | undefined> {
    console.log("[storage.ts] getYoutubeChannel");
    const [channel] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.channelId, channelId));
    return channel || undefined;
  }

  async getYoutubeChannelByHandle(handle: string): Promise<YoutubeChannel | undefined> {
    console.log("[storage.ts] getYoutubeChannelByHandle");
    const [channel] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.handle, handle));
    return channel || undefined;
  }

  async createOrUpdateYoutubeChannel(channel: InsertYoutubeChannel): Promise<YoutubeChannel> {
    console.log("[storage.ts] createOrUpdateYoutubeChannel");
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
    console.log("[storage.ts] updateChannelRecentVideo");
    await db
      .update(youtubeChannels)
      .set({ recentVideoId: videoId, processed: true })
      .where(eq(youtubeChannels.channelId, channelId));
  }

  async getUserChannels(userId: number): Promise<(YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]> {
    console.log("[storage.ts] getUserChannels");
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
    console.log("[storage.ts] isUserSubscribedToChannel");
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
    console.log("[storage.ts] subscribeUserToChannel");
    const [subscription] = await db
      .insert(userChannels)
      .values({ userId, channelId })
      .returning();
    
    return subscription;
  }

  async unsubscribeUserFromChannel(userId: number, channelId: string): Promise<void> {
    console.log("[storage.ts] unsubscribeUserFromChannel");
    await db.delete(userChannels).where(
      and(
        eq(userChannels.userId, userId),
        eq(userChannels.channelId, channelId)
      )
    );
  }

  async getChannelSubscriberCount(channelId: string): Promise<number> {
    console.log("[storage.ts] getChannelSubscriberCount");
    const result = await db
      .select({ count: userChannels.id })
      .from(userChannels)
      .where(eq(userChannels.channelId, channelId));
    
    return result.length;
  }

  async deleteYoutubeChannel(channelId: string): Promise<void> {
    console.log("[storage.ts] deleteYoutubeChannel");
    await db.delete(videos).where(eq(videos.channelId, channelId));
    await db.delete(youtubeChannels).where(eq(youtubeChannels.channelId, channelId));
  }

  async createVideo(video: InsertVideo): Promise<Video> {
    console.log("[storage.ts] createVideo");
    const [newVideo] = await db
      .insert(videos)
      .values(video)
      .returning();
    return newVideo;
  }

  async getVideosByChannel(channelId: string, limit: number = 20): Promise<Video[]> {
    console.log("[storage.ts] getVideosByChannel");
    return db.select().from(videos).where(eq(videos.channelId, channelId)).orderBy(desc(videos.publishedAt)).limit(limit);
  }

  async getVideosForUser(userId: number, limit: number = 20): Promise<Video[]> {
    console.log(`[storage.ts] getVideosForUser for userId: ${userId}, limit: ${limit}`);
    
    // First get all channels the user is subscribed to
    const subscribedChannels = await db
      .select({ channelId: userChannels.channelId })
      .from(userChannels)
      .where(eq(userChannels.userId, userId));
    
    console.log(`[storage.ts] User ${userId} is subscribed to ${subscribedChannels.length} channels`);
    
    if (subscribedChannels.length === 0) {
      return [];
    }
    
    const channelIds = subscribedChannels.map(c => c.channelId);
    console.log(`[storage.ts] Fetching videos for channels:`, channelIds);
    
    // Get videos from subscribed channels, ordered by publish date
    const userVideos = await db
      .select()
      .from(videos)
      .where(inArray(videos.channelId, channelIds))
      .orderBy(desc(videos.publishedAt))
      .limit(limit);
    
    console.log(`[storage.ts] Found ${userVideos.length} videos for user ${userId}`);
    return userVideos;
  }

  async findSubscribedUsers(channelId: string): Promise<{ id: number; slackChannelId: string | null }[]> {
    console.log("[storage.ts] findSubscribedUsers");
    const result = await db
      .select({
        id: users.id,
        slackChannelId: users.slackChannelId,
      })
      .from(userChannels)
      .innerJoin(users, eq(userChannels.userId, users.id))
      .where(eq(userChannels.channelId, channelId));
    return result;
  }

  async getAllYoutubeChannels(): Promise<YoutubeChannel[]> {
    console.log("[storage.ts] getAllYoutubeChannels");
    return db.select().from(youtubeChannels);
  }
}

export const storage = new DatabaseStorage();
