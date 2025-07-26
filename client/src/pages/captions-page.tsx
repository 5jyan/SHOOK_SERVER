import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Youtube,
  Copy,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Globe,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface CaptionSegment {
  start: number;
  dur: number;
  text: string;
}

interface CaptionResponse {
  success: boolean;
  videoId: string;
  url: string;
  captions: CaptionSegment[];
  fullText: string;
  segmentCount: number;
  language: string;
}

export default function CaptionsPage() {
  const { toast } = useToast();
  const [videoUrl, setVideoUrl] = useState("");
  const [captionData, setCaptionData] = useState<CaptionResponse | null>(null);

  // YouTube URL에서 비디오 ID를 추출하는 함수
  const extractVideoId = (url: string) => {
    console.log(`[FRONTEND] Extracting video ID from URL: ${url}`);
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        console.log(`[FRONTEND] Video ID extracted successfully:`, { success: true, url, videoId: match[1] });
        return match[1];
      }
    }
    
    console.log(`[FRONTEND] Failed to extract video ID from URL: ${url}`);
    return null;
  };

  // 자막 추출 mutation
  const extractCaptionsMutation = useMutation({
    mutationFn: async (url: string) => {
      console.log(`[FRONTEND] Extracting captions for video ID: ${extractVideoId(url)}`);
      const res = await apiRequest("POST", "/api/captions/extract", { url });
      return await res.json();
    },
    onSuccess: (data: CaptionResponse) => {
      console.log(`[FRONTEND] Caption extraction successful:`, data);
      setCaptionData(data);
      toast({
        title: "성공",
        description: `자막을 성공적으로 추출했습니다! ${data.segmentCount}개 구간, ${data.fullText.length}자`,
      });
    },
    onError: (error: Error) => {
      console.error(`[FRONTEND] Error extracting captions:`, error);
      toast({
        title: "오류",
        description: error.message || "자막 추출 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleExtractCaptions = () => {
    if (!videoUrl.trim()) {
      toast({
        title: "오류",
        description: "YouTube URL을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      toast({
        title: "오류",
        description: "올바른 YouTube URL을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    extractCaptionsMutation.mutate(videoUrl);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "복사 완료",
        description: "자막이 클립보드에 복사되었습니다.",
      });
    } catch (error) {
      console.error("Failed to copy text:", error);
      toast({
        title: "복사 실패",
        description: "클립보드 복사 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const downloadAsFile = (text: string, filename: string) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "다운로드 완료",
      description: `${filename} 파일이 다운로드되었습니다.`,
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
                <Youtube className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-semibold text-slate-900">
                YouTube 자막 추출기
              </h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* URL Input Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Youtube className="w-5 h-5 text-red-600" />
              YouTube 영상 URL 입력
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=... 또는 https://youtu.be/..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={handleExtractCaptions}
                  disabled={extractCaptionsMutation.isPending}
                  className="bg-red-600 hover:bg-red-700 text-white whitespace-nowrap"
                >
                  {extractCaptionsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  자막 추출
                </Button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start">
                  <AlertCircle className="text-blue-500 mt-0.5 mr-3 w-4 h-4" />
                  <div className="text-sm text-blue-700">
                    <p className="font-medium mb-2">지원하는 URL 형식:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>https://www.youtube.com/watch?v=VIDEO_ID</li>
                      <li>https://youtu.be/VIDEO_ID</li>
                      <li>https://www.youtube.com/embed/VIDEO_ID</li>
                    </ul>
                    <p className="mt-2 text-xs">
                      ⚠️ 비공개 영상이나 자막이 없는 영상은 추출할 수 없습니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Section */}
        {captionData && (
          <div className="space-y-6">
            {/* Video Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  추출 완료
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    <Youtube className="w-4 h-4 text-slate-500" />
                    <span className="text-sm text-slate-600">비디오 ID:</span>
                    <Badge variant="outline">{captionData.videoId}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <span className="text-sm text-slate-600">구간 수:</span>
                    <Badge variant="outline">{captionData.segmentCount}개</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-slate-500" />
                    <span className="text-sm text-slate-600">언어:</span>
                    <Badge variant="outline">{captionData.language}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Full Text */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>전체 자막 텍스트</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(captionData.fullText)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      복사
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadAsFile(captionData.fullText, `${captionData.videoId}_captions.txt`)}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      다운로드
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={captionData.fullText}
                  readOnly
                  className="min-h-[200px] font-mono text-sm"
                  placeholder="자막 텍스트가 여기에 표시됩니다..."
                />
                <p className="text-xs text-slate-500 mt-2">
                  총 {captionData.fullText.length}자
                </p>
              </CardContent>
            </Card>

            {/* Detailed Captions */}
            <Card>
              <CardHeader>
                <CardTitle>구간별 자막</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {captionData.captions.map((caption, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200"
                    >
                      <Badge variant="secondary" className="shrink-0">
                        {formatDuration(caption.start)}
                      </Badge>
                      <p className="text-sm text-slate-700 flex-1">
                        {caption.text}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}