import puppeteer from 'puppeteer';

interface CaptionSegment {
  timestamp: string;
  text: string;
  start: number;
  duration: number;
}

export class YouTubeCaptionExtractor {
  private async getBrowser() {
    console.log(`[PUPPETEER_CAPTIONS] Launching browser...`);
    
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ],
      timeout: 15000
    });
    
    console.log(`[PUPPETEER_CAPTIONS] Browser launched successfully`);
    return browser;
  }

  async extractCaptions(videoId: string, language: string = 'ko'): Promise<CaptionSegment[]> {
    console.log(`[PUPPETEER_CAPTIONS] Starting extraction for ${videoId} (${language})`);
    
    let browser;
    try {
      browser = await this.getBrowser();
      const page = await browser.newPage();
      
      // 더 현실적인 User Agent 설정
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
      
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(`[PUPPETEER_CAPTIONS] Navigating to ${videoUrl}`);
      
      // 페이지 로드
      await page.goto(videoUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      console.log(`[PUPPETEER_CAPTIONS] Page loaded, waiting for video player...`);
      
      // 비디오 플레이어가 로드될 때까지 대기
      await page.waitForSelector('#movie_player', { timeout: 20000 });
      console.log(`[PUPPETEER_CAPTIONS] Video player found`);
      
      // 동영상 제목과 채널명 가져오기
      const videoInfo = await page.evaluate(() => {
        const titleElement = document.querySelector('#title h1 yt-formatted-string');
        const channelElement = document.querySelector('#owner #channel-name a');
        
        return {
          title: titleElement?.textContent?.trim() || 'Unknown Title',
          channel: channelElement?.textContent?.trim() || 'Unknown Channel'
        };
      });
      
      console.log(`[PUPPETEER_CAPTIONS] Video: "${videoInfo.title}" by ${videoInfo.channel}`);
      
      // 스크립트 태그에서 자막 정보 추출 시도
      const captionTracks = await this.extractCaptionTracksFromHTML(page);
      
      if (captionTracks.length > 0) {
        console.log(`[PUPPETEER_CAPTIONS] Found ${captionTracks.length} caption tracks`);
        
        // 한국어 자막 우선 선택
        let selectedTrack = captionTracks.find(track => 
          track.languageCode === 'ko' || 
          track.languageCode === language ||
          track.name?.includes('한국어')
        );
        
        // 한국어가 없으면 첫 번째 트랙 사용
        if (!selectedTrack) {
          selectedTrack = captionTracks[0];
        }
        
        console.log(`[PUPPETEER_CAPTIONS] Selected track: ${selectedTrack.name || selectedTrack.languageCode}`);
        
        // 자막 데이터 다운로드
        const captions = await this.downloadCaptionData(page, selectedTrack.baseUrl);
        
        if (captions.length > 0) {
          console.log(`[PUPPETEER_CAPTIONS] Successfully extracted ${captions.length} caption segments`);
          return captions;
        }
      }
      
      // 자막이 없는 경우 기본 정보 반환
      console.log(`[PUPPETEER_CAPTIONS] No captions available, returning video info`);
      return [{
        timestamp: '0:00',
        text: `${videoInfo.title} (채널: ${videoInfo.channel}) - 이 영상에는 자막이 제공되지 않습니다.`,
        start: 0,
        duration: 0
      }];
      
    } catch (error) {
      console.error(`[PUPPETEER_CAPTIONS] Error during extraction:`, error);
      return [{
        timestamp: '0:00',
        text: `자막 추출 중 오류가 발생했습니다: ${error.message}`,
        start: 0,
        duration: 0
      }];
    } finally {
      if (browser) {
        await browser.close();
        console.log(`[PUPPETEER_CAPTIONS] Browser closed`);
      }
    }
  }

  private async extractCaptionTracksFromHTML(page: any): Promise<any[]> {
    try {
      console.log(`[PUPPETEER_CAPTIONS] Extracting caption tracks from page HTML...`);
      
      const tracks = await page.evaluate(() => {
        // ytInitialPlayerResponse에서 자막 정보 찾기
        const scripts = document.querySelectorAll('script');
        
        for (const script of scripts) {
          const content = script.textContent || '';
          
          if (content.includes('ytInitialPlayerResponse')) {
            try {
              // ytInitialPlayerResponse 추출
              const match = content.match(/var ytInitialPlayerResponse = ({.*?});/);
              if (match) {
                const playerResponse = JSON.parse(match[1]);
                
                const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                if (captions && Array.isArray(captions)) {
                  return captions.map((track: any) => ({
                    languageCode: track.languageCode,
                    name: track.name?.simpleText || track.name?.runs?.[0]?.text,
                    baseUrl: track.baseUrl
                  }));
                }
              }
            } catch (e) {
              console.log('Error parsing player response:', e);
            }
          }
        }
        
        return [];
      });
      
      console.log(`[PUPPETEER_CAPTIONS] Found ${tracks.length} caption tracks`);
      return tracks;
      
    } catch (error) {
      console.log(`[PUPPETEER_CAPTIONS] Error extracting caption tracks: ${error.message}`);
      return [];
    }
  }

  private async downloadCaptionData(page: any, baseUrl: string): Promise<CaptionSegment[]> {
    try {
      console.log(`[PUPPETEER_CAPTIONS] Downloading caption data from: ${baseUrl}`);
      
      // URL에 필요한 파라미터 추가
      const captionUrl = baseUrl + '&fmt=srv3';
      
      const response = await page.evaluate(async (url: string) => {
        try {
          const response = await fetch(url);
          const text = await response.text();
          return { success: true, data: text };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, captionUrl);
      
      if (!response.success) {
        console.log(`[PUPPETEER_CAPTIONS] Failed to fetch caption data: ${response.error}`);
        return [];
      }
      
      console.log(`[PUPPETEER_CAPTIONS] Downloaded ${response.data.length} characters of caption data`);
      
      // XML 파싱 및 자막 추출
      const captions = this.parseCaptionXML(response.data);
      
      console.log(`[PUPPETEER_CAPTIONS] Parsed ${captions.length} caption segments`);
      return captions;
      
    } catch (error) {
      console.log(`[PUPPETEER_CAPTIONS] Error downloading caption data: ${error.message}`);
      return [];
    }
  }

  private parseCaptionXML(xmlData: string): CaptionSegment[] {
    try {
      console.log(`[PUPPETEER_CAPTIONS] Parsing caption XML...`);
      
      const captions: CaptionSegment[] = [];
      
      // <text> 태그에서 자막 추출
      const textMatches = xmlData.match(/<text[^>]*>(.*?)<\/text>/g);
      
      if (textMatches) {
        textMatches.forEach((match, index) => {
          // start 속성 추출
          const startMatch = match.match(/start="([^"]*)"/);
          const start = startMatch ? parseFloat(startMatch[1]) : index * 5;
          
          // dur 속성 추출
          const durMatch = match.match(/dur="([^"]*)"/);
          const duration = durMatch ? parseFloat(durMatch[1]) : 5;
          
          // 텍스트 내용 추출 (HTML 태그 제거)
          const textContent = match.replace(/<text[^>]*>/, '').replace(/<\/text>/, '').replace(/<[^>]*>/g, '').trim();
          
          if (textContent) {
            const minutes = Math.floor(start / 60);
            const seconds = Math.floor(start % 60);
            const timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            captions.push({
              timestamp,
              text: textContent,
              start,
              duration
            });
          }
        });
      }
      
      console.log(`[PUPPETEER_CAPTIONS] Successfully parsed ${captions.length} caption segments`);
      return captions;
      
    } catch (error) {
      console.log(`[PUPPETEER_CAPTIONS] Error parsing XML: ${error.message}`);
      return [];
    }
  }
}

export { CaptionSegment };