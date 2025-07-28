import { WebClient } from "@slack/web-api";

class ErrorLoggingService {
  private slackClient: WebClient;
  private debugChannelId: string;

  constructor() {
    if (!process.env.SLACK_BOT_TOKEN) {
      console.error("[ERROR_LOGGING] SLACK_BOT_TOKEN not set, error logging disabled");
      return;
    }

    this.slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    this.debugChannelId = "debug"; // 채널명으로 사용
    console.log("[ERROR_LOGGING] Error logging service initialized");
  }

  async logError(error: Error, context?: {
    service?: string;
    operation?: string;
    userId?: number;
    channelId?: string;
    additionalInfo?: any;
  }) {
    if (!this.slackClient) {
      console.error("[ERROR_LOGGING] Slack client not initialized, skipping error logging");
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const errorMessage = this.formatErrorMessage(error, context, timestamp);

      await this.slackClient.chat.postMessage({
        channel: this.debugChannelId,
        text: `🚨 서비스 에러 발생: ${error.message}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🚨 서비스 에러 발생"
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*시간:*\n${timestamp}`
              },
              {
                type: "mrkdwn",
                text: `*서비스:*\n${context?.service || 'Unknown'}`
              },
              {
                type: "mrkdwn",
                text: `*작업:*\n${context?.operation || 'Unknown'}`
              },
              {
                type: "mrkdwn",
                text: `*사용자 ID:*\n${context?.userId || 'N/A'}`
              }
            ]
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*에러 메시지:*\n\`\`\`${error.message}\`\`\``
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*스택 트레이스:*\n\`\`\`${error.stack || 'No stack trace available'}\`\`\``
            }
          }
        ]
      });

      console.log(`[ERROR_LOGGING] Error logged to Slack debug channel: ${error.message}`);
    } catch (slackError) {
      console.error(`[ERROR_LOGGING] Failed to send error to Slack:`, slackError);
      // 슬랙 전송 실패해도 원본 에러는 여전히 콘솔에 출력
      console.error(`[ORIGINAL_ERROR]`, error);
    }
  }

  private formatErrorMessage(error: Error, context?: any, timestamp?: string): string {
    let message = `🚨 서비스 에러 발생\n`;
    message += `시간: ${timestamp}\n`;
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
      
      await this.slackClient.chat.postMessage({
        channel: this.debugChannelId,
        text: `${emoji} ${message}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${emoji} *${level.toUpperCase()}*\n${message}`
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `시간: ${new Date().toISOString()}`
              }
            ]
          }
        ]
      });

      console.log(`[ERROR_LOGGING] Custom message logged to Slack: ${message}`);
    } catch (error) {
      console.error(`[ERROR_LOGGING] Failed to send custom message to Slack:`, error);
    }
  }
}

export const errorLogger = new ErrorLoggingService();