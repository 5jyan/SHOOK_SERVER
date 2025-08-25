/**
 * Database cleanup script to decode HTML entities in existing data
 * Run this once to fix &quot; and other HTML entities in titles and summaries
 */

import { db } from "../lib/db.js";
import { videos, youtubeChannels } from "../../shared/schema.js";
import { decodeYouTubeTitle, decodeYouTubeSummary, decodeHtmlEntities } from "./html-decode.js";
import { logWithTimestamp, errorWithTimestamp } from "./timestamp.js";

export async function fixHtmlEntitiesInDatabase() {
  logWithTimestamp('🔧 [HTML_ENTITY_FIX] Starting database cleanup...');
  
  let videosFixed = 0;
  let channelsFixed = 0;
  
  try {
    // Fix HTML entities in video titles and summaries
    logWithTimestamp('📹 [HTML_ENTITY_FIX] Processing videos...');
    const allVideos = await db.select().from(videos);
    
    for (const video of allVideos) {
      let needsUpdate = false;
      const updates: any = {};
      
      // Check if title contains HTML entities
      const decodedTitle = decodeYouTubeTitle(video.title);
      if (decodedTitle !== video.title) {
        updates.title = decodedTitle;
        needsUpdate = true;
        logWithTimestamp(`📹 [HTML_ENTITY_FIX] Video ${video.videoId}: "${video.title}" → "${decodedTitle}"`);
      }
      
      // Check if summary contains HTML entities
      if (video.summary) {
        const decodedSummary = decodeYouTubeSummary(video.summary);
        if (decodedSummary !== video.summary) {
          updates.summary = decodedSummary;
          needsUpdate = true;
          logWithTimestamp(`📹 [HTML_ENTITY_FIX] Video ${video.videoId}: Summary updated (${video.summary.length} chars)`);
        }
      }
      
      // Update if needed
      if (needsUpdate) {
        await db
          .update(videos)
          .set(updates)
          .where({ videoId: video.videoId } as any);
        videosFixed++;
      }
    }
    
    // Fix HTML entities in channel titles and descriptions
    logWithTimestamp('📺 [HTML_ENTITY_FIX] Processing channels...');
    const allChannels = await db.select().from(youtubeChannels);
    
    for (const channel of allChannels) {
      let needsUpdate = false;
      const updates: any = {};
      
      // Check if title contains HTML entities
      const decodedTitle = decodeYouTubeTitle(channel.title);
      if (decodedTitle !== channel.title) {
        updates.title = decodedTitle;
        needsUpdate = true;
        logWithTimestamp(`📺 [HTML_ENTITY_FIX] Channel ${channel.channelId}: "${channel.title}" → "${decodedTitle}"`);
      }
      
      // Check if description contains HTML entities
      if (channel.description) {
        const decodedDescription = decodeHtmlEntities(channel.description);
        if (decodedDescription !== channel.description) {
          updates.description = decodedDescription;
          needsUpdate = true;
          logWithTimestamp(`📺 [HTML_ENTITY_FIX] Channel ${channel.channelId}: Description updated`);
        }
      }
      
      // Update if needed
      if (needsUpdate) {
        await db
          .update(youtubeChannels)
          .set(updates)
          .where({ channelId: channel.channelId } as any);
        channelsFixed++;
      }
    }
    
    logWithTimestamp(`✅ [HTML_ENTITY_FIX] Database cleanup completed!`);
    logWithTimestamp(`📊 [HTML_ENTITY_FIX] Summary:`);
    logWithTimestamp(`   - Videos fixed: ${videosFixed}/${allVideos.length}`);
    logWithTimestamp(`   - Channels fixed: ${channelsFixed}/${allChannels.length}`);
    
    return {
      videosProcessed: allVideos.length,
      videosFixed,
      channelsProcessed: allChannels.length,
      channelsFixed
    };
    
  } catch (error) {
    errorWithTimestamp('❌ [HTML_ENTITY_FIX] Error during database cleanup:', error);
    throw error;
  }
}

// Run cleanup if this script is executed directly
// Disabled for now to prevent accidental execution during server startup
// if (import.meta.url === `file://${process.argv[1]}`) {
//   fixHtmlEntitiesInDatabase()
//     .then((result) => {
//       logWithTimestamp('🎉 [HTML_ENTITY_FIX] Cleanup completed successfully:', result);
//       process.exit(0);
//     })
//     .catch((error) => {
//       errorWithTimestamp('💥 [HTML_ENTITY_FIX] Cleanup failed:', error);
//       process.exit(1);
//     });
// }