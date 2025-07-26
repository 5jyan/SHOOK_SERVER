import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Download, Copy, Play, Clock, Globe, Youtube, FileText, LogOut } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

interface CaptionData {
  start: number;
  dur: number;
  text: string;
}

interface CaptionResponse {
  success: boolean;
  videoId: string;
  captions: CaptionData[];
  language: string;
  auto: boolean;
  textFormat: string;
  extractionMethod: string;
}

export default function CaptionsPage() {
  const [url, setUrl] = useState("");
  const [captionData, setCaptionData] = useState<CaptionResponse | null>(null);
  const { toast } = useToast();
  const { user, logoutMutation } = useAuth();

  const extractCaptions = useMutation({
    mutationFn: async (videoUrl: string) => {
      const response = await apiRequest("/api/captions/extract", "POST", { url: videoUrl });
      return response as unknown as CaptionResponse;
    },
    onSuccess: (data) => {
      setCaptionData(data);
      toast({
        title: "자막 추출 완료",
        description: `${data.captions.length}개의 자막을 성공적으로 추출했습니다.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "자막 추출 실패",
        description: error.message || "자막을 추출하는데 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast({
        title: "URL을 입력해주세요",
        description: "유튜브 영상 URL을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    extractCaptions.mutate(url.trim());
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "복사 완료",
        description: "자막이 클립보드에 복사되었습니다.",
      });
    } catch (error) {
      toast({
        title: "복사 실패",
        description: "클립보드에 복사하는데 실패했습니다.",
        variant: "destructive",
      });
    }
  };

  const downloadAsText = () => {
    if (!captionData) return;
    
    const blob = new Blob([captionData.textFormat], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${captionData.videoId}_captions.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-slate-900">
                Roving Through
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <nav className="flex items-center space-x-2">
                <Link href="/">
                  <Button variant="ghost" size="sm">
                    <Youtube className="w-4 h-4 mr-2" />
                    채널 관리
                  </Button>
                </Link>
                <Link href="/captions">
                  <Button variant="ghost" size="sm" className="bg-slate-100">
                    <FileText className="w-4 h-4 mr-2" />
                    자막 추출
                  </Button>
                </Link>
              </nav>
              <span className="text-sm text-slate-600">{user?.username}님</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                <LogOut className="w-4 h-4 mr-2" />
                로그아웃
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto p-6 max-w-4xl">
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold">유튜브 자막 추출기</h1>
            <p className="text-muted-foreground mt-2">
              유튜브 영상 URL을 입력하면 한글 자막을 추출해드립니다
            </p>
          </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="w-5 h-5" />
              영상 URL 입력
            </CardTitle>
            <CardDescription>
              유튜브 영상 URL을 입력하세요. 한글 자막이 없으면 자동 자막을 추출합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1"
                disabled={extractCaptions.isPending}
              />
              <Button 
                type="submit" 
                disabled={extractCaptions.isPending}
                className="px-8"
              >
                {extractCaptions.isPending ? "추출 중..." : "자막 추출"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {captionData && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    추출된 자막 정보
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(captionData.textFormat)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      복사
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadAsText}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      다운로드
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">영상 ID</div>
                    <div className="font-mono text-sm">{captionData.videoId}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">언어</div>
                    <Badge variant={captionData.language === 'ko' ? 'default' : 'secondary'}>
                      {captionData.language === 'ko' ? '한국어' : '영어'}
                    </Badge>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">자막 유형</div>
                    <Badge variant={captionData.auto ? 'outline' : 'default'}>
                      {captionData.auto ? '자동 생성' : '수동 작성'}
                    </Badge>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">자막 개수</div>
                    <div className="font-semibold">{captionData.captions.length}개</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>자막 텍스트</CardTitle>
                <CardDescription>
                  타임스탬프와 함께 표시되는 자막입니다
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={captionData.textFormat}
                  readOnly
                  className="min-h-[300px] font-mono text-sm"
                  placeholder="자막 내용이 여기에 표시됩니다..."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  타임라인별 자막
                </CardTitle>
                <CardDescription>
                  각 자막의 시작 시간과 지속 시간을 포함한 상세 정보입니다
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {captionData.captions.map((caption, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 rounded-lg border">
                      <div className="text-xs text-muted-foreground font-mono min-w-[60px]">
                        {formatTime(caption.start)}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono min-w-[40px]">
                        ({caption.dur.toFixed(1)}s)
                      </div>
                      <div className="flex-1 text-sm">
                        {caption.text}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}