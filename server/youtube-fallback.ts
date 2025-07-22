/**
 * YouTube 자막 추출의 대안 방법들
 * Puppeteer가 실패할 경우 사용할 백업 방법
 */

import { CaptionSegment } from './youtube-captions';

export class YoutubeFallbackExtractor {
  
  /**
   * 간단한 HTML 파싱을 통한 제목 추출 (최소 정보)
   */
  async extractBasicInfo(videoId: string): Promise<CaptionSegment[]> {
    console.log(`[YOUTUBE_FALLBACK] Attempting basic video info extraction for: ${videoId}`);
    
    try {
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      console.log(`[YOUTUBE_FALLBACK] Fetching video page HTML...`);
      const response = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const html = await response.text();
      console.log(`[YOUTUBE_FALLBACK] Received ${html.length} characters of HTML`);
      
      // 제목 추출 시도
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : '제목 추출 실패';
      
      console.log(`[YOUTUBE_FALLBACK] Extracted title: ${title}`);
      
      return [{
        timestamp: "0:00",
        text: `영상 제목: "${title}" - 자막 추출을 위해서는 브라우저 환경이 필요합니다.`,
        start: 0,
        duration: 0
      }];
      
    } catch (error) {
      console.error(`[YOUTUBE_FALLBACK] Basic extraction failed:`, error);
      
      return [{
        timestamp: "0:00", 
        text: `영상 ID: ${videoId} - 자막 추출에 실패했습니다. 브라우저 환경 문제로 인해 현재 자막을 가져올 수 없습니다.`,
        start: 0,
        duration: 0
      }];
    }
  }
  
  /**
   * YouTube oEmbed API를 통한 기본 정보 추출
   */
  async extractOEmbedInfo(videoId: string): Promise<CaptionSegment[]> {
    console.log(`[YOUTUBE_FALLBACK] Trying oEmbed API for: ${videoId}`);
    
    try {
      const oembedUrl = `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`;
      
      const response = await fetch(oembedUrl);
      if (!response.ok) {
        throw new Error(`oEmbed API failed: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`[YOUTUBE_FALLBACK] oEmbed data:`, data);
      
      return [{
        timestamp: "0:00",
        text: `${data.title} (채널: ${data.author_name}) - 자막 추출을 위해서는 고급 브라우저 기능이 필요합니다.`,
        start: 0,
        duration: 0
      }];
      
    } catch (error) {
      console.error(`[YOUTUBE_FALLBACK] oEmbed extraction failed:`, error);
      return this.extractBasicInfo(videoId);
    }
  }
}