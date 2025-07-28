import { useQuery, useMutation } from "@tanstack/react-query";
import { channelApi } from "@/services/api";
import { queryClient } from "@/lib/queryClient";
import type { YoutubeChannel } from "@shared/schema";

export function useChannels(userId?: number) {
  const channelsQuery = useQuery<
    (YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]
  >({
    queryKey: ["/api/channels", userId?.toString()],
    queryFn: () => channelApi.getUserChannels(userId!.toString()),
    enabled: !!userId,
    staleTime: 0, // Always fetch fresh data
  });

  const channelVideosQuery = useQuery<YoutubeChannel[]>({
    queryKey: ["/api/channel-videos", userId?.toString()],
    queryFn: () => channelApi.getChannelVideos(userId!.toString()),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minute cache
  });

  const addChannelMutation = useMutation({
    mutationFn: channelApi.addChannel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channel-videos"] });
    },
  });

  const deleteChannelMutation = useMutation({
    mutationFn: channelApi.deleteChannel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channel-videos"] });
    },
  });

  return {
    channels: channelsQuery.data ?? [],
    channelVideos: channelVideosQuery.data ?? [],
    isLoadingChannels: channelsQuery.isLoading,
    isLoadingVideos: channelVideosQuery.isLoading,
    addChannel: addChannelMutation,
    deleteChannel: deleteChannelMutation,
    refetchChannels: channelsQuery.refetch,
  };
}