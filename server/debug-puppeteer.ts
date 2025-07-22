/**
 * Puppeteer 문제 진단을 위한 디버그 도구
 */

import puppeteer from 'puppeteer';

export class PuppeteerDebugger {
  
  /**
   * Puppeteer 환경 진단
   */
  async diagnoseEnvironment(): Promise<{
    canLaunch: boolean;
    chromiumPath?: string;
    error?: string;
    browserInfo?: any;
    systemInfo: any;
  }> {
    console.log(`[PUPPETEER_DEBUG] Starting environment diagnosis...`);
    
    const result = {
      canLaunch: false,
      systemInfo: {},
      error: undefined as string | undefined,
      chromiumPath: undefined as string | undefined,
      browserInfo: undefined as any
    };
    
    // 1. 시스템 정보 수집
    try {
      const { execSync } = await import('child_process');
      
      result.systemInfo = {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        env: {
          DISPLAY: process.env.DISPLAY,
          XVFB: process.env.XVFB,
          CHROME_PATH: process.env.CHROME_PATH,
          PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH
        }
      };
      
      // Chromium 경로 찾기
      try {
        const chromiumPaths = [
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable'
        ];
        
        for (const path of chromiumPaths) {
          try {
            execSync(`test -f ${path}`, { timeout: 1000 });
            result.chromiumPath = path;
            console.log(`[PUPPETEER_DEBUG] Found Chromium at: ${path}`);
            break;
          } catch (e) {
            continue;
          }
        }
        
        if (!result.chromiumPath) {
          // which 명령어로 시도
          try {
            result.chromiumPath = execSync('which chromium 2>/dev/null || which google-chrome 2>/dev/null || echo ""', { timeout: 2000 }).toString().trim();
          } catch (e) {
            console.log(`[PUPPETEER_DEBUG] No system Chromium found`);
          }
        }
        
      } catch (error) {
        console.log(`[PUPPETEER_DEBUG] Error finding Chromium:`, error);
      }
      
    } catch (error) {
      console.error(`[PUPPETEER_DEBUG] Error collecting system info:`, error);
    }
    
    // 2. Puppeteer 브라우저 실행 테스트
    let browser = null;
    try {
      console.log(`[PUPPETEER_DEBUG] Testing Puppeteer browser launch...`);
      
      const launchOptions: any = {
        headless: true,
        timeout: 10000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process', // 추가 옵션
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows'
        ]
      };
      
      if (result.chromiumPath) {
        launchOptions.executablePath = result.chromiumPath;
      }
      
      const startTime = Date.now();
      console.log(`[PUPPETEER_DEBUG] Launching with options:`, launchOptions);
      
      browser = await puppeteer.launch(launchOptions);
      const launchTime = Date.now() - startTime;
      
      console.log(`[PUPPETEER_DEBUG] Browser launched successfully in ${launchTime}ms`);
      
      // 브라우저 정보 수집
      result.browserInfo = {
        version: await browser.version(),
        userAgent: await browser.userAgent(),
        launchTime: launchTime
      };
      
      // 페이지 생성 테스트
      const page = await browser.newPage();
      console.log(`[PUPPETEER_DEBUG] Page created successfully`);
      
      // 간단한 네비게이션 테스트
      await page.goto('data:text/html,<h1>Test</h1>', { timeout: 5000 });
      const title = await page.title();
      console.log(`[PUPPETEER_DEBUG] Navigation test successful, title: ${title}`);
      
      await page.close();
      result.canLaunch = true;
      
    } catch (error) {
      console.error(`[PUPPETEER_DEBUG] Browser launch failed:`, error);
      result.error = error.message;
      result.canLaunch = false;
    } finally {
      if (browser) {
        try {
          await browser.close();
          console.log(`[PUPPETEER_DEBUG] Browser closed successfully`);
        } catch (e) {
          console.log(`[PUPPETEER_DEBUG] Error closing browser:`, e);
        }
      }
    }
    
    return result;
  }
  
  /**
   * YouTube 페이지 접근 테스트
   */
  async testYouTubeAccess(videoId: string): Promise<{
    success: boolean;
    error?: string;
    pageInfo?: any;
  }> {
    console.log(`[PUPPETEER_DEBUG] Testing YouTube access for video: ${videoId}`);
    
    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        timeout: 10000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process'
        ]
      });
      
      const page = await browser.newPage();
      
      // User Agent 설정
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      console.log(`[PUPPETEER_DEBUG] Navigating to: ${videoUrl}`);
      
      const response = await page.goto(videoUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      
      console.log(`[PUPPETEER_DEBUG] Page loaded with status: ${response?.status()}`);
      
      // 페이지 제목 확인
      const title = await page.title();
      console.log(`[PUPPETEER_DEBUG] Page title: ${title}`);
      
      // 비디오 플레이어 확인
      try {
        await page.waitForSelector('#movie_player', { timeout: 5000 });
        console.log(`[PUPPETEER_DEBUG] Video player found`);
      } catch (e) {
        console.log(`[PUPPETEER_DEBUG] Video player not found:`, e.message);
      }
      
      // 자막 관련 요소 확인
      const captionButton = await page.$('.ytp-subtitles-button');
      console.log(`[PUPPETEER_DEBUG] Caption button found: ${!!captionButton}`);
      
      return {
        success: true,
        pageInfo: {
          title,
          status: response?.status(),
          hasCaptionButton: !!captionButton
        }
      };
      
    } catch (error) {
      console.error(`[PUPPETEER_DEBUG] YouTube access failed:`, error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}