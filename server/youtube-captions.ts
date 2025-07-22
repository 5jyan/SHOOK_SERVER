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
        const { execSync } = await import('child_process');
        
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
      
      let transcriptFound = false;
      
      // 방법 1: 일반적인 전사본 버튼 찾기
      try {
        await page.waitForTimeout(2000); // DOM이 완전히 로드될 때까지 대기
        
        const transcriptButton = await page.evaluate(() => {
          // 더 포괄적인 전사본 버튼 찾기
          const possibleTexts = ['transcript', '전사본', 'Transcript', 'TRANSCRIPT'];
          
          // 모든 버튼 요소 검색
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], yt-button-renderer, tp-yt-paper-button'));
          
          for (const button of buttons) {
            const text = button.textContent?.toLowerCase() || '';
            const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
            
            for (const searchText of possibleTexts) {
              if (text.includes(searchText.toLowerCase()) || ariaLabel.includes(searchText.toLowerCase())) {
                // 버튼이 보이는지 확인
                const rect = button.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  return button;
                }
              }
            }
          }
          return null;
        });

        if (transcriptButton) {
          await page.evaluate(button => {
            button.click();
          }, transcriptButton);
          console.log(`[YOUTUBE_CAPTIONS] Found and clicked transcript button via text search`);
          transcriptFound = true;
          await page.waitForTimeout(3000);
        }
      } catch (error) {
        console.log(`[YOUTUBE_CAPTIONS] Text-based transcript search failed:`, error.message);
      }

      // 방법 2: 선택자 기반 탐색 (백업)
      if (!transcriptFound) {
        const transcriptSelectors = [
          'yt-button-renderer[aria-label*="transcript" i]',
          'yt-button-renderer[aria-label*="전사본" i]',
          'button[aria-label*="transcript" i]',
          'button[aria-label*="전사본" i]',
          'tp-yt-paper-button[aria-label*="transcript" i]',
          'tp-yt-paper-button[aria-label*="전사본" i]'
        ];

        for (const selector of transcriptSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 2000 });
            await page.click(selector);
            console.log(`[YOUTUBE_CAPTIONS] Successfully clicked transcript button with selector: ${selector}`);
            transcriptFound = true;
            await page.waitForTimeout(3000);
            break;
          } catch (error) {
            console.log(`[YOUTUBE_CAPTIONS] Selector ${selector} failed:`, error.message);
            continue;
          }
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
      
      // 전사본 패널이 로드될 때까지 추가 대기
      await page.waitForTimeout(2000);
      
      const captions = await page.evaluate(() => {
        let segments: any[] = [];
        
        // 최신 YouTube DOM 구조에 맞는 전사본 selector들
        const transcriptSelectors = [
          'ytd-transcript-segment-renderer', // 표준 전사본 세그먼트
          '.ytd-transcript-segment-renderer',
          '[class*="transcript-segment"]',
          '[class*="cue-group"]',
          '.segment-list .segment',
          '#segments-container .segment'
        ];
        
        console.log('Searching for transcript segments...');
        
        for (const selector of transcriptSelectors) {
          const elements = document.querySelectorAll(selector);
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          
          if (elements.length > 0) {
            elements.forEach((item, index) => {
              try {
                // 더 포괄적인 시간 요소 찾기
                const timeSelectors = [
                  '.segment-timestamp',
                  '[class*="timestamp"]', 
                  '.cue-group-start-offset',
                  '.ytd-transcript-segment-renderer [role="button"] span:first-child',
                  'span[style*="color"]'
                ];
                
                let timeElement = null;
                for (const timeSelector of timeSelectors) {
                  timeElement = item.querySelector(timeSelector);
                  if (timeElement) break;
                }
                
                // 더 포괄적인 텍스트 요소 찾기  
                const textSelectors = [
                  '.segment-text',
                  '[class*="text"]',
                  '.cue-group span:last-child',
                  '.ytd-transcript-segment-renderer [role="button"] span:last-child'
                ];
                
                let textElement = null;
                for (const textSelector of textSelectors) {
                  textElement = item.querySelector(textSelector);
                  if (textElement) break;
                }
                
                // 텍스트가 없으면 전체 요소에서 추출 시도
                if (!textElement) {
                  textElement = item;
                }
                
                const timestamp = timeElement?.textContent?.trim() || `${index * 5}초`;
                let text = textElement?.textContent?.trim() || '';
                
                // 타임스탬프 제거
                if (text.includes(timestamp)) {
                  text = text.replace(timestamp, '').trim();
                }
                
                // 유효한 텍스트인지 확인
                if (text && text.length > 1 && text !== timestamp && !text.match(/^\d+:\d+$/)) {
                  // 시간을 숫자로 변환
                  let startTime = index * 5;
                  if (timestamp.includes(':')) {
                    const parts = timestamp.split(':');
                    if (parts.length === 2) {
                      startTime = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                    }
                  }
                  
                  segments.push({
                    timestamp: timestamp,
                    text: text,
                    start: startTime,
                    duration: 5
                  });
                }
              } catch (error) {
                console.error('Error processing segment:', error);
              }
            });
            
            if (segments.length > 0) {
              console.log(`Successfully extracted ${segments.length} segments with selector: ${selector}`);
              break;
            }
          }
        }
        
        // 대안 방법: 모든 클릭 가능한 요소에서 타임스탬프 패턴 찾기
        if (segments.length === 0) {
          console.log('Trying alternative method: searching all clickable elements for timestamp patterns...');
          
          const clickableElements = document.querySelectorAll('[role="button"]');
          console.log(`Found ${clickableElements.length} clickable elements`);
          
          Array.from(clickableElements).forEach((element, index) => {
            const text = element.textContent?.trim() || '';
            
            // 타임스탬프 패턴 매칭 (예: "1:23", "0:45", "12:34")
            const timeMatch = text.match(/(\d{1,2}:\d{2})/);
            if (timeMatch) {
              const timestamp = timeMatch[1];
              const remainingText = text.replace(timestamp, '').trim();
              
              if (remainingText && remainingText.length > 5) {
                const parts = timestamp.split(':');
                const startTime = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                
                segments.push({
                  timestamp: timestamp,
                  text: remainingText,
                  start: startTime,
                  duration: 5
                });
              }
            }
          });
          
          if (segments.length > 0) {
            console.log(`Alternative method found ${segments.length} segments`);
          }
        }
        
        // 여전히 전사본이 없는 경우 페이지 제목 추출
        if (segments.length === 0) {
          console.log('No transcript found, extracting video title...');
          
          const titleSelectors = [
            'h1.title',
            'h1.style-scope.ytd-video-primary-info-renderer',
            '#title h1',
            '.ytd-video-primary-info-renderer h1',
            'h1[class*="title"]'
          ];
          
          let title = '';
          for (const titleSelector of titleSelectors) {
            const titleElement = document.querySelector(titleSelector);
            if (titleElement) {
              title = titleElement.textContent?.trim() || '';
              if (title) break;
            }
          }
          
          if (title) {
            segments.push({
              timestamp: "0:00",
              text: `영상 제목: "${title}" - 자막을 추출할 수 없었습니다.`,
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