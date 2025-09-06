// Push notification error classification and handling strategies

export enum PushErrorType {
  // Permanent errors - don't retry
  DEVICE_NOT_REGISTERED = 'DeviceNotRegistered',
  INVALID_CREDENTIALS = 'InvalidCredentials', 
  MESSAGE_TOO_BIG = 'MessageTooBig',
  
  // Transient errors - retry with backoff
  MESSAGE_RATE_EXCEEDED = 'MessageRateExceeded',
  INTERNAL_ERROR = 'InternalError',
  NETWORK_ERROR = 'NetworkError',
  
  // Configuration errors - investigate
  MISMATCH_SENDER_ID = 'MismatchSenderId',
  
  // Unknown errors - log and monitor
  UNKNOWN = 'Unknown'
}

export enum ErrorSeverity {
  LOW = 'low',       // Individual token issues
  MEDIUM = 'medium', // Service degradation  
  HIGH = 'high',     // Complete service failure
  CRITICAL = 'critical' // System-wide issues
}

export interface PushErrorDetails {
  errorType: PushErrorType;
  severity: ErrorSeverity;
  retryable: boolean;
  maxRetries: number;
  backoffMs: number;
  action: 'delete_token' | 'deactivate_token' | 'retry_later' | 'investigate';
}

export const ERROR_HANDLING_RULES: Record<PushErrorType, PushErrorDetails> = {
  [PushErrorType.DEVICE_NOT_REGISTERED]: {
    errorType: PushErrorType.DEVICE_NOT_REGISTERED,
    severity: ErrorSeverity.LOW,
    retryable: false,
    maxRetries: 0,
    backoffMs: 0,
    action: 'delete_token'
  },
  
  [PushErrorType.INVALID_CREDENTIALS]: {
    errorType: PushErrorType.INVALID_CREDENTIALS,
    severity: ErrorSeverity.LOW,
    retryable: false,
    maxRetries: 0,
    backoffMs: 0,
    action: 'delete_token'
  },
  
  [PushErrorType.MESSAGE_TOO_BIG]: {
    errorType: PushErrorType.MESSAGE_TOO_BIG,
    severity: ErrorSeverity.MEDIUM,
    retryable: false,
    maxRetries: 0,
    backoffMs: 0,
    action: 'investigate' // Need to fix message size
  },
  
  [PushErrorType.MESSAGE_RATE_EXCEEDED]: {
    errorType: PushErrorType.MESSAGE_RATE_EXCEEDED,
    severity: ErrorSeverity.MEDIUM,
    retryable: true,
    maxRetries: 3,
    backoffMs: 30000, // 30 seconds
    action: 'retry_later'
  },
  
  [PushErrorType.INTERNAL_ERROR]: {
    errorType: PushErrorType.INTERNAL_ERROR,
    severity: ErrorSeverity.HIGH,
    retryable: true,
    maxRetries: 2,
    backoffMs: 60000, // 1 minute
    action: 'retry_later'
  },
  
  [PushErrorType.NETWORK_ERROR]: {
    errorType: PushErrorType.NETWORK_ERROR,
    severity: ErrorSeverity.MEDIUM,
    retryable: true,
    maxRetries: 3,
    backoffMs: 5000, // 5 seconds
    action: 'retry_later'
  },
  
  [PushErrorType.MISMATCH_SENDER_ID]: {
    errorType: PushErrorType.MISMATCH_SENDER_ID,
    severity: ErrorSeverity.HIGH,
    retryable: false,
    maxRetries: 0,
    backoffMs: 0,
    action: 'investigate' // Configuration issue
  },
  
  [PushErrorType.UNKNOWN]: {
    errorType: PushErrorType.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
    retryable: true,
    maxRetries: 1,
    backoffMs: 10000, // 10 seconds
    action: 'retry_later'
  }
};

export interface RetryableNotification {
  userId: number;
  deviceId: string;
  token: string;
  notification: any;
  attemptCount: number;
  nextRetryAt: Date;
  lastError?: string;
  errorType?: PushErrorType;
}

export function classifyError(expoPushError: any): PushErrorType {
  if (!expoPushError?.details?.error) {
    return PushErrorType.UNKNOWN;
  }
  
  const errorCode = expoPushError.details.error;
  
  // Map Expo error codes to our classification
  switch (errorCode) {
    case 'DeviceNotRegistered':
      return PushErrorType.DEVICE_NOT_REGISTERED;
    case 'InvalidCredentials':
      return PushErrorType.INVALID_CREDENTIALS;
    case 'MessageTooBig':
      return PushErrorType.MESSAGE_TOO_BIG;
    case 'MessageRateExceeded':
      return PushErrorType.MESSAGE_RATE_EXCEEDED;
    case 'MismatchSenderId':
      return PushErrorType.MISMATCH_SENDER_ID;
    case 'InternalError':
    case 'ServiceUnavailable':
      return PushErrorType.INTERNAL_ERROR;
    default:
      return PushErrorType.UNKNOWN;
  }
}

export function shouldRetry(errorType: PushErrorType, attemptCount: number): boolean {
  const rule = ERROR_HANDLING_RULES[errorType];
  return rule.retryable && attemptCount < rule.maxRetries;
}

export function calculateBackoffMs(errorType: PushErrorType, attemptCount: number): number {
  const rule = ERROR_HANDLING_RULES[errorType];
  // Exponential backoff: baseDelay * 2^attemptCount
  return rule.backoffMs * Math.pow(2, attemptCount);
}