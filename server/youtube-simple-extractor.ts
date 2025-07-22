/**
 * 간단하고 빠른 YouTube 정보 추출기
 * Puppeteer 없이 작동하는 대안 방법
 */

export interface SimpleCaptionInfo {
  timestamp: string;
  text: string;
  start: number;
  duration: number;
}

export class YoutubeSimpleExtractor {
  
  /**
   * YouTube oEmbed API를 사용한 기본 정보 추출
   */
  async extractVideoInfo(videoId: string): Promise<SimpleCaptionInfo[]> {
    console.log(`[SIMPLE_EXTRACTOR] Starting extraction for video: ${videoId}`);
    
    try {
      // 1. oEmbed API 시도
      console.log(`[SIMPLE_EXTRACTOR] Step 1: Trying oEmbed API...`);
      const oembedUrl = `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`;
      
      const response = await fetch(oembedUrl);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[SIMPLE_EXTRACTOR] oEmbed success:`, data);
        
        return [{
          timestamp: "0:00",
          text: `📺 ${data.title}\n👤 채널: ${data.author_name}\n\n⚠️ 현재 Replit 환경에서 브라우저 자동화 도구에 문제가 발생하여 자막 추출이 제한됩니다. 영상의 기본 정보만 표시됩니다.`,
          start: 0,
          duration: 0
        }];
      }
    } catch (error: any) {
      console.log(`[SIMPLE_EXTRACTOR] oEmbed failed:`, error.message);
    }
    
    try {
      // 2. 직접 HTML 페이지 접근 시도
      console.log(`[SIMPLE_EXTRACTOR] Step 2: Trying direct HTML extraction...`);
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      const response = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.ok) {
        const html = await response.text();
        console.log(`[SIMPLE_EXTRACTOR] HTML response received: ${html.length} characters`);
        
        // 제목 추출
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : '제목 추출 실패';
        
        // 채널명 추출 시도
        const channelMatch = html.match(/"ownerText":{"runs":\[{"text":"([^"]+)"/);
        const channel = channelMatch ? channelMatch[1] : '채널명 추출 실패';
        
        console.log(`[SIMPLE_EXTRACTOR] Extracted - Title: ${title}, Channel: ${channel}`);
        
        return [{
          timestamp: "0:00",
          text: `📺 ${title}\n👤 채널: ${channel}\n\n⚠️ 현재 환경에서는 자막 추출이 제한됩니다. 브라우저 자동화 도구의 리소스 문제로 인해 영상의 기본 정보만 제공됩니다.`,
          start: 0,
          duration: 0
        }];
      }
    } catch (error: any) {
      console.log(`[SIMPLE_EXTRACTOR] HTML extraction failed:`, error.message);
    }
    
    // 3. 최종 대안 - 영상 ID만 표시
    console.log(`[SIMPLE_EXTRACTOR] Using fallback method`);
    return [{
      timestamp: "0:00",
      text: `🎥 YouTube 영상 (ID: ${videoId})\n\n⚠️ 현재 Replit 환경의 브라우저 제약으로 인해 상세한 자막 추출이 불가능합니다.\n\n💡 해결책: \n1. 영상을 직접 열어서 자막을 확인해주세요\n2. 또는 다른 환경에서 다시 시도해주세요`,
      start: 0,
      duration: 0
    }];
  }
  
  /**
   * 영상 ID 유효성 검사
   */
  validateVideoId(videoId: string): boolean {
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
  }
  
  /**
   * URL에서 영상 ID 추출
   */
  extractVideoIdFromUrl(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }
}