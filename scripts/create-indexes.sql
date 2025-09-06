-- Performance optimization indexes for push notification queries
-- Run this script to improve query performance

-- Index for user_channels.channelId (used in findUsersByChannelId)
CREATE INDEX IF NOT EXISTS idx_user_channels_channel_id 
ON user_channels(channel_id);

-- Index for user_channels.userId (used in getUserChannels and subscriptions)
CREATE INDEX IF NOT EXISTS idx_user_channels_user_id 
ON user_channels(user_id);

-- Composite index for push_tokens (userId + isActive) - most common query pattern
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active 
ON push_tokens(user_id, is_active) 
WHERE is_active = true;

-- Index for push_tokens.deviceId (used in token management operations)
CREATE INDEX IF NOT EXISTS idx_push_tokens_device_id 
ON push_tokens(device_id);

-- Index for push_tokens.userId (general user token queries)
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id 
ON push_tokens(user_id);

-- Composite index for videos queries (channelId + createdAt for ordering)
CREATE INDEX IF NOT EXISTS idx_videos_channel_created 
ON videos(channel_id, created_at DESC);

-- Index for videos.publishedAt (used in user video feeds with ordering)
CREATE INDEX IF NOT EXISTS idx_videos_published_at 
ON videos(published_at DESC);

-- Display index information
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('user_channels', 'push_tokens', 'videos', 'youtube_channels')
ORDER BY tablename, indexname;