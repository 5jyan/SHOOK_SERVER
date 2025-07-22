import puppeteer from 'puppeteer';

export interface CaptionSegment {
  timestamp: string;
  text: string;
  start: number;
  duration: number;
}

export class YoutubeCaptionExtractor {
  private browser: puppeteer.Browser | null = null;

  constructor() {}

  /**
   * 브라우저 인스턴스를 초기화합니다
   */
  private async initBrowser(): Promise<puppeteer.Browser> {
    if (!this.browser) {
      console.log(`[YOUTUBE_CAPTIONS] Initializing Puppeteer browser...`);
      
      // Chromium 경로 찾기 - 여러 방법 시도
      let executablePath;
      try {
        const { execSync } = require('child_process');
        
        // 여러 명령어로 Chromium 찾기
        const commands = [
          'find /nix/store -name chromium -type f -executable 2>/dev/null | head -1',
          'which chromium 2>/dev/null',
          'which chromium-browser 2>/dev/null'
        ];

        for (const cmd of commands) {
          try {
            const result = execSync(cmd).toString().trim();
            if (result) {
              executablePath = result;
              console.log(`[YOUTUBE_CAPTIONS] Found Chromium at: ${executablePath}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        console.log(`[YOUTUBE_CAPTIONS] Error finding Chromium:`, error);
      }

      if (!executablePath) {
        console.log(`[YOUTUBE_CAPTIONS] Chromium not found, using default Puppeteer Chrome`);
      }
      
      try {
        this.browser = await puppeteer.launch({
          headless: true,
          executablePath: executablePath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-default-apps',
            '--disable-translate'
          ]
        });
        console.log(`[YOUTUBE_CAPTIONS] Browser initialized successfully`);
      } catch (error) {
        console.error(`[YOUTUBE_CAPTIONS] Failed to launch browser:`, error);
        throw error;
      }
    }
    return this.browser;
  }

  /**
   * 브라우저를 종료합니다
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      console.log(`[YOUTUBE_CAPTIONS] Closing browser...`);
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * 유튜브 영상 ID에서 자막을 추출합니다
   */
  async extractCaptions(videoId: string, language: string = 'ko'): Promise<CaptionSegment[]> {
    const browser = await this.initBrowser();
    const page = await browser.newPage();
    
    try {
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(`[YOUTUBE_CAPTIONS] Navigating to video: ${videoUrl}`);
      
      // User Agent 설정으로 봇 탐지 우회 시도
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
      
      // 페이지 로드
      await page.goto(videoUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      console.log(`[YOUTUBE_CAPTIONS] Page loaded successfully`);

      // 페이지가 완전히 로드될 때까지 대기
      await page.waitForSelector('#movie_player', { timeout: 15000 });
      console.log(`[YOUTUBE_CAPTIONS] Video player found`);
      
      // 페이지에서 더보기 버튼 클릭하여 description 확장
      try {
        const expandButton = await page.waitForSelector('#expand', { timeout: 5000 });
        if (expandButton) {
          await expandButton.click();
          console.log(`[YOUTUBE_CAPTIONS] Clicked expand button`);
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        console.log(`[YOUTUBE_CAPTIONS] Expand button not found or not clickable`);
      }

      // 전사본 버튼 찾기 및 클릭
      console.log(`[YOUTUBE_CAPTIONS] Looking for transcript button...`);
      
      const transcriptSelectors = [
        'yt-button-renderer[aria-label*="transcript" i]',
        'yt-button-renderer[aria-label*="전사본" i]',
        'button[aria-label*="transcript" i]',
        'button[aria-label*="전사본" i]',
        '[role="button"]:has-text("transcript")',
        '[role="button"]:has-text("전사본")',
        'tp-yt-paper-button:has-text("transcript")',
        'tp-yt-paper-button:has-text("전사본")'
      ];

      let transcriptFound = false;
      for (const selector of transcriptSelectors) {
        try {
          // 요소가 로드될 때까지 대기
          await page.waitForSelector(selector, { timeout: 3000 });
          
          // 요소가 보이고 클릭 가능한지 확인
          const isVisible = await page.evaluate(sel => {
            const element = document.querySelector(sel);
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }, selector);

          if (isVisible) {
            await page.click(selector);
            console.log(`[YOUTUBE_CAPTIONS] Successfully clicked transcript button with selector: ${selector}`);
            transcriptFound = true;
            await page.waitForTimeout(3000); // 전사본 패널이 로드될 때까지 대기
            break;
          }
        } catch (error) {
          console.log(`[YOUTUBE_CAPTIONS] Transcript selector ${selector} failed:`, error.message);
          continue;
        }
      }

      if (!transcriptFound) {
        console.log(`[YOUTUBE_CAPTIONS] No transcript button found. This video may not have captions.`);
        return [{
          timestamp: "0:00",
          text: "이 영상에는 자막이 없거나 자막 추출에 실패했습니다.",
          start: 0,
          duration: 0
        }];
      }

      // 전사본 패널에서 텍스트 추출
      console.log(`[YOUTUBE_CAPTIONS] Extracting transcript text...`);
      
      const captions = await page.evaluate(() => {
        // 다양한 전사본 selector 시도
        const transcriptSelectors = [
          'ytd-transcript-segment-renderer',
          '.ytd-transcript-segment-renderer',
          '[role="button"]:has(.segment-timestamp)',
          '.transcript-segment'
        ];
        
        let segments: any[] = [];
        
        for (const selector of transcriptSelectors) {
          const elements = document.querySelectorAll(selector);
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          
          if (elements.length > 0) {
            elements.forEach((item, index) => {
              // 시간 요소 찾기
              const timeElement = item.querySelector('.segment-timestamp') || 
                                item.querySelector('[class*="timestamp"]') ||
                                item.querySelector('span:first-child');
              
              // 텍스트 요소 찾기  
              const textElement = item.querySelector('.segment-text') ||
                                item.querySelector('[class*="text"]') ||
                                item.querySelector('span:last-child') ||
                                item;
              
              const timestamp = timeElement?.textContent?.trim() || `${index * 5}초`;
              const text = textElement?.textContent?.trim();
              
              if (text && text !== timestamp) {
                segments.push({
                  timestamp: timestamp,
                  text: text,
                  start: index * 5,
                  duration: 5
                });
              }
            });
            
            if (segments.length > 0) {
              console.log(`Successfully extracted ${segments.length} segments`);
              break;
            }
          }
        }
        
        // 전사본이 없는 경우 페이지 제목이라도 추출
        if (segments.length === 0) {
          const title = document.querySelector('h1.title, h1.style-scope.ytd-video-primary-info-renderer, #title h1')?.textContent?.trim();
          if (title) {
            segments.push({
              timestamp: "0:00",
              text: `제목: ${title} (자막을 찾을 수 없습니다)`,
              start: 0,
              duration: 0
            });
          }
        }
        
        return segments;
      });

      console.log(`[YOUTUBE_CAPTIONS] Extracted ${captions.length} caption segments`);
      
      if (captions.length === 0) {
        return [{
          timestamp: "0:00",
          text: "이 영상에는 자막이 없거나 자막 추출에 실패했습니다.",
          start: 0,
          duration: 0
        }];
      }

      return captions;

    } catch (error) {
      console.error(`[YOUTUBE_CAPTIONS] Error extracting captions:`, error);
      throw new Error(`자막 추출 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  /**
   * 유튜브 영상 ID의 유효성을 검사합니다
   */
  validateVideoId(videoId: string): boolean {
    const youtubeRegex = /^[a-zA-Z0-9_-]{11}$/;
    return youtubeRegex.test(videoId);
  }

  /**
   * URL에서 영상 ID를 추출합니다
   */
  extractVideoIdFromUrl(url: string): string | null {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }
}

// 싱글톤 인스턴스
export const youtubeCaptionExtractor = new YoutubeCaptionExtractor();