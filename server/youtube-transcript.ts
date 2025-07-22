/**
 * YouTube 자막 추출을 위한 대안 접근법
 * youtube-transcript API나 직접 자막 URL 파싱 사용
 */

import { CaptionSegment } from './youtube-captions';

export class YoutubeTranscriptExtractor {
  
  /**
   * YouTube 자막 트랙 정보를 직접 파싱하여 가져오기
   */
  async extractTranscript(videoId: string, language: string = 'ko'): Promise<CaptionSegment[]> {
    console.log(`[YOUTUBE_TRANSCRIPT] Starting transcript extraction for video: ${videoId}`);
    
    try {
      // 1. 먼저 YouTube 영상 페이지에서 자막 정보 추출 시도
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(`[YOUTUBE_TRANSCRIPT] Fetching video page: ${videoUrl}`);
      
      const response = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch video page: ${response.status}`);
      }
      
      const html = await response.text();
      console.log(`[YOUTUBE_TRANSCRIPT] Received ${html.length} characters of HTML`);
      
      // 2. 자막 트랙 URL 찾기
      const captionTracks = this.extractCaptionTracks(html);
      console.log(`[YOUTUBE_TRANSCRIPT] Found ${captionTracks.length} caption tracks`);
      
      if (captionTracks.length === 0) {
        console.log(`[YOUTUBE_TRANSCRIPT] No captions available for this video`);
        return [{
          timestamp: "0:00",
          text: "이 영상에는 자막이 제공되지 않습니다.",
          start: 0,
          duration: 0
        }];
      }
      
      // 3. 요청된 언어나 기본 언어의 자막 선택
      const selectedTrack = this.selectBestTrack(captionTracks, language);
      if (!selectedTrack) {
        console.log(`[YOUTUBE_TRANSCRIPT] No suitable caption track found`);
        return [{
          timestamp: "0:00",
          text: `요청한 언어(${language})의 자막을 찾을 수 없습니다.`,
          start: 0,
          duration: 0
        }];
      }
      
      console.log(`[YOUTUBE_TRANSCRIPT] Selected track: ${selectedTrack.name} (${selectedTrack.languageCode})`);
      
      // 4. 자막 데이터 다운로드 및 파싱
      return await this.downloadAndParseCaptions(selectedTrack.baseUrl);
      
    } catch (error) {
      console.error(`[YOUTUBE_TRANSCRIPT] Error extracting transcript:`, error);
      return [{
        timestamp: "0:00",
        text: `자막 추출 중 오류 발생: ${error.message}`,
        start: 0,
        duration: 0
      }];
    }
  }
  
  /**
   * HTML에서 자막 트랙 정보 추출
   */
  private extractCaptionTracks(html: string): any[] {
    console.log(`[YOUTUBE_TRANSCRIPT] Parsing caption tracks from HTML`);
    
    try {
      // 자막 정보가 포함된 JSON 데이터 찾기
      const captionRegex = /"captionTracks":\s*(\[.*?\])/;
      const match = html.match(captionRegex);
      
      if (!match) {
        console.log(`[YOUTUBE_TRANSCRIPT] No captionTracks found in HTML`);
        return [];
      }
      
      const captionTracks = JSON.parse(match[1]);
      console.log(`[YOUTUBE_TRANSCRIPT] Parsed ${captionTracks.length} caption tracks`);
      
      return captionTracks;
    } catch (error) {
      console.error(`[YOUTUBE_TRANSCRIPT] Error parsing caption tracks:`, error);
      return [];
    }
  }
  
  /**
   * 최적의 자막 트랙 선택
   */
  private selectBestTrack(tracks: any[], preferredLanguage: string): any {
    console.log(`[YOUTUBE_TRANSCRIPT] Selecting best track for language: ${preferredLanguage}`);
    
    // 1. 요청된 언어로 시작하는 트랙 찾기
    let selected = tracks.find(track => 
      track.languageCode === preferredLanguage
    );
    
    if (selected) {
      console.log(`[YOUTUBE_TRANSCRIPT] Found exact language match: ${selected.name}`);
      return selected;
    }
    
    // 2. 한국어 트랙 찾기
    selected = tracks.find(track => 
      track.languageCode === 'ko' || 
      track.languageCode.startsWith('ko')
    );
    
    if (selected) {
      console.log(`[YOUTUBE_TRANSCRIPT] Found Korean track: ${selected.name}`);
      return selected;
    }
    
    // 3. 영어 트랙 찾기
    selected = tracks.find(track => 
      track.languageCode === 'en' || 
      track.languageCode.startsWith('en')
    );
    
    if (selected) {
      console.log(`[YOUTUBE_TRANSCRIPT] Found English track: ${selected.name}`);
      return selected;
    }
    
    // 4. 첫 번째 트랙 사용
    if (tracks.length > 0) {
      selected = tracks[0];
      console.log(`[YOUTUBE_TRANSCRIPT] Using first available track: ${selected.name}`);
      return selected;
    }
    
    return null;
  }
  
  /**
   * 자막 데이터 다운로드 및 파싱
   */
  private async downloadAndParseCaptions(captionUrl: string): Promise<CaptionSegment[]> {
    console.log(`[YOUTUBE_TRANSCRIPT] Downloading captions from: ${captionUrl}`);
    
    try {
      const response = await fetch(captionUrl);
      if (!response.ok) {
        throw new Error(`Failed to download captions: ${response.status}`);
      }
      
      const xmlData = await response.text();
      console.log(`[YOUTUBE_TRANSCRIPT] Received ${xmlData.length} characters of caption data`);
      
      return this.parseXMLCaptions(xmlData);
      
    } catch (error) {
      console.error(`[YOUTUBE_TRANSCRIPT] Error downloading captions:`, error);
      throw error;
    }
  }
  
  /**
   * XML 자막 데이터 파싱
   */
  private parseXMLCaptions(xmlData: string): CaptionSegment[] {
    console.log(`[YOUTUBE_TRANSCRIPT] Parsing XML caption data`);
    
    try {
      const segments: CaptionSegment[] = [];
      
      // 간단한 XML 파싱 (text 태그 추출)
      const textRegex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([^<]*)<\/text>/g;
      let match;
      
      while ((match = textRegex.exec(xmlData)) !== null) {
        const start = parseFloat(match[1]);
        const duration = parseFloat(match[2]);
        const text = match[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();
        
        if (text) {
          segments.push({
            timestamp: this.formatTimestamp(start),
            text: text,
            start: start,
            duration: duration
          });
        }
      }
      
      console.log(`[YOUTUBE_TRANSCRIPT] Parsed ${segments.length} caption segments`);
      return segments;
      
    } catch (error) {
      console.error(`[YOUTUBE_TRANSCRIPT] Error parsing XML:`, error);
      return [{
        timestamp: "0:00",
        text: "자막 데이터 파싱 중 오류가 발생했습니다.",
        start: 0,
        duration: 0
      }];
    }
  }
  
  /**
   * 초를 MM:SS 형식으로 변환
   */
  private formatTimestamp(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}