import puppeteer from 'puppeteer';

export interface CaptionSegment {
  timestamp: string;
  text: string;
  start: number;
  duration: number;
}

export class YoutubeCaptionExtractor {
  private browser: puppeteer.Browser | null = null;
  private debugMode: boolean = true; // 디버그 모드 활성화
  
  private debug(message: string, data?: any) {
    if (this.debugMode) {
      const timestamp = new Date().toISOString();
      if (data) {
        console.log(`[DEBUG ${timestamp}] ${message}`, data);
      } else {
        console.log(`[DEBUG ${timestamp}] ${message}`);
      }
    }
  }

  constructor() {}

  /**
   * 브라우저 인스턴스를 초기화합니다
   */
  private async initBrowser(): Promise<puppeteer.Browser> {
    if (!this.browser) {
      this.debug(`Step 1: Starting browser initialization...`);
      console.log(`[YOUTUBE_CAPTIONS] Step 1: Starting browser initialization...`);
      
      // 알려진 Chromium 경로들을 직접 확인 (find 명령어 우회)
      let executablePath;
      this.debug(`Step 2: Checking known Chromium paths...`);
      console.log(`[YOUTUBE_CAPTIONS] Step 2: Checking known Chromium paths...`);
      
      const knownPaths = [
        '/nix/store/*/bin/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/opt/google/chrome/chrome'
      ];

      try {
        const fs = await import('fs');
        const path = await import('path');
        
        // Nix store에서 chromium 찾기
        try {
          const nixStoreEntries = fs.readdirSync('/nix/store', { withFileTypes: true });
          for (const entry of nixStoreEntries) {
            if (entry.isDirectory() && entry.name.includes('chromium')) {
              const chromiumPath = path.join('/nix/store', entry.name, 'bin', 'chromium');
              if (fs.existsSync(chromiumPath)) {
                executablePath = chromiumPath;
                console.log(`[YOUTUBE_CAPTIONS] Found Chromium in Nix store: ${executablePath}`);
                break;
              }
            }
          }
        } catch (nixError) {
          console.log(`[YOUTUBE_CAPTIONS] Could not scan Nix store: ${nixError.message}`);
        }

        // 알려진 경로들 확인
        if (!executablePath) {
          for (const knownPath of knownPaths) {
            try {
              if (fs.existsSync(knownPath)) {
                executablePath = knownPath;
                console.log(`[YOUTUBE_CAPTIONS] Found Chromium at: ${executablePath}`);
                break;
              }
            } catch (checkError) {
              console.log(`[YOUTUBE_CAPTIONS] Could not check path ${knownPath}: ${checkError.message}`);
            }
          }
        }
      } catch (error) {
        console.log(`[YOUTUBE_CAPTIONS] Error during path checking:`, error);
      }

      if (!executablePath) {
        console.log(`[YOUTUBE_CAPTIONS] No Chromium found, will use Puppeteer's bundled Chrome`);
      }
      
      try {
        this.debug(`Step 3: Preparing browser launch options...`);
        console.log(`[YOUTUBE_CAPTIONS] Step 3: Preparing browser launch options...`);
        
        const browserArgs = [
          '--no-sandbox',
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-plugins',
          '--disable-plugins-discovery',
          '--disable-preconnect',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=TranslateUI',
          '--disable-features=BlinkGenPropertyTrees',
          '--disable-ipc-flooding-protection'
        ];
        
        this.debug(`Using ${browserArgs.length} browser arguments`);
        console.log(`[YOUTUBE_CAPTIONS] Step 4: Launching browser with ${browserArgs.length} arguments...`);
        console.log(`[YOUTUBE_CAPTIONS] Using executable: ${executablePath || 'Puppeteer bundled Chrome'}`);
        
        const launchOptions: any = {
          headless: true,
          timeout: 25000, // 25초 타임아웃
          args: browserArgs,
          defaultViewport: null,
          ignoreDefaultArgs: false
        };
        
        if (executablePath) {
          launchOptions.executablePath = executablePath;
          this.debug(`Using custom executable: ${executablePath}`);
        }
        
        this.debug(`Step 5: Calling puppeteer.launch()...`);
        console.log(`[YOUTUBE_CAPTIONS] Step 5: Calling puppeteer.launch()...`);
        const startTime = Date.now();
        
        this.browser = await Promise.race([
          puppeteer.launch(launchOptions),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              this.debug(`Browser launch timeout after 25 seconds`);
              console.log(`[YOUTUBE_CAPTIONS] Browser launch timeout after 25 seconds`);
              reject(new Error('Browser launch timeout after 25 seconds'));
            }, 25000);
          })
        ]);
        
        const launchTime = Date.now() - startTime;
        this.debug(`Browser launched successfully in ${launchTime}ms`);
        console.log(`[YOUTUBE_CAPTIONS] Step 6: Browser launched successfully in ${launchTime}ms`);
        
        // 브라우저 연결 테스트
        this.debug(`Step 7: Testing browser connection...`);
        console.log(`[YOUTUBE_CAPTIONS] Step 7: Testing browser connection...`);
        const pages = await this.browser.pages();
        this.debug(`Browser has ${pages.length} pages open`);
        console.log(`[YOUTUBE_CAPTIONS] Browser has ${pages.length} pages open`);
        
      } catch (error) {
        console.error(`[YOUTUBE_CAPTIONS] Browser launch failed:`, error);
        
        // 브라우저 초기화 실패 시 정리
        if (this.browser) {
          try {
            await this.browser.close();
          } catch (e) {
            console.log(`[YOUTUBE_CAPTIONS] Error closing failed browser:`, e);
          }
          this.browser = null;
        }
        
        if (error.message.includes('timeout')) {
          throw new Error('브라우저 초기화 시간 초과. Replit 환경에서 리소스 부족일 수 있습니다.');
        }
        
        throw new Error(`브라우저 실행 실패: ${error.message}`);
      }
    }
    
    console.log(`[YOUTUBE_CAPTIONS] Browser ready for use`);
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
    console.log(`[YOUTUBE_CAPTIONS] === Starting caption extraction for video: ${videoId} ===`);
    
    const browser = await this.initBrowser();
    console.log(`[YOUTUBE_CAPTIONS] Browser ready, creating new page...`);
    
    const page = await browser.newPage();
    console.log(`[YOUTUBE_CAPTIONS] New page created successfully`);
    
    try {
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(`[YOUTUBE_CAPTIONS] Step A: Navigating to video: ${videoUrl}`);
      
      // User Agent 설정으로 봇 탐지 우회 시도
      console.log(`[YOUTUBE_CAPTIONS] Step B: Setting user agent...`);
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
      
      // 페이지 로드
      console.log(`[YOUTUBE_CAPTIONS] Step C: Loading page with 30s timeout...`);
      const loadStartTime = Date.now();
      
      await page.goto(videoUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      const loadTime = Date.now() - loadStartTime;
      console.log(`[YOUTUBE_CAPTIONS] Step D: Page loaded successfully in ${loadTime}ms`);

      // 페이지가 완전히 로드될 때까지 대기
      console.log(`[YOUTUBE_CAPTIONS] Step E: Waiting for video player...`);
      await page.waitForSelector('#movie_player', { timeout: 15000 });
      console.log(`[YOUTUBE_CAPTIONS] Step F: Video player found successfully`);
      
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