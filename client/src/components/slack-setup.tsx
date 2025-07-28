import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import slackIcon from "@assets/icons8-새로운-slack-48_1753583884909.png";
import { Mail, Send, CheckCircle, Bot, ExternalLink, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface SlackSetupProps {
  isSlackConnected: boolean;
  onBack: () => void;
}

const SLACK_INVITE_URL = "https://join.slack.com/t/newsfeed-fcm6025/shared_invite/zt-38tfhkqx0-kKR5RJe43a8LbbnP4ei5ww";

export function SlackSetup({ isSlackConnected, onBack }: SlackSetupProps) {
  const { toast } = useToast();
  const [userEmail, setUserEmail] = useState("");
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [workspaceJoined, setWorkspaceJoined] = useState(false);

  const slackSetupMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await apiRequest("/api/slack/setup", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Slack 설정 완료",
        description: "Slack 채널이 성공적으로 생성되었습니다. 이제 요약을 받아보실 수 있습니다!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: (error: any) => {
      toast({
        title: "Slack 설정 실패",
        description: error.message || "Slack 설정 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleSlackSetup = async () => {
    if (!userEmail) {
      toast({
        title: "이메일 입력 필요",
        description: "Slack 워크스페이스에서 사용하는 이메일을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    slackSetupMutation.mutate(userEmail);
  };

  if (isSlackConnected) {
    return (
      <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="p-2 h-auto"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3">
              <img src={slackIcon} alt="Slack" className="w-8 h-8" />
              <CardTitle className="flex items-center gap-2 text-green-800 dark:text-green-200">
                <CheckCircle className="h-5 w-5" />
                Slack 연동 완료
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="bg-green-600 text-white">
                <Bot className="h-3 w-3 mr-1" />
                연결됨
              </Badge>
              <span className="text-sm text-green-700 dark:text-green-300">
                이제 새로운 영상 요약을 Slack에서 받아보실 수 있습니다!
              </span>
            </div>
            <p className="text-sm text-green-600 dark:text-green-400">
              YouTube 채널을 추가하면 새로운 영상이 업로드될 때마다 자동으로 요약을 전송해드립니다.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="p-2 h-auto"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <img src={slackIcon} alt="Slack" className="w-8 h-8" />
            <CardTitle>Slack 연동 설정</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!showEmailInput ? (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium mb-2">1단계: Slack 워크스페이스 가입</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                먼저 아래 링크를 통해 Slack 워크스페이스에 가입해주세요.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(SLACK_INVITE_URL, "_blank")}
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Slack 워크스페이스 가입
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setWorkspaceJoined(true)}
                  disabled={workspaceJoined}
                >
                  {workspaceJoined ? <CheckCircle className="h-4 w-4" /> : "가입 완료"}
                </Button>
              </div>
            </div>

            {workspaceJoined && (
              <div>
                <h3 className="font-medium mb-2">2단계: 연동 설정</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  워크스페이스 가입이 완료되었다면 연동을 진행할 수 있습니다.
                </p>
                <Button
                  onClick={() => setShowEmailInput(true)}
                  className="flex items-center gap-2"
                >
                  <Send className="h-4 w-4" />
                  연동 설정 시작
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium mb-2">Slack 이메일 입력</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Slack 워크스페이스에서 사용하는 이메일 주소를 입력해주세요.
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="email"
                    placeholder="your-email@example.com"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    className="pl-10"
                    disabled={slackSetupMutation.isPending}
                  />
                </div>
                <Button
                  onClick={handleSlackSetup}
                  disabled={!userEmail || slackSetupMutation.isPending}
                  className="flex-shrink-0"
                >
                  {slackSetupMutation.isPending ? "설정 중..." : "연동 완료"}
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEmailInput(false)}
              className="w-full"
            >
              이전 단계로
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}