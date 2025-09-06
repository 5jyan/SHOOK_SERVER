import { getKoreanTimestamp, logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

class ErrorLoggingService {
  constructor() {
    logWithTimestamp("[ERROR_LOGGING] Error logging service initialized (console only)");
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
      
      console.error(`${timestamp} [ERROR_LOGGING] ${errorMessage}`);
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
    } catch (error) {
      errorWithTimestamp(`[ERROR_LOGGING] Failed to log custom message:`, error);
    }
  }
}

export const errorLogger = new ErrorLoggingService();