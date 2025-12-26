import { initFileLogger } from "./file-logger.js";

initFileLogger();

export function getKoreanTimestamp(): string {
  const now = new Date();
  
  // UTC+9 (Korean Time)
  const koreanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  
  const month = String(koreanTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(koreanTime.getUTCDate()).padStart(2, '0');
  const hour = String(koreanTime.getUTCHours()).padStart(2, '0');
  const minute = String(koreanTime.getUTCMinutes()).padStart(2, '0');
  const second = String(koreanTime.getUTCSeconds()).padStart(2, '0');
  
  return `${month}-${day} ${hour}:${minute}:${second}`;
}

export function logWithTimestamp(message: string, ...args: any[]): void {
  const timestamp = getKoreanTimestamp();
  console.log(`${timestamp} ${message}`, ...args);
}

export function errorWithTimestamp(message: string, ...args: any[]): void {
  const timestamp = getKoreanTimestamp();
  console.error(`${timestamp} ${message}`, ...args);
}
