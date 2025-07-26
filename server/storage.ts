import { 
  users, 
  youtubeChannels, 
  userChannels,
  type User, 
  type InsertUser, 
  type YoutubeChannel, 
  type InsertYoutubeChannel,
  type UserChannel,
  type InsertUserChannel
} from "@shared/schema";
import { db } from "./db";
import { eq, and, isNotNull } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserEmail(userId: number, email: string): Promise<void>;
  updateUserSlackInfo(userId: number, slackInfo: { slackUserId: string; slackChannelId: string; slackJoinedAt: Date }): Promise<void>;
  
  // YouTube Channel methods
  getYoutubeChannel(channelId: string): Promise<YoutubeChannel | undefined>;
  getYoutubeChannelByHandle(handle: string): Promise<YoutubeChannel | undefined>;
  createOrUpdateYoutubeChannel(channel: InsertYoutubeChannel): Promise<YoutubeChannel>;
  
  // User Channel subscription methods
  getUserChannels(userId: number): Promise<(YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]>;
  isUserSubscribedToChannel(userId: number, channelId: string): Promise<boolean>;
  subscribeUserToChannel(userId: number, channelId: string): Promise<UserChannel>;
  unsubscribeUserFromChannel(userId: number, channelId: string): Promise<void>;
  getChannelSubscriberCount(channelId: string): Promise<number>;
  deleteYoutubeChannel(channelId: string): Promise<void>;
  
  // Channel videos methods
  getChannelVideos(userId: number, limit?: number): Promise<YoutubeChannel[]>;
  
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
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async updateUserEmail(userId: number, email: string): Promise<void> {
    await db
      .update(users)
      .set({ email })
      .where(eq(users.id, userId));
  }

  async updateUserSlackInfo(userId: number, slackInfo: { slackUserId: string; slackChannelId: string; slackJoinedAt: Date }): Promise<void> {
    await db
      .update(users)
      .set({
        slackUserId: slackInfo.slackUserId,
        slackChannelId: slackInfo.slackChannelId,
        slackJoinedAt: slackInfo.slackJoinedAt
      })
      .where(eq(users.id, userId));
  }

  async getYoutubeChannel(channelId: string): Promise<YoutubeChannel | undefined> {
    const [channel] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.channelId, channelId));
    return channel || undefined;
  }

  async getYoutubeChannelByHandle(handle: string): Promise<YoutubeChannel | undefined> {
    const [channel] = await db.select().from(youtubeChannels).where(eq(youtubeChannels.handle, handle));
    return channel || undefined;
  }

  async createOrUpdateYoutubeChannel(channel: InsertYoutubeChannel): Promise<YoutubeChannel> {
    const existingChannel = await this.getYoutubeChannel(channel.channelId);
    
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

  async getUserChannels(userId: number): Promise<(YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]> {
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
        recentVideoTitle: youtubeChannels.recentVideoTitle,
        videoPublishedAt: youtubeChannels.videoPublishedAt,
        processed: youtubeChannels.processed,
        errorMessage: youtubeChannels.errorMessage,
        caption: youtubeChannels.caption,
        subscriptionId: userChannels.id,
        subscribedAt: userChannels.createdAt
      })
      .from(userChannels)
      .innerJoin(youtubeChannels, eq(userChannels.channelId, youtubeChannels.channelId))
      .where(eq(userChannels.userId, userId));
    
    return result;
  }

  async isUserSubscribedToChannel(userId: number, channelId: string): Promise<boolean> {
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
    const [subscription] = await db
      .insert(userChannels)
      .values({ userId, channelId })
      .returning();
    
    return subscription;
  }

  async unsubscribeUserFromChannel(userId: number, channelId: string): Promise<void> {
    await db.delete(userChannels).where(
      and(
        eq(userChannels.userId, userId),
        eq(userChannels.channelId, channelId)
      )
    );
  }

  async getChannelSubscriberCount(channelId: string): Promise<number> {
    const result = await db
      .select({ count: userChannels.id })
      .from(userChannels)
      .where(eq(userChannels.channelId, channelId));
    
    return result.length;
  }

  async deleteYoutubeChannel(channelId: string): Promise<void> {
    await db.delete(youtubeChannels).where(eq(youtubeChannels.channelId, channelId));
  }

  async getChannelVideos(userId: number, limit: number = 20): Promise<YoutubeChannel[]> {
    // 사용자가 구독한 채널들의 최신 영상 정보를 가져옴
    const result = await db
      .select()
      .from(youtubeChannels)
      .innerJoin(userChannels, eq(youtubeChannels.channelId, userChannels.channelId))
      .where(and(
        eq(userChannels.userId, userId),
        isNotNull(youtubeChannels.recentVideoId) // recentVideoId가 null이 아닌 것만
      ))
      .orderBy(youtubeChannels.videoPublishedAt)
      .limit(limit);
    
    return result.map(row => row.youtube_channels);
  }
}

export const storage = new DatabaseStorage();
