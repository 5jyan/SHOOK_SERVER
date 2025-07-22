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
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
      console.log(`[YOUTUBE_CAPTIONS] Browser initialized successfully`);
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
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // 페이지 로드
      await page.goto(videoUrl, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      });

      console.log(`[YOUTUBE_CAPTIONS] Page loaded successfully`);

      // 페이지가 완전히 로드될 때까지 대기
      await page.waitForSelector('video', { timeout: 10000 });
      
      // 자막 버튼 클릭 시도
      console.log(`[YOUTUBE_CAPTIONS] Attempting to enable captions...`);
      
      // 자막 활성화를 위한 여러 선택자 시도
      const captionSelectors = [
        'button[data-title-no-tooltip="자막"]',
        'button[data-title-no-tooltip="Subtitles"]',
        'button.ytp-subtitles-button',
        '.ytp-subtitles-button',
        '[aria-label*="자막"]',
        '[aria-label*="Subtitles"]'
      ];

      let captionsEnabled = false;
      for (const selector of captionSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 3000 });
          await page.click(selector);
          console.log(`[YOUTUBE_CAPTIONS] Clicked captions button with selector: ${selector}`);
          captionsEnabled = true;
          break;
        } catch (error) {
          console.log(`[YOUTUBE_CAPTIONS] Selector ${selector} not found, trying next...`);
          continue;
        }
      }

      if (!captionsEnabled) {
        console.log(`[YOUTUBE_CAPTIONS] Could not find captions button, trying alternative method...`);
        
        // 키보드 단축키로 자막 활성화 시도 (c 키)
        await page.click('video');
        await page.keyboard.press('c');
        console.log(`[YOUTUBE_CAPTIONS] Tried keyboard shortcut 'c' for captions`);
      }

      // 자막이 나타날 때까지 대기
      await page.waitForTimeout(2000);

      // 자막 텍스트 추출
      console.log(`[YOUTUBE_CAPTIONS] Extracting caption text...`);
      
      const captions = await page.evaluate(() => {
        const captionElements = document.querySelectorAll('.caption-window');
        const segments: CaptionSegment[] = [];
        
        captionElements.forEach((element, index) => {
          const text = element.textContent?.trim();
          if (text) {
            segments.push({
              timestamp: `${index * 2}s`, // 임시 타임스탬프
              text: text,
              start: index * 2,
              duration: 2
            });
          }
        });
        
        return segments;
      });

      // 대안: 영상의 전사본(transcript) 패널에서 추출 시도
      if (captions.length === 0) {
        console.log(`[YOUTUBE_CAPTIONS] No captions found in video player, trying transcript panel...`);
        
        // 더보기 버튼 클릭
        try {
          await page.click('#expand');
          await page.waitForTimeout(1000);
        } catch (e) {
          console.log(`[YOUTUBE_CAPTIONS] Could not click expand button`);
        }

        // 전사본 버튼 클릭 시도
        try {
          const transcriptSelectors = [
            'button[aria-label*="전사본"]',
            'button[aria-label*="transcript"]',
            'yt-button-renderer:has-text("전사본")',
            'yt-button-renderer:has-text("Transcript")'
          ];

          for (const selector of transcriptSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 3000 });
              await page.click(selector);
              console.log(`[YOUTUBE_CAPTIONS] Clicked transcript button`);
              await page.waitForTimeout(2000);
              break;
            } catch (e) {
              continue;
            }
          }

          // 전사본 패널에서 텍스트 추출
          const transcriptCaptions = await page.evaluate(() => {
            const transcriptItems = document.querySelectorAll('ytd-transcript-segment-renderer');
            const segments: CaptionSegment[] = [];
            
            transcriptItems.forEach((item, index) => {
              const timeElement = item.querySelector('.ytd-transcript-segment-renderer[role="button"] .segment-timestamp');
              const textElement = item.querySelector('.ytd-transcript-segment-renderer .segment-text');
              
              if (timeElement && textElement) {
                const timestamp = timeElement.textContent?.trim() || `${index * 2}s`;
                const text = textElement.textContent?.trim();
                
                if (text) {
                  segments.push({
                    timestamp: timestamp,
                    text: text,
                    start: index * 2,
                    duration: 2
                  });
                }
              }
            });
            
            return segments;
          });

          if (transcriptCaptions.length > 0) {
            console.log(`[YOUTUBE_CAPTIONS] Found ${transcriptCaptions.length} transcript segments`);
            return transcriptCaptions;
          }
        } catch (error) {
          console.log(`[YOUTUBE_CAPTIONS] Could not extract from transcript panel:`, error);
        }
      }

      console.log(`[YOUTUBE_CAPTIONS] Extracted ${captions.length} caption segments`);
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