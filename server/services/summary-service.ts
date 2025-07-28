import { YouTubeSummaryService } from "../youtube-summary";
import { validateYouTubeUrl } from "../utils/validation";

class SummaryService {
  private youtubeSummaryService: YouTubeSummaryService;

  constructor() {
    this.youtubeSummaryService = new YouTubeSummaryService();
  }

  async generateSummary(url: string) {
    console.log(`[SUMMARY_SERVICE] Generating summary for URL: ${url}`);
    
    // Validate URL
    const validation = validateYouTubeUrl(url);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    try {
      const result = await this.youtubeSummaryService.processYouTubeUrl(url);
      return {
        success: true,
        transcript: result.transcript,
        summary: result.summary
      };
    } catch (error) {
      console.error(`[SUMMARY_SERVICE] Error generating summary:`, error);
      throw new Error(error instanceof Error ? error.message : "요약 생성 중 오류가 발생했습니다.");
    }
  }

  async getSummaryStatus(videoId: string) {
    // This could be expanded to track summary generation status
    return {
      videoId,
      status: "completed" // placeholder
    };
  }
}

export const summaryService = new SummaryService();