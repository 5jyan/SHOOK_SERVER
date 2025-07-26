import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Youtube,
  Download,
  Loader2,
  Clock,
  FileText,
  AlertCircle,
  CheckCircle,
  Copy,
  ArrowLeft,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

interface Caption {
  start: string;
  end: string;
  text: string;
}

interface CaptionResponse {
  success: boolean;
  videoId: string;
  url: string;
  subtitleFile: string;
  captions: Caption[];
  fullText: string;
  totalCaptions: number;
}

export default function CaptionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [videoUrl, setVideoUrl] = useState("");
  const [extractedData, setExtractedData] = useState<CaptionResponse | null>(null);

  // YouTube URL에서 비디오 ID 추출하는 함수
  const extractVideoId = (url: string) => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/);
    return match ? { success: true, url, videoId: match[1] } : { success: false, url };
  };

  // 자막 추출 mutation
  const extractCaptionsMutation = useMutation({
    mutationFn: async (url: string) => {
      console.log(`[FRONTEND] Extracting captions for video ID: ${extractVideoId(url).videoId}`);
      const res = await apiRequest("POST", "/api/extract-captions", { url });
      return await res.json();
    },
    onSuccess: (data: CaptionResponse) => {
      console.log(`[FRONTEND] Caption extraction successful:`, data);
      setExtractedData(data);
      toast({
        title: "성공",
        description: `${data.totalCaptions}개의 자막을 성공적으로 추출했습니다.`,
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

    const urlCheck = extractVideoId(videoUrl);
    console.log(`[FRONTEND] Extracting video ID from URL: ${videoUrl}`);
    console.log(`[FRONTEND] Video ID extracted successfully:`, urlCheck);

    if (!urlCheck.success) {
      toast({
        title: "오류",
        description: "올바른 YouTube URL을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    extractCaptionsMutation.mutate(videoUrl);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "복사 완료",
      description: "텍스트가 클립보드에 복사되었습니다.",
    });
  };

  const formatTime = (timeStr: string) => {
    // VTT 시간 형식을 더 읽기 쉽게 변환
    return timeStr.replace(/\.\d+$/, ''); // 밀리초 제거
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center">
                <Youtube className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  YouTube 자막 추출
                </h1>
                <p className="text-sm text-slate-500">
                  유튜브 영상에서 자막을 추출하여 텍스트로 변환합니다
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-slate-600 hover:text-slate-900"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  홈으로
                </Button>
              </Link>
              <div className="text-sm text-slate-600">
                안녕하세요, <span className="font-medium">{user?.username}</span>님
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* URL Input Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Youtube className="w-5 h-5 text-red-600" />
              YouTube URL 입력
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=..."
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
                    <p className="font-medium mb-2">지원되는 기능:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>한국어 및 영어 자막 자동 감지</li>
                      <li>수동 생성 자막과 자동 생성 자막 모두 지원</li>
                      <li>시간별 자막과 전체 텍스트 제공</li>
                      <li>VTT 및 SRT 형식 자막 파싱</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Section */}
        {extractedData && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                추출된 자막
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-slate-600">
                <span className="flex items-center gap-1">
                  <FileText className="w-4 h-4" />
                  {extractedData.totalCaptions}개 자막
                </span>
                <span className="flex items-center gap-1">
                  <Youtube className="w-4 h-4" />
                  {extractedData.videoId}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* 전체 텍스트 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-slate-900">전체 텍스트</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(extractedData.fullText)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      복사
                    </Button>
                  </div>
                  <Textarea
                    value={extractedData.fullText}
                    readOnly
                    className="min-h-[200px]"
                    placeholder="추출된 전체 텍스트가 여기에 표시됩니다..."
                  />
                </div>

                {/* 시간별 자막 */}
                <div>
                  <h3 className="font-medium text-slate-900 mb-3">시간별 자막</h3>
                  <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                    {extractedData.captions.map((caption, index) => (
                      <div
                        key={index}
                        className="flex items-start gap-3 p-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-1 text-xs text-slate-500 min-w-fit">
                          <Clock className="w-3 h-3" />
                          <span>{formatTime(caption.start)}</span>
                          <span>→</span>
                          <span>{formatTime(caption.end)}</span>
                        </div>
                        <div className="text-sm text-slate-900 flex-1">
                          {caption.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!extractedData && !extractCaptionsMutation.isPending && (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-slate-500">
                <Youtube className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p className="text-lg font-medium mb-2">자막을 추출해보세요</p>
                <p className="text-sm">
                  위에 YouTube URL을 입력하고 "자막 추출" 버튼을 클릭하세요.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}