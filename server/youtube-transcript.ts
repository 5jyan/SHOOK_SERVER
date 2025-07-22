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
      let captionTracks = [];
      
      // 1. 일반 자막 트랙 찾기
      const captionRegex = /"captionTracks":\s*(\[.*?\])/;
      const captionMatch = html.match(captionRegex);
      
      if (captionMatch) {
        const tracks = JSON.parse(captionMatch[1]);
        captionTracks = captionTracks.concat(tracks);
        console.log(`[YOUTUBE_TRANSCRIPT] Found ${tracks.length} regular caption tracks`);
      }
      
      // 2. 자동 생성 자막 트랙 찾기
      const autoRegex = /"automaticCaptions":\s*(\{[^}]*\})/;
      const autoMatch = html.match(autoRegex);
      
      if (autoMatch) {
        try {
          const autoCaptions = JSON.parse(autoMatch[1]);
          console.log(`[YOUTUBE_TRANSCRIPT] Found automatic captions for languages:`, Object.keys(autoCaptions));
          
          // 각 언어의 자동 자막을 트랙으로 변환
          for (const [lang, tracks] of Object.entries(autoCaptions)) {
            if (Array.isArray(tracks) && tracks.length > 0) {
              const autoTrack = tracks[0]; // 첫 번째 트랙 사용
              captionTracks.push({
                ...autoTrack,
                languageCode: lang,
                name: `${lang} (자동 생성)`,
                kind: 'asr'
              });
            }
          }
        } catch (error) {
          console.log(`[YOUTUBE_TRANSCRIPT] Error parsing automatic captions:`, error);
        }
      }
      
      // 3. 대안 패턴으로 찾기
      if (captionTracks.length === 0) {
        const altRegex = /"timedtext"[^}]*"baseUrl":"([^"]*)"[^}]*"languageCode":"([^"]*)"/g;
        let altMatch;
        
        while ((altMatch = altRegex.exec(html)) !== null) {
          captionTracks.push({
            baseUrl: altMatch[1].replace(/\\u0026/g, '&'),
            languageCode: altMatch[2],
            name: `${altMatch[2]} (발견됨)`,
            kind: 'captions'
          });
        }
        
        console.log(`[YOUTUBE_TRANSCRIPT] Found ${captionTracks.length} tracks using alternative pattern`);
      }
      
      console.log(`[YOUTUBE_TRANSCRIPT] Total tracks found: ${captionTracks.length}`);
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
      // URL에 추가 매개변수를 더해서 시도
      const enhancedUrl = captionUrl + '&fmt=srv3';
      console.log(`[YOUTUBE_TRANSCRIPT] Trying enhanced URL: ${enhancedUrl}`);
      
      const response = await fetch(enhancedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,text/plain;q=0.8,image/png,*/*;q=0.5',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
        }
      });
      
      if (!response.ok) {
        console.log(`[YOUTUBE_TRANSCRIPT] Enhanced URL failed with ${response.status}, trying original URL`);
        
        // 원본 URL로 다시 시도
        const fallbackResponse = await fetch(captionUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        if (!fallbackResponse.ok) {
          throw new Error(`Both URLs failed: ${response.status} and ${fallbackResponse.status}`);
        }
        
        const xmlData = await fallbackResponse.text();
        console.log(`[YOUTUBE_TRANSCRIPT] Received ${xmlData.length} characters from fallback URL`);
        return this.parseXMLCaptions(xmlData);
      }
      
      const xmlData = await response.text();
      console.log(`[YOUTUBE_TRANSCRIPT] Received ${xmlData.length} characters of caption data`);
      
      if (xmlData.length === 0) {
        throw new Error('Empty caption data received');
      }
      
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