import { apiRequest } from "@/lib/queryClient";
import type { YoutubeChannel } from "@shared/schema";

// Channel API services
export const channelApi = {
  getUserChannels: async (userId: string): Promise<(YoutubeChannel & { subscriptionId: number; subscribedAt: Date | null })[]> => {
    return apiRequest(`/api/channels/${userId}`);
  },

  addChannel: async (handle: string) => {
    return apiRequest("/api/channels", {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
  },

  deleteChannel: async (channelId: string) => {
    return apiRequest(`/api/channels/${channelId}`, {
      method: "DELETE",
    });
  },

  getChannelVideos: async (userId: string): Promise<YoutubeChannel[]> => {
    return apiRequest(`/api/channel-videos/${userId}`);
  },

  searchChannels: async (query: string): Promise<YoutubeChannel[]> => {
    const response = await apiRequest("GET", `/api/channels/search?query=${encodeURIComponent(query)}`);
    return response.json();
  },
};

// Slack API services
export const slackApi = {
  setupSlack: async (email: string) => {
    return apiRequest("/api/slack/setup", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  getSlackStatus: async () => {
    return apiRequest("/api/slack/status");
  },
};

// Summary API services
export const summaryApi = {
  generateSummary: async (url: string) => {
    return apiRequest("/api/summary/generate", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  },

  getSummaryStatus: async (videoId: string) => {
    return apiRequest(`/api/summary/status/${videoId}`);
  },
};