// @ts-ignore - youtube-captions-scraper doesn't have types
import { getSubtitles } from 'youtube-captions-scraper';

export interface CaptionData {
  start: number;
  dur: number;
  text: string;
}

export interface CaptionResponse {
  videoId: string;
  title?: string;
  captions: CaptionData[];
  language: string;
  auto: boolean; // 자동 생성 자막인지 여부
}

export class YoutubeCaptionsService {
  private extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
      /^([a-zA-Z0-9_-]{11})$/ // 직접 비디오 ID를 입력한 경우
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  async getCaptions(videoUrl: string): Promise<CaptionResponse> {
    const videoId = this.extractVideoId(videoUrl);
    
    if (!videoId) {
      throw new Error('유효하지 않은 유튜브 URL입니다.');
    }

    try {
      // 1. 먼저 한글 수동 자막을 시도
      console.log(`[CAPTIONS] Trying to get Korean manual captions for video: ${videoId}`);
      let captions = await this.tryGetCaptions(videoId, 'ko', false);
      
      if (captions.length > 0) {
        console.log(`[CAPTIONS] Found Korean manual captions: ${captions.length} entries`);
        return {
          videoId,
          captions,
          language: 'ko',
          auto: false
        };
      }

      // 2. 한글 자동 자막 시도
      console.log(`[CAPTIONS] Trying to get Korean auto captions for video: ${videoId}`);
      captions = await this.tryGetCaptions(videoId, 'ko', true);
      
      if (captions.length > 0) {
        console.log(`[CAPTIONS] Found Korean auto captions: ${captions.length} entries`);
        return {
          videoId,
          captions,
          language: 'ko',
          auto: true
        };
      }

      // 3. 영어 수동 자막 시도
      console.log(`[CAPTIONS] Trying to get English manual captions for video: ${videoId}`);
      captions = await this.tryGetCaptions(videoId, 'en', false);
      
      if (captions.length > 0) {
        console.log(`[CAPTIONS] Found English manual captions: ${captions.length} entries`);
        return {
          videoId,
          captions,
          language: 'en',
          auto: false
        };
      }

      // 4. 영어 자동 자막 시도
      console.log(`[CAPTIONS] Trying to get English auto captions for video: ${videoId}`);
      captions = await this.tryGetCaptions(videoId, 'en', true);
      
      if (captions.length > 0) {
        console.log(`[CAPTIONS] Found English auto captions: ${captions.length} entries`);
        return {
          videoId,
          captions,
          language: 'en',
          auto: true
        };
      }

      throw new Error('해당 영상에서 사용 가능한 자막을 찾을 수 없습니다.');

    } catch (error) {
      console.error('[CAPTIONS] Error getting captions:', error);
      if (error instanceof Error) {
        throw new Error(`자막 추출 중 오류가 발생했습니다: ${error.message}`);
      }
      throw new Error('자막 추출 중 알 수 없는 오류가 발생했습니다.');
    }
  }

  private async tryGetCaptions(videoId: string, lang: string, auto: boolean): Promise<CaptionData[]> {
    try {
      const result = await getSubtitles({
        videoID: videoId,
        lang: lang,
        auto: auto
      });

      if (!result || !Array.isArray(result)) {
        return [];
      }

      return result.map((item: any) => ({
        start: parseFloat(item.start) || 0,
        dur: parseFloat(item.dur) || 0,
        text: (item.text || '').replace(/<[^>]*>/g, '').trim() // HTML 태그 제거
      })).filter(item => item.text.length > 0);

    } catch (error) {
      console.log(`[CAPTIONS] Failed to get ${auto ? 'auto' : 'manual'} captions for lang ${lang}:`, error);
      return [];
    }
  }

  formatCaptionsAsText(captions: CaptionData[]): string {
    return captions.map((caption, index) => {
      const startTime = this.formatTime(caption.start);
      return `[${startTime}] ${caption.text}`;
    }).join('\n');
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}

export const youtubeCaptionsService = new YoutubeCaptionsService();