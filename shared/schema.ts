import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  channelId: text("channel_id").notNull().unique(),
  handle: text("handle").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  thumbnail: text("thumbnail"),
  subscriberCount: text("subscriber_count"),
  videoCount: text("video_count"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  channels: many(channels),
}));

export const channelsRelations = relations(channels, ({ one }) => ({
  user: one(users, {
    fields: [channels.userId],
    references: [users.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertChannelSchema = createInsertSchema(channels).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channels.$inferSelect;
