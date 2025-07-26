import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Youtube,
  Users,
  Video,
  Trash2,
  Plus,
  Mail,
  Send,
  CheckCircle,
  Clock,
  Bot,
  LogOut,
  Loader2,
  ExternalLink,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { YoutubeChannel } from "@shared/schema";

export default function HomePage() {
  const { user, logoutMutation } = useAuth();
  const { toast } = useToast();
  const [channelHandle, setChannelHandle] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [slackSetupCompleted, setSlackSetupCompleted] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [workspaceJoined, setWorkspaceJoined] = useState(false);
  
  // YouTube 자막 추출 관련 state
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [extractedCaptions, setExtractedCaptions] = useState(null);
  const [captionVideoId, setCaptionVideoId] = useState("");

  // 사용자의 Slack 연동 상태를 확인
  const isSlackConnected = user?.slackChannelId;

  // Slack 초대 링크를 상수로 정의합니다.
  const SLACK_INVITE_URL =
    "https://join.slack.com/t/newsfeed-fcm6025/shared_invite/zt-38tfhkqx0-kKR5RJe43a8LbbnP4ei5ww";

  // Query to get user's channels
  const {
    data: channels = [],
    isLoading: channelsLoading,
    refetch: refetchChannels,
  } = useQuery<
    (YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]
  >({
    queryKey: ["/api/channels", user?.id?.toString()],
    enabled: !!user,
    staleTime: 0, // 캐시를 즉시 만료시켜 항상 최신 데이터 가져오기
    onSuccess: (data) => {
      console.log(
        `[FRONTEND] Successfully fetched ${data.length} channels for user ${user?.id}:`,
        data,
      );
    },
    onError: (error: Error) => {
      console.error(
        `[FRONTEND] Error fetching channels for user ${user?.id}:`,
        error.message,
      );
    },
  });

  // useQuery가 실행되는지 확인하기 위한 로그
  console.log(
    `[FRONTEND] useQuery state - user: ${user?.id}, enabled: ${!!user}, isLoading: ${channelsLoading}, channels: ${channels.length}`,
  );

  // Mutation to add a new channel
  const addChannelMutation = useMutation({
    mutationFn: async (handle: string) => {
      console.log(`[FRONTEND] Adding channel ${handle} for user ${user?.id}`);
      const res = await apiRequest("POST", "/api/channels", { handle });
      return await res.json();
    },
    onSuccess: () => {
      console.log(
        `[FRONTEND] Channel added successfully, invalidating queries for user ${user?.id}`,
      );
      // queryKey를 정확히 맞춰서 invalidate
      queryClient.invalidateQueries({
        queryKey: ["/api/channels", user?.id?.toString()],
      });
      // 채널 목록을 즉시 다시 가져오기
      refetchChannels();
      toast({
        title: "성공",
        description: "채널이 성공적으로 추가되었습니다.",
      });
      setChannelHandle("");
    },
    onError: (error: Error) => {
      console.error(`[FRONTEND] Error adding channel:`, error);
      toast({
        title: "오류",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to delete a channel
  const deleteChannelMutation = useMutation({
    mutationFn: async (channelId: string) => {
      console.log(
        `[FRONTEND] Deleting channel ${channelId} for user ${user?.id}`,
      );
      await apiRequest("DELETE", `/api/channels/${channelId}`);
    },
    onSuccess: () => {
      console.log(
        `[FRONTEND] Channel deleted successfully, invalidating queries for user ${user?.id}`,
      );
      // queryKey를 정확히 맞춰서 invalidate
      queryClient.invalidateQueries({
        queryKey: ["/api/channels", user?.id?.toString()],
      });
      // 채널 목록을 즉시 다시 가져오기
      refetchChannels();
      toast({
        title: "성공",
        description: "채널이 삭제되었습니다.",
      });
    },
    onError: (error: Error) => {
      console.error(`[FRONTEND] Error deleting channel:`, error);
      toast({
        title: "오류",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to setup Slack manually
  const slackSetupMutation = useMutation({
    mutationFn: async (email: string) => {
      console.log(`[FRONTEND] Setting up Slack for user ${user?.id} with email: ${email}`);
      const res = await apiRequest("POST", "/api/slack/setup", { email });
      return await res.json();
    },
    onSuccess: (data) => {
      console.log(`[FRONTEND] Slack setup successful:`, data);
      toast({
        title: "성공",
        description: "Slack 채널이 성공적으로 생성되었습니다! Slack 워크스페이스에서 확인해보세요.",
      });
      setSlackSetupCompleted(true);
      setShowEmailInput(false);
      setUserEmail("");
      // 사용자 정보 갱신
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: (error: Error) => {
      console.error(`[FRONTEND] Error setting up Slack:`, error);
      toast({
        title: "오류",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // YouTube URL에서 영상 ID 추출 Mutation
  const extractVideoIdMutation = useMutation({
    mutationFn: async (url: string) => {
      console.log(`[FRONTEND] Extracting video ID from URL: ${url}`);
      const res = await apiRequest("POST", "/api/captions/extract-video-id", { url });
      return await res.json();
    },
    onSuccess: (data) => {
      console.log(`[FRONTEND] Video ID extracted successfully:`, data);
      setCaptionVideoId(data.videoId);
      toast({
        title: "성공",
        description: `영상 ID가 추출되었습니다: ${data.videoId}`,
      });
    },
    onError: (error: Error) => {
      console.error(`[FRONTEND] Error extracting video ID:`, error);
      toast({
        title: "오류",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // YouTube 자막 추출 Mutation
  const extractCaptionsMutation = useMutation({
    mutationFn: async (videoId: string) => {
      console.log(`[FRONTEND] Extracting captions for video ID: ${videoId}`);
      const res = await apiRequest("GET", `/api/captions/${videoId}?lang=ko`);
      return await res.json();
    },
    onSuccess: (data) => {
      console.log(`[FRONTEND] Captions extracted successfully:`, data);
      setExtractedCaptions(data);
      toast({
        title: "성공",
        description: `${data.captionsCount}개의 자막 세그먼트가 추출되었습니다.`,
      });
    },
    onError: (error: Error) => {
      console.error(`[FRONTEND] Error extracting captions:`, error);
      toast({
        title: "오류",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const handleAddChannel = () => {
    if (!channelHandle.startsWith("@")) {
      toast({
        title: "오류",
        description: "채널 핸들러는 @로 시작해야 합니다.",
        variant: "destructive",
      });
      return;
    }

    addChannelMutation.mutate(channelHandle);
  };

  const handleRemoveChannel = (channelId: string) => {
    deleteChannelMutation.mutate(channelId);
  };

  const handleSlackSetup = () => {
    if (!userEmail || !userEmail.includes('@')) {
      toast({
        title: "오류",
        description: "올바른 이메일 주소를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    slackSetupMutation.mutate(userEmail);
  };

  const handleExtractVideoId = () => {
    if (!youtubeUrl) {
      toast({
        title: "오류",
        description: "YouTube URL을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    extractVideoIdMutation.mutate(youtubeUrl);
  };

  const handleExtractCaptions = () => {
    if (!captionVideoId) {
      toast({
        title: "오류",
        description: "먼저 영상 ID를 추출해주세요.",
        variant: "destructive",
      });
      return;
    }
    extractCaptionsMutation.mutate(captionVideoId);
  };

  const getThumbnailIcon = (type: string) => {
    switch (type) {
      case "house":
        return (
          <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center">
            <div
              className="w-6 h-6 bg-white"
              style={{ clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }}
            ></div>
          </div>
        );
      case "carrot":
        return (
          <div className="w-12 h-12 bg-orange-500 rounded-lg flex items-center justify-center">
            <div className="w-4 h-8 bg-orange-600 rounded-full"></div>
          </div>
        );
      default:
        return (
          <div className="w-12 h-12 bg-gray-400 rounded-lg flex items-center justify-center">
            <Youtube className="w-6 h-6 text-white" />
          </div>
        );
    }
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
              <span className="text-sm text-slate-600">{user?.username}님</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
              >
                <LogOut className="w-4 h-4 mr-2" />
                로그아웃
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Service Title */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-slate-900 mb-4">
            YouTube 영상이 올라오면
            <br />
            요약본을 Slack으로 받아보세요
          </h2>
          <p className="text-slate-600 text-lg">
            좋아하는 채널의 새로운 영상을 놓치지 마세요
          </p>
        </div>

        {/* YouTube Channel Manager */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Youtube className="w-5 h-5 text-red-600" />
              YouTube 채널 관리
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Channel Add Form */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="flex-1">
                <Input
                  type="text"
                  placeholder="@로시작하는 유튜브 채널ID 입력"
                  value={channelHandle}
                  onChange={(e) => setChannelHandle(e.target.value)}
                />
              </div>
              <Button
                onClick={handleAddChannel}
                disabled={addChannelMutation.isPending}
                className="bg-slate-900 hover:bg-slate-800 text-white whitespace-nowrap"
              >
                {addChannelMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                채널 추가
              </Button>
            </div>

            {/* Channel List */}
            <div className="space-y-3">
              {channelsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
                  <span className="ml-2 text-slate-600">
                    채널을 불러오는 중...
                  </span>
                </div>
              ) : channels.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Youtube className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                  <p>아직 추가된 채널이 없습니다.</p>
                  <p className="text-sm">위에서 YouTube 채널을 추가해보세요.</p>
                </div>
              ) : (
                channels.map((channel) => (
                  <div
                    key={channel.subscriptionId}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0 shadow-sm">
                        {channel.thumbnail ? (
                          <img
                            src={channel.thumbnail}
                            alt={`${channel.title} 썸네일`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // 이미지 로딩 실패 시 기본 아이콘으로 대체
                              const target = e.target as HTMLElement;
                              target.style.display = "none";
                              const parent = target.parentElement;
                              if (parent) {
                                parent.innerHTML = `
                                  <div class="w-full h-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                                    <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                                    </svg>
                                  </div>
                                `;
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                            <Youtube className="w-6 h-6 text-white" />
                          </div>
                        )}
                      </div>
                      <div>
                        <h4 className="font-medium text-slate-900">
                          {channel.title}
                        </h4>
                        <p className="text-sm text-slate-500 flex items-center gap-2">
                          <span>{channel.handle}</span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            구독자{" "}
                            {parseInt(
                              channel.subscriberCount || "0",
                            ).toLocaleString()}
                            명
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Video className="w-3 h-3" />
                            동영상{" "}
                            {parseInt(
                              channel.videoCount || "0",
                            ).toLocaleString()}
                            개
                          </span>
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleteChannelMutation.isPending}
                      onClick={() => handleRemoveChannel(channel.channelId)}
                    >
                      {deleteChannelMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 mr-2" />
                      )}
                      삭제
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Slack Integration */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-5 h-5 bg-purple-600 rounded flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-sm"></div>
              </div>
              Slack 연동
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isSlackConnected ? (
              // 연동 완료된 상태
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="relative">
                      <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center">
                        <CheckCircle className="text-white w-6 h-6" />
                      </div>
                      {/* Active 애니메이션 효과 */}
                      <div className="absolute -inset-1 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full opacity-20 animate-ping"></div>
                    </div>
                    <div className="ml-4">
                      <p className="font-semibold text-green-800 text-lg">
                        Slack 채널 연동중
                      </p>
                      <p className="text-green-600 text-sm">
                        새로운 YouTube 영상 요약을 실시간으로 받아보실 수 있습니다
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => window.open(SLACK_INVITE_URL, "_blank")}
                    variant="outline"
                    className="text-purple-600 border-purple-600 hover:bg-purple-50 shrink-0"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Slack 열기
                  </Button>
                </div>
              </div>
            ) : (
              // 연동 안된 상태
              <div className="space-y-4">
                {!showEmailInput ? (
                  // 초기 상태: 워크스페이스 가입 버튼들
                  <div className="text-center space-y-4">
                    <p className="text-slate-600">
                      YouTube 영상 요약을 Slack으로 받기 위해 먼저 워크스페이스에 가입하세요.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <Button
                        onClick={() => window.open(SLACK_INVITE_URL, "_blank")}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Slack 워크스페이스 가입하기
                      </Button>
                      
                      <Button
                        onClick={() => setShowEmailInput(true)}
                        variant="outline"
                        className="border-purple-600 text-purple-600 hover:bg-purple-50"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        가입 완료 했어요
                      </Button>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
                      <div className="flex items-start">
                        <Mail className="text-blue-500 mt-0.5 mr-3 w-4 h-4" />
                        <div className="text-sm text-blue-700">
                          <p className="font-medium mb-2">가입 방법:</p>
                          <ol className="list-decimal list-inside space-y-1">
                            <li>"Slack 워크스페이스 가입하기" 버튼을 클릭하세요</li>
                            <li>이메일 주소로 워크스페이스에 가입하세요</li>
                            <li>"가입 완료 했어요" 버튼을 눌러 다음 단계로 진행하세요</li>
                          </ol>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // 이메일 입력 상태
                  <div className="space-y-4">
                    <div className="text-center">
                      <h3 className="font-semibold text-slate-900 mb-2">
                        Slack 이메일 주소를 입력하세요
                      </h3>
                      <p className="text-slate-600 text-sm">
                        워크스페이스 가입시 사용한 정확한 이메일 주소를 입력해주세요.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input
                        type="email"
                        placeholder="example@email.com"
                        value={userEmail}
                        onChange={(e) => setUserEmail(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        onClick={handleSlackSetup}
                        disabled={slackSetupMutation.isPending}
                        className="bg-purple-600 hover:bg-purple-700 text-white whitespace-nowrap"
                      >
                        {slackSetupMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 mr-2" />
                        )}
                        Slack 채널 생성
                      </Button>
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <AlertTriangle className="text-yellow-500 mt-0.5 mr-3 w-4 h-4" />
                        <div className="text-sm text-yellow-700">
                          <p className="font-medium mb-1">중요:</p>
                          <p>워크스페이스에 가입하지 않은 이메일로는 채널 생성이 불가능합니다.</p>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost" 
                      onClick={() => setShowEmailInput(false)}
                      className="w-full text-slate-500"
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      이전으로
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* YouTube Caption Extraction */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="w-5 h-5 text-red-600" />
              YouTube 자막 추출
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* URL 입력 및 영상 ID 추출 */}
              <div className="space-y-4">
                <h3 className="font-semibold text-slate-900">1. YouTube URL 입력</h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleExtractVideoId}
                    disabled={extractVideoIdMutation.isPending}
                    variant="outline"
                    className="whitespace-nowrap"
                  >
                    {extractVideoIdMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Youtube className="w-4 h-4 mr-2" />
                    )}
                    영상 ID 추출
                  </Button>
                </div>
                
                {captionVideoId && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-green-800 text-sm">
                      <CheckCircle className="w-4 h-4 inline mr-2" />
                      영상 ID: <span className="font-mono font-semibold">{captionVideoId}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* 자막 추출 */}
              <div className="space-y-4">
                <h3 className="font-semibold text-slate-900">2. 자막 추출</h3>
                <Button
                  onClick={handleExtractCaptions}
                  disabled={extractCaptionsMutation.isPending || !captionVideoId}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {extractCaptionsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Video className="w-4 h-4 mr-2" />
                  )}
                  자막 추출 시작
                </Button>
                
                {extractCaptionsMutation.isPending && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center">
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin mr-3" />
                      <div>
                        <p className="font-medium text-blue-800">자막 추출 중...</p>
                        <p className="text-blue-600 text-sm">
                          YouTube 페이지에서 자막을 스크래핑하고 있습니다. 잠시만 기다려주세요.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 추출된 자막 표시 */}
              {extractedCaptions && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-slate-900">3. 추출된 자막</h3>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-medium text-slate-900">
                        영상 ID: {extractedCaptions.videoId}
                      </p>
                      <Badge variant="secondary">
                        {extractedCaptions.captionsCount}개 세그먼트
                      </Badge>
                    </div>
                    
                    {extractedCaptions.captions && extractedCaptions.captions.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {extractedCaptions.captions.map((caption, index) => (
                          <div key={index} className="bg-white border rounded-lg p-3">
                            <div className="flex items-start gap-3">
                              <Badge variant="outline" className="text-xs">
                                {caption.timestamp}
                              </Badge>
                              <p className="text-sm text-slate-700 flex-1">
                                {caption.text}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-slate-500">
                        <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
                        <p>자막을 찾을 수 없습니다.</p>
                        <p className="text-sm">영상에 자막이 없거나 추출에 실패했을 수 있습니다.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 사용법 안내 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start">
                  <Video className="text-blue-500 mt-0.5 mr-3 w-4 h-4" />
                  <div className="text-sm text-blue-700">
                    <p className="font-medium mb-2">사용 안내:</p>
                    <ul className="space-y-1">
                      <li>• YouTube 영상 URL을 입력하고 영상 ID를 추출하세요</li>
                      <li>• 자막 추출을 시작하면 Puppeteer가 YouTube 페이지에서 자막을 스크래핑합니다</li>
                      <li>• 자막이 없는 영상이거나 비공개 영상의 경우 추출이 실패할 수 있습니다</li>
                      <li>• 추출 과정은 최대 1-2분 정도 소요될 수 있습니다</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Service Status */}
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
          <div className="flex items-center mb-4">
            <Bot className="text-blue-600 text-xl mr-3 w-6 h-6" />
            <h3 className="text-lg font-semibold text-slate-900">
              자동화 상태
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-2">
                <CheckCircle className="text-white w-4 h-4" />
              </div>
              <p className="text-sm font-medium text-slate-900">로그인 완료</p>
            </div>

            <div className="text-center">
              <div
                className={`w-8 h-8 ${channels.length > 0 ? "bg-green-500" : "bg-gray-300"} rounded-full flex items-center justify-center mx-auto mb-2`}
              >
                <CheckCircle className="text-white w-4 h-4" />
              </div>
              <p className="text-sm font-medium text-slate-900">
                채널 등록됨 ({channels.length}개)
              </p>
            </div>

            <div className="text-center">
              <div
                className={`w-8 h-8 ${isSlackConnected ? "bg-green-500" : "bg-yellow-500"} rounded-full flex items-center justify-center mx-auto mb-2`}
              >
                {isSlackConnected ? (
                  <CheckCircle className="text-white w-4 h-4" />
                ) : (
                  <Clock className="text-white w-4 h-4" />
                )}
              </div>
              <p className="text-sm font-medium text-slate-900">
                {isSlackConnected ? "Slack 연동 완료" : "Slack 연동 대기"}
              </p>
            </div>
          </div>

          <div className="mt-4 text-center">
            <p className="text-sm text-slate-600">
              모든 단계가 완료되면 10분마다 새로운 영상을 자동으로 확인합니다.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}