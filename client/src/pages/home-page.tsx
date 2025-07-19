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
  Loader2
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
  const [slackEmail, setSlackEmail] = useState("");
  const [slackJoined, setSlackJoined] = useState(false);

  // Query to get user's channels
  const { data: channels = [], isLoading: channelsLoading, refetch: refetchChannels } = useQuery<(YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]>({
    queryKey: ["/api/channels"],
    enabled: !!user,
  });

  // Mutation to add a new channel
  const addChannelMutation = useMutation({
    mutationFn: async (handle: string) => {
      const res = await apiRequest("POST", "/api/channels", { handle });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      toast({
        title: "성공",
        description: "채널이 성공적으로 추가되었습니다."
      });
      setChannelHandle("");
    },
    onError: (error: Error) => {
      toast({
        title: "오류",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  // Mutation to delete a channel
  const deleteChannelMutation = useMutation({
    mutationFn: async (channelId: string) => {
      await apiRequest("DELETE", `/api/channels/${channelId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      toast({
        title: "성공",
        description: "채널이 삭제되었습니다."
      });
    },
    onError: (error: Error) => {
      toast({
        title: "오류",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const handleAddChannel = () => {
    if (!channelHandle.startsWith('@')) {
      toast({
        title: "오류",
        description: "채널 핸들러는 @로 시작해야 합니다.",
        variant: "destructive"
      });
      return;
    }

    addChannelMutation.mutate(channelHandle);
  };

  const handleRemoveChannel = (channelId: string) => {
    deleteChannelMutation.mutate(channelId);
  };

  const handleSlackInvite = () => {
    if (!slackEmail || !slackEmail.includes('@')) {
      toast({
        title: "오류",
        description: "올바른 이메일 주소를 입력해주세요.",
        variant: "destructive"
      });
      return;
    }

    // TODO: Implement Slack API invitation
    toast({
      title: "성공",
      description: "Slack 초대가 발송되었습니다."
    });
  };

  const getThumbnailIcon = (type: string) => {
    switch(type) {
      case "house": return <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center"><div className="w-6 h-6 bg-white" style={{clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)"}}></div></div>;
      case "carrot": return <div className="w-12 h-12 bg-orange-500 rounded-lg flex items-center justify-center"><div className="w-4 h-8 bg-orange-600 rounded-full"></div></div>;
      default: return <div className="w-12 h-12 bg-gray-400 rounded-lg flex items-center justify-center"><Youtube className="w-6 h-6 text-white" /></div>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-slate-900">Roving Through</h1>
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
            YouTube 영상이 올라오면<br />
            요약본을 Slack으로 받아보세요
          </h2>
          <p className="text-slate-600 text-lg">좋아하는 채널의 새로운 영상을 놓치지 마세요</p>
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
                  <span className="ml-2 text-slate-600">채널을 불러오는 중...</span>
                </div>
              ) : channels.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Youtube className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                  <p>아직 추가된 채널이 없습니다.</p>
                  <p className="text-sm">위에서 YouTube 채널을 추가해보세요.</p>
                </div>
              ) : (
                channels.map((channel) => (
                  <div key={channel.channelId} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
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
                              target.style.display = 'none';
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
                        <h4 className="font-medium text-slate-900">{channel.title}</h4>
                        <p className="text-sm text-slate-500 flex items-center gap-2">
                          <span>{channel.handle}</span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            구독자 {parseInt(channel.subscriberCount || "0").toLocaleString()}명
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Video className="w-3 h-3" />
                            동영상 {parseInt(channel.videoCount || "0").toLocaleString()}개
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
            {!slackJoined ? (
              <>
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                  <div className="flex-1">
                    <Input
                      type="email"
                      placeholder="슬랙 e-mail 주소를 입력하세요"
                      value={slackEmail}
                      onChange={(e) => setSlackEmail(e.target.value)}
                    />
                  </div>
                  <Button 
                    onClick={handleSlackInvite}
                    className="bg-slate-800 hover:bg-slate-900 text-white whitespace-nowrap"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    초대 발송
                  </Button>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start">
                    <Mail className="text-blue-500 mt-0.5 mr-3 w-4 h-4" />
                    <div className="text-sm text-blue-700">
                      <p className="font-medium mb-1">e-mail로 초대 발송이 요청되었습니다.</p>
                      <p>e-mail을 확인하시고 초대를 승인해주세요</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center">
                  <CheckCircle className="text-green-500 mr-3 w-5 h-5" />
                  <div className="text-sm text-green-700">
                    <p className="font-medium">Slack 워크스페이스에 성공적으로 참여했습니다!</p>
                    <p>이제 새로운 YouTube 영상 요약을 받아보실 수 있습니다.</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Service Status */}
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
          <div className="flex items-center mb-4">
            <Bot className="text-blue-600 text-xl mr-3 w-6 h-6" />
            <h3 className="text-lg font-semibold text-slate-900">자동화 상태</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-2">
                <CheckCircle className="text-white w-4 h-4" />
              </div>
              <p className="text-sm font-medium text-slate-900">로그인 완료</p>
            </div>

            <div className="text-center">
              <div className={`w-8 h-8 ${channels.length > 0 ? 'bg-green-500' : 'bg-gray-300'} rounded-full flex items-center justify-center mx-auto mb-2`}>
                <CheckCircle className="text-white w-4 h-4" />
              </div>
              <p className="text-sm font-medium text-slate-900">
                채널 등록됨 ({channels.length}개)
              </p>
            </div>

            <div className="text-center">
              <div className={`w-8 h-8 ${slackJoined ? 'bg-green-500' : 'bg-yellow-500'} rounded-full flex items-center justify-center mx-auto mb-2`}>
                {slackJoined ? <CheckCircle className="text-white w-4 h-4" /> : <Clock className="text-white w-4 h-4" />}
              </div>
              <p className="text-sm font-medium text-slate-900">
                {slackJoined ? 'Slack 연동 완료' : 'Slack 연동 대기'}
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