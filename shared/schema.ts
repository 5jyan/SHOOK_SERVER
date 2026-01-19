import { pgTable, text, serial, integer, boolean, timestamp, varchar, json, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Define role enum
export const userRoleEnum = pgEnum('user_role', ['user', 'tester', 'manager']);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password"),
  email: text("email"),
  kakaoId: text("kakao_id").unique(),
  authProvider: text("auth_provider").notNull().default('local'),
  role: userRoleEnum("role").notNull().default('user'),
  createdAt: timestamp("created_at").defaultNow(),
});

// YouTube channel master data (shared across all users)
export const youtubeChannels = pgTable("youtube_channels", {
  channelId: text("channel_id").primaryKey(),
  handle: text("handle").notNull(),
  title: text("title").notNull(),
  description: varchar("description", { length: 1000 }),
  thumbnail: text("thumbnail"),
  subscriberCount: integer("subscriber_count"),
  videoCount: integer("video_count"),
  updatedAt: timestamp("updated_at").defaultNow(),
  recentVideoId: text("recent_video_id"),
  processed: boolean("processed").default(false),
});

export const videos = pgTable("videos", {
  videoId: text("video_id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => youtubeChannels.channelId),
  title: text("title").notNull(),
  publishedAt: timestamp("published_at").notNull(),
  summary: text("summary"),
  transcript: text("transcript"),
  transcriptSource: text("transcript_source"),
  processed: boolean("processed").default(false),
  isSummarized: boolean("is_summarized").default(false),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  // Added fields for better performance and metadata
  channelTitle: text("channel_title").notNull().default('Unknown Channel'),
  channelThumbnail: text("channel_thumbnail"),
  processingStatus: text("processing_status").default('pending'), // pending, processing, completed, failed
  processingStartedAt: timestamp("processing_started_at"),
  processingCompletedAt: timestamp("processing_completed_at"),
  retryCount: integer("retry_count").default(0), // Track subtitle extraction retry attempts
  videoType: text("video_type").default('none'), // live, upcoming, none (from YouTube liveBroadcastContent)
}, (table) => ({
  // Essential index for getVideosForUser JOIN query (userChannels -> videos)
  channelCreatedIdx: index("idx_videos_channel_created").on(table.channelId, table.createdAt),
  // Essential index for getVideosByChannel query (channelId + publishedAt ordering)
  channelPublishedIdx: index("idx_videos_channel_published").on(table.channelId, table.publishedAt),
  // Index for finding live videos to check status
  videoTypeIdx: index("idx_videos_video_type").on(table.videoType),
}));

// User's subscribed channels (mapping table)
export const userChannels = pgTable("user_channels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  channelId: text("channel_id").notNull().references(() => youtubeChannels.channelId),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Essential index for findUsersByChannelId query
  channelIdIdx: index("idx_user_channels_channel_id").on(table.channelId),
  // Essential index for getUserChannels query  
  userIdIdx: index("idx_user_channels_user_id").on(table.userId),
  // Unique constraint serves as index + prevents duplicates
  userChannelUnique: uniqueIndex("idx_user_channels_unique").on(table.userId, table.channelId),
}));


// Popular channels cache (daily refresh)
export const popularChannels = pgTable("popular_channels", {
  rank: integer("rank").primaryKey(),
  channelId: text("channel_id").notNull().references(() => youtubeChannels.channelId),
  userSubscriberCount: integer("user_subscriber_count").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  channelIdIdx: index("idx_popular_channels_channel_id").on(table.channelId),
  channelUnique: uniqueIndex("idx_popular_channels_channel_unique").on(table.channelId),
}));

// Push notification tokens
export const pushTokens = pgTable("push_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  token: text("token").notNull(),
  deviceId: text("device_id").notNull(),
  platform: text("platform").notNull(), // 'ios' or 'android'
  appVersion: text("app_version").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  // Composite index for the most common query pattern (userId + isActive)
  userActiveIdx: index("idx_push_tokens_user_active").on(table.userId, table.isActive),
  // Index for device-based operations
  deviceIdIdx: index("idx_push_tokens_device_id").on(table.deviceId),
  // Unique constraint for userId + deviceId to prevent duplicates
  userDeviceUnique: uniqueIndex("idx_push_tokens_user_device_unique").on(table.userId, table.deviceId),
}));

export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { withTimezone: true, precision: 6 }).notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  userChannels: many(userChannels),
  pushTokens: many(pushTokens),
}));

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, {
    fields: [pushTokens.userId],
    references: [users.id],
  }),
}));

export const youtubeChannelsRelations = relations(youtubeChannels, ({ many }) => ({
  userChannels: many(userChannels),
  videos: many(videos),
  popularChannels: many(popularChannels),
}));

export const videosRelations = relations(videos, ({ one }) => ({
  channel: one(youtubeChannels, {
    fields: [videos.channelId],
    references: [youtubeChannels.channelId],
  }),
}));

export const userChannelsRelations = relations(userChannels, ({ one }) => ({
  user: one(users, {
    fields: [userChannels.userId],
    references: [users.id],
  }),
  youtubeChannel: one(youtubeChannels, {
    fields: [userChannels.channelId],
    references: [youtubeChannels.channelId],
  }),
}));

export const popularChannelsRelations = relations(popularChannels, ({ one }) => ({
  youtubeChannel: one(youtubeChannels, {
    fields: [popularChannels.channelId],
    references: [youtubeChannels.channelId],
  }),
}));


export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertYoutubeChannelSchema = createInsertSchema(youtubeChannels).omit({
  updatedAt: true,
});

export const insertVideoSchema = createInsertSchema(videos).omit({
  createdAt: true,
  // Make some new fields optional for backward compatibility
  processingStartedAt: true,
  processingCompletedAt: true,
  retryCount: true,
  videoType: true,
});

export const insertUserChannelSchema = createInsertSchema(userChannels).omit({
  id: true,
  createdAt: true,
});

export const insertPushTokenSchema = createInsertSchema(pushTokens).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserRole = User['role'];
export type InsertYoutubeChannel = z.infer<typeof insertYoutubeChannelSchema>;
export type YoutubeChannel = typeof youtubeChannels.$inferSelect;
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videos.$inferSelect;
export type InsertUserChannel = z.infer<typeof insertUserChannelSchema>;
export type UserChannel = typeof userChannels.$inferSelect;
export type InsertPopularChannel = typeof popularChannels.$inferInsert;
export type PopularChannel = typeof popularChannels.$inferSelect;
export type InsertPushToken = z.infer<typeof insertPushTokenSchema>;
export type PushToken = typeof pushTokens.$inferSelect;
