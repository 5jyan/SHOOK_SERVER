import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Youtube, Plus, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ChannelFormProps {
  onBack: () => void;
}

export function ChannelForm({ onBack }: ChannelFormProps) {
  const { toast } = useToast();
  const [channelHandle, setChannelHandle] = useState("");

  const addChannelMutation = useMutation({
    mutationFn: async (handle: string) => {
      const response = await apiRequest("/api/channels", {
        method: "POST",
        body: JSON.stringify({ handle }),
      });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "채널 추가 성공",
        description: "YouTube 채널이 성공적으로 추가되었습니다.",
      });
      setChannelHandle("");
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channel-videos"] });
      onBack();
    },
    onError: (error: any) => {
      toast({
        title: "채널 추가 실패",
        description: error.message || "채널 추가 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleAddChannel = async () => {
    if (!channelHandle.trim()) {
      toast({
        title: "핸들러 입력 필요",
        description: "YouTube 채널 핸들러를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    if (!channelHandle.startsWith("@")) {
      toast({
        title: "올바른 형식 입력",
        description: "핸들러는 @로 시작해야 합니다. (예: @channelname)",
        variant: "destructive",
      });
      return;
    }

    addChannelMutation.mutate(channelHandle.trim());
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddChannel();
    }
  };

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
            <Youtube className="h-6 w-6 text-red-600" />
            <CardTitle>YouTube 채널 추가</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
            채널 핸들러
          </label>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            YouTube 채널의 핸들러를 @로 시작해서 입력해주세요. (예: @channelname)
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Youtube className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="@channelname"
                value={channelHandle}
                onChange={(e) => setChannelHandle(e.target.value)}
                onKeyPress={handleKeyPress}
                className="pl-10"
                disabled={addChannelMutation.isPending}
              />
            </div>
            <Button
              onClick={handleAddChannel}
              disabled={!channelHandle.trim() || addChannelMutation.isPending}
              className="flex items-center gap-2 flex-shrink-0"
            >
              <Plus className="h-4 w-4" />
              {addChannelMutation.isPending ? "추가 중..." : "채널 추가"}
            </Button>
          </div>
        </div>
        
        <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
          <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
            💡 채널 핸들러 찾는 방법
          </h4>
          <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
            <li>1. YouTube에서 원하는 채널로 이동</li>
            <li>2. 채널 홈페이지의 URL에서 @로 시작하는 부분 확인</li>
            <li>3. 예: youtube.com/c/channelname → @channelname</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}