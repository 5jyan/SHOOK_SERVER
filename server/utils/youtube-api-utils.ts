import { google, youtube_v3 } from 'googleapis';
import { logWithTimestamp, errorWithTimestamp } from './timestamp.js';
import { errorLogger } from '../services/error-logging-service.js';

export type VideoType = 'live' | 'upcoming' | 'none';

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
   * Get video type by checking its broadcast content
   * @param videoId YouTube video ID
   * @returns 'live' | 'upcoming' | 'none'
   */
  async getVideoType(videoId: string): Promise<VideoType> {
    try {
      logWithTimestamp(`[YOUTUBE_API_UTILS] Getting video type for ${videoId}`);

      const response = await this.youtube.videos.list({
        part: ['snippet'],
        id: [videoId],
      });

      if (!response.data.items || response.data.items.length === 0) {
        logWithTimestamp(`[YOUTUBE_API_UTILS] Video ${videoId} not found, defaulting to none`);
        return 'none';
      }

      const video = response.data.items[0];
      const liveBroadcastContent = video.snippet?.liveBroadcastContent;

      const videoType: VideoType =
        liveBroadcastContent === 'live' ? 'live' :
        liveBroadcastContent === 'upcoming' ? 'upcoming' :
        'none';

      logWithTimestamp(
        `[YOUTUBE_API_UTILS] Video ${videoId} type: ${videoType} (liveBroadcastContent: ${liveBroadcastContent})`
      );

      return videoType;
    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_API_UTILS] Error getting video type for ${videoId}:`, error);

      // Send to Slack for critical errors like quota exceeded
      await errorLogger.logError(error as Error, {
        service: 'YouTubeAPIUtils',
        operation: 'getVideoType',
        additionalInfo: {
          videoId,
          errorType: 'YouTube API Error',
          possibleCause: 'Quota exceeded or network error'
        }
      });

      // In case of API error, default to 'none' to allow processing
      return 'none';
    }
  }
}

export const youtubeApiUtils = new YouTubeAPIUtils();