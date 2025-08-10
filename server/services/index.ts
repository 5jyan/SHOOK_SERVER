// Service exports
import { ChannelService } from "./channel-service.js";
import { SlackServiceExtended } from "./slack-service.js";
import { YouTubeMonitor } from "./youtube-monitor.js";
import { YouTubeSummaryService } from "./youtube-summary.js";
import { PushNotificationService } from "./push-notification-service.js";

export const channelService = new ChannelService();
export const slackService = new SlackServiceExtended();
export const youtubeMonitor = new YouTubeMonitor();
export const summaryService = new YouTubeSummaryService();
export const pushNotificationService = new PushNotificationService();
