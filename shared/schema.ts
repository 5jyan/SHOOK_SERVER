import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  slackUserId: text("slack_user_id"),
  slackChannelId: text("slack_channel_id"),
  slackJoinedAt: timestamp("slack_joined_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// YouTube channel master data (shared across all users)
export const youtubeChannels = pgTable("youtube_channels", {
  channelId: text("channel_id").primaryKey(),
  handle: text("handle").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  thumbnail: text("thumbnail"),
  subscriberCount: text("subscriber_count"),
  videoCount: text("video_count"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User's subscribed channels (mapping table)
export const userChannels = pgTable("user_channels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  channelId: text("channel_id").notNull().references(() => youtubeChannels.channelId),
  createdAt: timestamp("created_at").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  userChannels: many(userChannels),
}));

export const youtubeChannelsRelations = relations(youtubeChannels, ({ many }) => ({
  userChannels: many(userChannels),
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

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertYoutubeChannelSchema = createInsertSchema(youtubeChannels).omit({
  updatedAt: true,
});

export const insertUserChannelSchema = createInsertSchema(userChannels).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertYoutubeChannel = z.infer<typeof insertYoutubeChannelSchema>;
export type YoutubeChannel = typeof youtubeChannels.$inferSelect;
export type InsertUserChannel = z.infer<typeof insertUserChannelSchema>;
export type UserChannel = typeof userChannels.$inferSelect;
