import OpenAI from "openai";
import { errorLogger } from "./error-logging-service.js";
import { validateYouTubeUrl } from "../utils/validation.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";

// <important_do_not_delete>
const DEFAULT_MODEL_STR = "gpt-5-mini";
// </important_do_not_delete>

export class YouTubeSummaryService {
  private openai: OpenAI;

  constructor() {
    logWithTimestamp(`[YOUTUBE_SUMMARY] Initializing YouTube Summary service...`);

    if (!process.env.OPENAI_API_KEY) {
      errorWithTimestamp(
        `[YOUTUBE_SUMMARY] OPENAI_API_KEY environment variable is missing`,
      );
      throw new Error("OPENAI_API_KEY environment variable must be set");
    }

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    logWithTimestamp(`[YOUTUBE_SUMMARY] OpenAI client initialized successfully`);
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
    const apiKey = process.env.SUPADATA_API_KEY;
    
    if (!apiKey) {
      throw new Error('SUPADATA_API_KEY 환경 변수가 설정되지 않았습니다.');
    }
    
    const requestHeaders = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; YouTube-Summary-Bot/1.0)",
    };

    logWithTimestamp(`[YOUTUBE_SUMMARY] Requesting transcript from SupaData API...`);
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: requestHeaders,
    });
    logWithTimestamp(`[YOUTUBE_SUMMARY] Received response from SupaData API.`);

    const responseText = await response.text();

    if (!response.ok) {
      errorWithTimestamp(`[YOUTUBE_SUMMARY] SupaData API error response:`, {
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
      errorWithTimestamp(`[YOUTUBE_SUMMARY] JSON parse error:`, parseError);
      throw new Error(`응답 형식 오류: JSON 파싱 실패`);
    }

    if (transcriptData.error) {
      errorWithTimestamp(`[YOUTUBE_SUMMARY] API returned error:`, transcriptData.error);
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
        .map((entry: any) => entry.text || "")
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
      logWithTimestamp(
        `[YOUTUBE_SUMMARY] Extracting transcript for URL: ${youtubeUrl}`,
      );

      const videoId = this.extractVideoId(youtubeUrl);
      if (!videoId) {
        throw new Error("유효하지 않은 YouTube URL입니다.");
      }
      logWithTimestamp(`[YOUTUBE_SUMMARY] Video ID extracted: ${videoId}`);

      const responseText = await this._fetchTranscriptFromSupaData(youtubeUrl);
      const transcriptText = this._parseSupaDataResponse(responseText);

      logWithTimestamp(
        `[YOUTUBE_SUMMARY] Transcript successfully extracted: ${transcriptText.length} characters`,
      );
      return transcriptText;
    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_SUMMARY] Error extracting transcript:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeSummaryService",
        operation: "extractTranscript",
        additionalInfo: { youtubeUrl },
      });
      throw error;
    }
  }

  private _buildOpenAIPrompt(transcript: string, youtubeUrl: string): string {
    return `다음 내용을 한국어로 명확하고 체계적으로 정리해. 자동으로 생성된 자막이니 잘못 생성된 단어라 판단되는 단어는 직접 보정하고 보정한 이력은 따로 기재하지마. 글쓴이를 언급할때는 단순히 "유튜버"라는 명칭만 사용해. 요약 필요한 내용: ${transcript}\n
    정리는 마크다운 형식을 사용하지마. 요약 예시: 1. 핵심 내용\n - 세부 내용1\n - 세부내용2\n
    요약 정리 내용 외 부수적인 언급은 하지마.`;
  }

  /**
   * OpenAI API를 사용하여 자막 요약
   */
  async summarizeTranscript(
    transcript: string,
    youtubeUrl: string,
  ): Promise<string> {
    try {
      logWithTimestamp(`[YOUTUBE_SUMMARY] Summarizing transcript with OpenAI...`);
      logWithTimestamp(
        `[YOUTUBE_SUMMARY] Transcript length: ${transcript.length} characters`,
      );

      const prompt = this._buildOpenAIPrompt(transcript, youtubeUrl);

      logWithTimestamp(`[YOUTUBE_SUMMARY] Requesting summary from OpenAI API...`);
      const response = await this.openai.chat.completions.create({
        model: DEFAULT_MODEL_STR, // "gpt-4o-mini"
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });
      logWithTimestamp(`[YOUTUBE_SUMMARY] Received response from OpenAI API.`);

      logWithTimestamp(`[YOUTUBE_SUMMARY] OpenAI API response received`);

      if (!response.choices || response.choices.length === 0) {
        throw new Error("요약 생성 실패");
      }

      const summary = response.choices[0].message.content || "";
      logWithTimestamp(
        `[YOUTUBE_SUMMARY] Summary generated, length: ${summary.length} characters`,
      );

      return summary;
    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_SUMMARY] Error summarizing transcript:`, error);
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
      logWithTimestamp(`[YOUTUBE_SUMMARY] Processing YouTube URL: ${youtubeUrl}`);

      // 1. 자막 추출
      const transcript = await this.extractTranscript(youtubeUrl);

      // 2. 요약 생성
      const summary = await this.summarizeTranscript(transcript, youtubeUrl);

      logWithTimestamp(
        `[YOUTUBE_SUMMARY] YouTube URL processing completed successfully`,
      );

      return {
        transcript,
        summary,
      };
    } catch (error) {
      errorWithTimestamp(`[YOUTUBE_SUMMARY] Error processing YouTube URL:`, error);
      await errorLogger.logError(error as Error, {
        service: "YouTubeSummaryService",
        operation: "processYouTubeUrl",
        additionalInfo: { youtubeUrl },
      });
      throw error;
    }
  }

  
  async generateSummary(url: string) {
    logWithTimestamp(`[SUMMARY_SERVICE] Generating summary for URL: ${url}`);
    
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
      errorWithTimestamp(`[SUMMARY_SERVICE] Error generating summary:`, error);
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
