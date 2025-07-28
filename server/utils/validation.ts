// Validation utilities
export function validateYouTubeHandle(handle: string): { isValid: boolean; error?: string } {
  if (!handle || !handle.startsWith('@')) {
    return { isValid: false, error: "핸들러는 @로 시작해야 합니다" };
  }
  return { isValid: true };
}

export function validateEmail(email: string): { isValid: boolean; error?: string } {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return { isValid: false, error: "유효한 이메일 주소를 입력해주세요" };
  }
  return { isValid: true };
}

export function validateYouTubeUrl(url: string): { isValid: boolean; error?: string } {
  const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/;
  if (!url || !youtubeRegex.test(url)) {
    return { isValid: false, error: "유효한 YouTube URL을 입력해주세요" };
  }
  return { isValid: true };
}