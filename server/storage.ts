import { users, channels, type User, type InsertUser, type Channel, type InsertChannel } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Channel methods
  getUserChannels(userId: number): Promise<Channel[]>;
  getChannelByChannelId(channelId: string): Promise<Channel | undefined>;
  createChannel(channel: InsertChannel): Promise<Channel>;
  deleteChannel(channelId: string, userId: number): Promise<void>;
  
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

  async getUserChannels(userId: number): Promise<Channel[]> {
    return await db.select().from(channels).where(eq(channels.userId, userId));
  }

  async getChannelByChannelId(channelId: string): Promise<Channel | undefined> {
    const [channel] = await db.select().from(channels).where(eq(channels.channelId, channelId));
    return channel || undefined;
  }

  async createChannel(channel: InsertChannel): Promise<Channel> {
    const [newChannel] = await db
      .insert(channels)
      .values(channel)
      .returning();
    return newChannel;
  }

  async deleteChannel(channelId: string, userId: number): Promise<void> {
    await db.delete(channels).where(
      and(
        eq(channels.channelId, channelId),
        eq(channels.userId, userId)
      )
    );
  }
}

export const storage = new DatabaseStorage();
