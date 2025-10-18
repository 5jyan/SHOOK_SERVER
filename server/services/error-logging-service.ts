import { WebClient } from "@slack/web-api";
import { getKoreanTimestamp, logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

class ErrorLoggingService {
  private slackClient?: WebClient;
  private slackChannel?: string;
  private slackEnabled: boolean = false;

  constructor() {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    this.slackChannel = process.env.SLACK_CHANNEL_ID;

    // 디버깅: 토큰과 채널 ID 로드 상태 출력
    logWithTimestamp("[ERROR_LOGGING] Slack configuration:");
    logWithTimestamp(`  - Token exists: ${!!slackToken}`);
    logWithTimestamp(`  - Token length: ${slackToken?.length || 0}`);
    logWithTimestamp(`  - Token prefix: ${slackToken?.substring(0, 10)}...`);
    logWithTimestamp(`  - Channel ID: ${this.slackChannel}`);

    if (slackToken && this.slackChannel) {
      this.slackClient = new WebClient(slackToken);
      this.slackEnabled = true;
      logWithTimestamp("[ERROR_LOGGING] Error logging service initialized (console + Slack)");
    } else {
      logWithTimestamp("[ERROR_LOGGING] Error logging service initialized (console only - Slack not configured)");
    }
  }

  async logError(error: Error, context?: {
    service?: string;
    operation?: string;
    userId?: number;
    channelId?: string;
    deviceId?: string;
    errorType?: string;
    severity?: string;
    requiresInvestigation?: boolean;
    notification?: string;
    tokenCount?: number;
    since?: number;
    username?: string;
    attemptCount?: number;
    additionalInfo?: any;
  }) {
    try {
      const timestamp = getKoreanTimestamp();
      const errorMessage = this.formatErrorMessage(error, context, timestamp);

      // 콘솔에 로그 출력
      console.error(`${timestamp} [ERROR_LOGGING] ${errorMessage}`);

      // 슬랙으로 에러 전송
      if (this.slackEnabled && this.slackClient && this.slackChannel) {
        await this.sendToSlack(errorMessage, 'error');
      }
    } catch (loggingError) {
      errorWithTimestamp(`[ERROR_LOGGING] Failed to log error:`, loggingError);
      // 로깅 실패해도 원본 에러는 여전히 콘솔에 출력
      errorWithTimestamp(`[ORIGINAL_ERROR]`, error);
    }
  }

  private formatErrorMessage(error: Error, context?: any, timestamp?: string): string {
    let message = `🚨 서비스 에러 발생\n`;
    message += `서비스: ${context?.service || 'Unknown'}\n`;
    message += `작업: ${context?.operation || 'Unknown'}\n`;
    message += `사용자 ID: ${context?.userId || 'N/A'}\n`;
    message += `에러: ${error.message}\n`;
    
    if (context?.additionalInfo) {
      message += `추가 정보: ${JSON.stringify(context.additionalInfo, null, 2)}\n`;
    }
    
    if (error.stack) {
      message += `스택 트레이스:\n${error.stack}`;
    }
    
    return message;
  }

  async logCustomMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    try {
      const emoji = level === 'error' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';
      const timestamp = getKoreanTimestamp();

      console.log(`${timestamp} [ERROR_LOGGING] ${emoji} ${level.toUpperCase()}: ${message}`);

      // 슬랙으로 메시지 전송 (error와 warning만)
      if (this.slackEnabled && this.slackClient && this.slackChannel && level !== 'info') {
        const slackMessage = `${emoji} ${level.toUpperCase()}: ${message}`;
        await this.sendToSlack(slackMessage, level);
      }
    } catch (error) {
      errorWithTimestamp(`[ERROR_LOGGING] Failed to log custom message:`, error);
    }
  }

  private async sendToSlack(message: string, level: 'info' | 'warning' | 'error') {
    if (!this.slackClient || !this.slackChannel) {
      logWithTimestamp(`[ERROR_LOGGING] ⚠️ Slack not configured, skipping message send`);
      return;
    }

    try {
      logWithTimestamp(`[ERROR_LOGGING] 📤 Sending ${level} message to Slack...`);

      const result = await this.slackClient.chat.postMessage({
        channel: this.slackChannel,
        text: message,
        mrkdwn: true,
      });

      if (result.ok) {
        logWithTimestamp(`[ERROR_LOGGING] ✅ Slack message sent successfully (ts: ${result.ts})`);
      } else {
        logWithTimestamp(`[ERROR_LOGGING] ⚠️ Slack message sent but response not ok: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      // 슬랙 전송 실패 시 콘솔에만 로그
      errorWithTimestamp(`[ERROR_LOGGING] ❌ Failed to send message to Slack:`, error);
    }
  }
}

export const errorLogger = new ErrorLoggingService();