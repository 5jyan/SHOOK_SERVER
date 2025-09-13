import { google, youtube_v3 } from 'googleapis';
import { logWithTimestamp, errorWithTimestamp } from './timestamp.js';

export class YouTubeAPIUtils {
  private youtube: youtube_v3.Youtube;

  constructor() {
    if (!process.env.YOUTUBE_API_KEY) {
      throw new Error('YOUTUBE_API_KEY is not set in environment variables');
    }

    this.youtube = google.youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY,
    });
  }

  /**
   * Check if a video is a live stream by checking its broadcast content
   * @param videoId YouTube video ID
   * @returns true if video is live stream, false otherwise
   */
  async isLiveStream(videoId: string): Promise<boolean> {
    try {
      logWithTimestamp(`[YOUTUBE_API_UTILS] Checking if video ${videoId} is live stream`);

      const response = await this.youtube.videos.list({
        part: ['snippet', 'liveStreamingDetails'],
        id: [videoId],
      });

      if (!response.data.items || response.data.items.length === 0) {
        logWithTimestamp(`[YOUTUBE_API_UTILS] Video ${videoId} not found`);
        return false;
      }

      const video = response.data.items[0];
      const snippet = video.snippet;
      const liveStreamingDetails = video.liveStreamingDetails;

      // Check if video has live streaming details or if liveBroadcastContent indicates it's live
      const isLive = snippet?.liveBroadcastContent === 'live' ||
                    snippet?.liveBroadcastContent === 'upcoming' ||
                    !!liveStreamingDetails;

      if (isLive) {
        logWithTimestamp(
          `[YOUTUBE_API_UTILS] Video ${videoId} is live stream - liveBroadcastContent: ${snippet?.liveBroadcastContent}, hasLiveStreamingDetails: ${!!liveStreamingDetails}`
        );
      } else {
        logWithTimestamp(`[YOUTUBE_API_UTILS] Video ${videoId} is not live stream`);
      }

      return isLive;
    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_API_UTILS] Error checking live stream status for video ${videoId}:`, error);

      // In case of API error, we'll assume it's not a live stream and allow processing
      // This prevents API errors from blocking regular video processing
      return false;
    }
  }
}

export const youtubeApiUtils = new YouTubeAPIUtils();