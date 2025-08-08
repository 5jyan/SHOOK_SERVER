import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Youtube, Plus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useChannelSearch } from "@/hooks/use-channel-search";
import { YoutubeChannel } from "@shared/schema";

interface ChannelFormProps {
  channelCount: number;
}

export function ChannelForm({ channelCount }: ChannelFormProps) {
  const { toast } = useToast();
  const {
    searchTerm,
    setSearchTerm,
    channels,
    isLoading,
    error,
    selectedChannel,
    setSelectedChannel,
    clearSearch,
  } = useChannelSearch();

  const isChannelLimitReached = channelCount >= 3;

  const addChannelMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const response = await apiRequest("POST", "/api/channels", { channelId });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "채널 추가 성공",
        description: "YouTube 채널이 성공적으로 추가되었습니다.",
      });
      clearSearch();
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channel-videos"] });
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
    if (!selectedChannel) {
      toast({
        title: "채널 선택 필요",
        description: "먼저 검색하여 채널을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    addChannelMutation.mutate(selectedChannel.channelId);
  };

  const handleDoubleClick = (channel: YoutubeChannel) => {
    addChannelMutation.mutate(channel.channelId);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading && channels.length > 0) {
      // Optionally, select the first channel or trigger a specific action
    }
  };

  return (
    <div className="space-y-4 p-1">
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
          채널 이름 검색
        </label>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          추가하려는 YouTube 채널의 이름을 검색해주세요.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder={isChannelLimitReached ? "채널 추가 최대 개수에 도달했습니다." : "채널 이름 입력"}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pl-10"
              disabled={isLoading || addChannelMutation.isPending || isChannelLimitReached}
            />
          </div>
          <Button
            onClick={handleAddChannel}
            disabled={!selectedChannel || addChannelMutation.isPending || isChannelLimitReached}
            className="flex items-center gap-2 flex-shrink-0"
          >
            <Plus className="h-4 w-4" />
            {addChannelMutation.isPending ? "추가 중..." : "채널 추가"}
          </Button>
        </div>
        {isLoading && <p className="text-sm text-gray-500 mt-2">검색 중...</p>}
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        {channels.length > 0 && (
          <div className="mt-4 border rounded-md max-h-60 overflow-y-auto">
            {channels.map((channel: YoutubeChannel) => (
              <div
                key={channel.channelId}
                className={`flex items-center p-2 cursor-pointer transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 ${
                  selectedChannel?.channelId === channel.channelId 
                    ? "bg-gray-200 dark:bg-gray-700" 
                    : ""
                }`}
                onClick={() => setSelectedChannel(channel)}
                onDoubleClick={() => handleDoubleClick(channel)}
              >
                <img
                  src={channel.thumbnail}
                  alt={channel.title}
                  className="w-8 h-8 rounded-full mr-2"
                />
                <p className="text-sm font-medium">{channel.title}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}