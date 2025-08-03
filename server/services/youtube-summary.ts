import Anthropic from "@anthropic-ai/sdk";
import { errorLogger } from "./error-logging-service.js";
import { validateYouTubeUrl } from "../utils/validation.js";

// <important_do_not_delete>
const DEFAULT_MODEL_STR = "claude-sonnet-4-20250514";
// </important_do_not_delete>

export class YouTubeSummaryService {
  private anthropic: Anthropic;

  constructor() {
    console.log(`[YOUTUBE_SUMMARY] Initializing YouTube Summary service...`);

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(
        `[YOUTUBE_SUMMARY] ANTHROPIC_API_KEY environment variable is missing`,
      );
      throw new Error("ANTHROPIC_API_KEY environment variable must be set");
    }

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    console.log(`[YOUTUBE_SUMMARY] Anthropic client initialized successfully`);
  }

  /**
   * YouTube URL에서 비디오 ID 추출
   */
  private extractVideoId(url: string): string | null {
    const regex =
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  // --- Helper functions for extractTranscript ---

  private async _fetchTranscriptFromSupaData(youtubeUrl: string): Promise<string> {
    const requestUrl = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(youtubeUrl)}`;
    const requestHeaders = {
      "x-api-key": "sd_207eb9f552d7dfdaf11df214d1cddaf7",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; YouTube-Summary-Bot/1.0)",
    };

    console.log(`[YOUTUBE_SUMMARY] Requesting transcript from SupaData API...`);
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: requestHeaders,
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[YOUTUBE_SUMMARY] SupaData API error response:`, {
        status: response.status,
        statusText: response.statusText,
        body: responseText,
      });
      throw new Error(`자막 추출 실패: ${response.status} - ${responseText}`);
    }
    return responseText;
  }

  private _parseSupaDataResponse(responseText: string): string {
    let transcriptData;
    try {
      transcriptData = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`[YOUTUBE_SUMMARY] JSON parse error:`, parseError);
      throw new Error(`응답 형식 오류: JSON 파싱 실패`);
    }

    if (transcriptData.error) {
      console.error(`[YOUTUBE_SUMMARY] API returned error:`, transcriptData.error);
      throw new Error(`SupaData API 오류: ${transcriptData.error}`);
    }

    let transcriptText = "";
    if (transcriptData.text && transcriptData.text.trim() !== "") {
      transcriptText = transcriptData.text;
    } else if (
      transcriptData.content &&
      Array.isArray(transcriptData.content) &&
      transcriptData.content.length > 0
    ) {
      const contentArray = transcriptData.content || [];
      transcriptText = contentArray
        .map((entry) => entry.text || "")
        .join(" ");
    } else {
      throw new Error("이 영상에는 자막이 없거나 자막을 가져올 수 없습니다.");
    }

    if (!transcriptText || transcriptText.trim() === "") {
      throw new Error("자막 텍스트가 비어있습니다.");
    }
    return transcriptText;
  }

  /**
   * SupaData API를 사용하여 YouTube 자막 추출
   */
  async extractTranscript(youtubeUrl: string): Promise<string> {
    try {
      console.log(
        `[YOUTUBE_SUMMARY] Extracting transcript for URL: ${youtubeUrl}`,
      );

      const videoId = this.extractVideoId(youtubeUrl);
      if (!videoId) {
        throw new Error("유효하지 않은 YouTube URL입니다.");
      }
      console.log(`[YOUTUBE_SUMMARY] Video ID extracted: ${videoId}`);

      const responseText = await this._fetchTranscriptFromSupaData(youtubeUrl);
      const transcriptText = this._parseSupaDataResponse(responseText);

      console.log(
        `[YOUTUBE_SUMMARY] Transcript successfully extracted: ${transcriptText.length} characters`,
      );
      return transcriptText;
    } catch (error) {
      console.error(`[YOUTUBE_SUMMARY] Error extracting transcript:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeSummaryService",
        operation: "extractTranscript",
        additionalInfo: { youtubeUrl },
      });
      throw error;
    }
  }

  private _buildAnthropicPrompt(transcript: string, youtubeUrl: string): string {
    return `다음은 YouTube 영상(${youtubeUrl})의 자막입니다. 이 내용을 한국어로 명확하고 체계적으로 정리해주세요. mrkdwn 형식을 사용해주세요.\n\n자막 내용:\n${transcript}`;
  }

  /**
   * Claude API를 사용하여 자막 요약
   */
  async summarizeTranscript(
    transcript: string,
    youtubeUrl: string,
  ): Promise<string> {
    try {
      console.log(`[YOUTUBE_SUMMARY] Summarizing transcript with Claude...`);
      console.log(
        `[YOUTUBE_SUMMARY] Transcript length: ${transcript.length} characters`,
      );

      const prompt = this._buildAnthropicPrompt(transcript, youtubeUrl);

      const response = await this.anthropic.messages.create({
        model: DEFAULT_MODEL_STR, // "claude-sonnet-4-20250514"
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      console.log(`[YOUTUBE_SUMMARY] Claude API response received`);

      if (!response.content || response.content.length === 0) {
        throw new Error("요약 생성 실패");
      }

      const summary =
        response.content[0].type === "text" ? response.content[0].text : "";
      console.log(
        `[YOUTUBE_SUMMARY] Summary generated, length: ${summary.length} characters`,
      );

      return summary;
    } catch (error) {
      console.error(`[YOUTUBE_SUMMARY] Error summarizing transcript:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeSummaryService",
        operation: "summarizeTranscript",
        additionalInfo: { youtubeUrl, transcriptLength: transcript.length },
      });
      throw error;
    }
  }

  /**
   * YouTube URL을 처리하여 자막 추출 및 요약 수행
   */
  async processYouTubeUrl(
    youtubeUrl: string,
  ): Promise<{ transcript: string; summary: string }> {
    try {
      console.log(`[YOUTUBE_SUMMARY] Processing YouTube URL: ${youtubeUrl}`);

      // 1. 자막 추출
      const transcript = await this.extractTranscript(youtubeUrl);

      // 2. 요약 생성
      const summary = await this.summarizeTranscript(transcript, youtubeUrl);

      console.log(
        `[YOUTUBE_SUMMARY] YouTube URL processing completed successfully`,
      );

      return {
        transcript,
        summary,
      };
    } catch (error) {
      console.error(`[YOUTUBE_SUMMARY] Error processing YouTube URL:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeSummaryService",
        operation: "processYouTubeUrl",
        additionalInfo: { youtubeUrl },
      });
      throw error;
    }
  }

  
  async generateSummary(url: string) {
    console.log(`[SUMMARY_SERVICE] Generating summary for URL: ${url}`);
    
    // Validate URL
    const validation = validateYouTubeUrl(url);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    try {
      const result = await this.processYouTubeUrl(url); // this.youtubeSummaryService 대신 this 사용
      return {
        success: true,
        transcript: result.transcript,
        summary: result.summary
      };
    } catch (error) {
      console.error(`[SUMMARY_SERVICE] Error generating summary:`, error);
      // errorLogger 사용
      await errorLogger.logError(error as Error, {
        service: 'SummaryService',
        operation: 'generateSummary',
        additionalInfo: { url }
      });
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
