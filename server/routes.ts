import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { slackService } from "./slack";
import { YouTubeSummaryService } from "./youtube-summary";

export function registerRoutes(app: Express): Server {
  // sets up /api/register, /api/login, /api/logout, /api/user
  setupAuth(app);

  // Initialize YouTube Summary Service
  const youtubeSummaryService = new YouTubeSummaryService();

  // YouTube Channel Management Routes
  app.get("/api/channels/:userId", async (req, res) => {
    console.log(`[CHANNELS] Received GET /api/channels/${req.params.userId} request`);
    console.log(`[CHANNELS] Authentication status: ${req.isAuthenticated()}`);
    console.log(`[CHANNELS] User info:`, req.user);
    console.log(`[CHANNELS] Requested userId: ${req.params.userId}`);
    
    if (!req.isAuthenticated()) {
      console.log(`[CHANNELS] Request rejected - user not authenticated`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 요청된 userId가 현재 로그인한 사용자의 ID와 일치하는지 확인
    const requestedUserId = parseInt(req.params.userId, 10);
    if (requestedUserId !== req.user.id) {
      console.log(`[CHANNELS] Access denied - user ${req.user.id} tried to access user ${requestedUserId}'s channels`);
      return res.status(403).json({ error: "Forbidden" });
    }
    
    try {
      console.log(`[CHANNELS] Getting channels for user ${req.user.id}`);
      const channels = await storage.getUserChannels(req.user.id);
      console.log(`[CHANNELS] Found ${channels.length} channels for user ${req.user.id}`);
      res.json(channels);
    } catch (error) {
      console.error("[CHANNELS] Error getting user channels:", error);
      res.status(500).json({ error: "Failed to get channels" });
    }
  });

  app.post("/api/channels", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      console.log(`[CHANNELS] Adding channel request from user ${req.user.id}:`, req.body);
      
      const { handle } = req.body;
      if (!handle || !handle.startsWith('@')) {
        console.log(`[CHANNELS] Invalid handle format: ${handle}`);
        return res.status(400).json({ error: "핸들러는 @로 시작해야 합니다" });
      }

      // 1. 먼저 YouTube 채널 테이블에서 handle로 검색
      console.log(`[CHANNELS] Checking if channel exists in database for handle: ${handle}`);
      let youtubeChannel = await storage.getYoutubeChannelByHandle(handle);
      let channelId: string;

      if (youtubeChannel) {
        // 기존 채널이 있는 경우
        console.log(`[CHANNELS] Found existing channel in database:`, youtubeChannel);
        channelId = youtubeChannel.channelId;
      } else {
        // 새로운 채널인 경우 YouTube API 호출
        const channelHandle = handle.substring(1); // Remove @ from handle for API call
        console.log(`[CHANNELS] Channel not found in database, calling YouTube API for handle: ${channelHandle}`);

        const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${channelHandle}&key=${process.env.YOUTUBE_API_KEY}`;
        console.log(`[CHANNELS] Making YouTube API request to: ${youtubeApiUrl}`);
        
        const response = await fetch(youtubeApiUrl);
        const data = await response.json();
        
        console.log(`[CHANNELS] YouTube API response status: ${response.status}`);
        console.log(`[CHANNELS] YouTube API response:`, JSON.stringify(data, null, 2));

        if (!response.ok) {
          console.error(`[CHANNELS] YouTube API error: ${response.status} - ${data.error?.message || 'Unknown error'}`);
          return res.status(400).json({ error: "YouTube API 요청이 실패했습니다" });
        }

        if (!data.items || data.items.length === 0) {
          console.log(`[CHANNELS] No channel found for handle: ${channelHandle}`);
          return res.status(404).json({ error: "채널 정보가 확인되지 않습니다" });
        }

        const channelData = data.items[0];
        console.log(`[CHANNELS] Found channel data from API:`, {
          id: channelData.id,
          title: channelData.snippet.title,
          subscriberCount: channelData.statistics.subscriberCount,
          videoCount: channelData.statistics.videoCount
        });

        channelId = channelData.id;

        // YouTube 채널 테이블에 새 채널 추가
        youtubeChannel = await storage.createOrUpdateYoutubeChannel({
          channelId: channelData.id,
          handle: handle,
          title: channelData.snippet.title,
          description: channelData.snippet.description || "",
          thumbnail: channelData.snippet.thumbnails?.default?.url || "",
          subscriberCount: channelData.statistics.subscriberCount || "0",
          videoCount: channelData.statistics.videoCount || "0"
        });
        console.log(`[CHANNELS] Created new channel in database:`, youtubeChannel);
      }

      // 2. 사용자가 이미 구독하고 있는지 확인
      const isSubscribed = await storage.isUserSubscribedToChannel(req.user.id, channelId);
      if (isSubscribed) {
        console.log(`[CHANNELS] User ${req.user.id} already subscribed to channel: ${channelId}`);
        return res.status(409).json({ error: "이미 추가된 채널입니다" });
      }

      // 3. user_channels 테이블에 매핑 추가
      const subscription = await storage.subscribeUserToChannel(req.user.id, channelId);
      console.log(`[CHANNELS] Successfully subscribed user ${req.user.id} to channel ${channelId}:`, {
        youtubeChannel,
        subscription
      });
      
      res.status(201).json({
        ...youtubeChannel,
        subscriptionId: subscription.id,
        subscribedAt: subscription.createdAt
      });

    } catch (error) {
      console.error("[CHANNELS] Error adding channel:", error);
      res.status(500).json({ error: "채널 추가 중 오류가 발생했습니다" });
    }
  });

  app.delete("/api/channels/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { channelId } = req.params;
      console.log(`[CHANNELS] Unsubscribing user ${req.user.id} from channel ${channelId}`);
      
      await storage.unsubscribeUserFromChannel(req.user.id, channelId);
      console.log(`[CHANNELS] Successfully unsubscribed user ${req.user.id} from channel ${channelId}`);
      
      res.status(200).json({ message: "Channel unsubscribed successfully" });
    } catch (error) {
      console.error("[CHANNELS] Error unsubscribing from channel:", error);
      res.status(500).json({ error: "Failed to unsubscribe from channel" });
    }
  });

  // Slack Manual Setup API endpoint
  app.post("/api/slack/setup", async (req, res) => {
    console.log(`[SLACK_SETUP] Received setup request`);
    
    if (!req.isAuthenticated()) {
      console.log(`[SLACK_SETUP] User not authenticated`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { email } = req.body;
      console.log(`[SLACK_SETUP] Manual setup request from user ${req.user.id} (${req.user.username}) with email: ${email}`);

      if (!email || !email.includes('@')) {
        console.log(`[SLACK_SETUP] Invalid email format: ${email}`);
        return res.status(400).json({ error: "올바른 이메일 주소를 입력해주세요" });
      }

      // 1. Slack 워크스페이스에서 이메일 확인
      console.log(`[SLACK_SETUP] Verifying email ${email} in Slack workspace...`);
      const emailVerification = await slackService.verifyEmailInWorkspace(email);
      
      if (!emailVerification.exists) {
        console.log(`[SLACK_SETUP] Email ${email} not found in Slack workspace`);
        return res.status(400).json({ 
          error: "입력하신 이메일이 Slack 워크스페이스에 존재하지 않습니다. 먼저 워크스페이스에 가입해주세요." 
        });
      }

      console.log(`[SLACK_SETUP] Email ${email} verified in workspace. Slack User ID: ${emailVerification.userId}`);

      // 2. 사용자 이메일 업데이트
      console.log(`[SLACK_SETUP] Updating user ${req.user.id} email to: ${email}`);
      await storage.updateUserEmail(req.user.id, email);
      console.log(`[SLACK_SETUP] Successfully updated user email`);

      // 3. 사용자 전용 채널 생성
      const channelName = `${req.user.username}-channel`;
      console.log(`[SLACK_SETUP] Creating private channel: ${channelName} for user: ${req.user.username}`);
      
      const channel = await slackService.createPrivateChannel(channelName, req.user.username);
      
      if (!channel) {
        console.error(`[SLACK_SETUP] Failed to create channel for user ${req.user.username}`);
        return res.status(500).json({ error: "채널 생성에 실패했습니다" });
      }

      console.log(`[SLACK_SETUP] Successfully created channel: ${channel.name} (ID: ${channel.id})`);

      // 4. 사용자를 채널에 초대
      console.log(`[SLACK_SETUP] Inviting user ${emailVerification.userId} to channel ${channel.id}`);
      const inviteSuccess = await slackService.inviteUserToChannel(channel.id, emailVerification.userId!);
      
      if (!inviteSuccess) {
        console.error(`[SLACK_SETUP] Failed to invite user to channel`);
        return res.status(500).json({ error: "사용자를 채널에 초대하는데 실패했습니다" });
      }

      console.log(`[SLACK_SETUP] Successfully invited user to channel`);

      // 5. 데이터베이스에 Slack 연동 정보 저장
      console.log(`[SLACK_SETUP] Updating database with Slack info for user ${req.user.id}`);
      await storage.updateUserSlackInfo(req.user.id, {
        slackUserId: emailVerification.userId!,
        slackChannelId: channel.id,
        slackJoinedAt: new Date()
      });
      console.log(`[SLACK_SETUP] Successfully updated database with Slack info`);

      // 6. 관리자 추가
      console.log(`[SLACK_SETUP] Adding admin to channel ${channel.id}`);
      const adminEmail = 'saulpark12@gmail.com';
      const adminVerification = await slackService.verifyEmailInWorkspace(adminEmail);
      
      if (adminVerification.exists) {
        console.log(`[SLACK_SETUP] Admin email ${adminEmail} found, inviting to channel`);
        const adminInviteSuccess = await slackService.inviteUserToChannel(channel.id, adminVerification.userId!);
        if (adminInviteSuccess) {
          console.log(`[SLACK_SETUP] Admin successfully added to channel`);
        } else {
          console.log(`[SLACK_SETUP] Failed to add admin to channel`);
        }
      } else {
        console.log(`[SLACK_SETUP] Admin email ${adminEmail} not found in workspace`);
      }

      // 7. 환영 메시지 전송
      console.log(`[SLACK_SETUP] Sending welcome message to channel ${channel.id}`);
      await slackService.sendWelcomeMessage(channel.id, req.user.username);
      console.log(`[SLACK_SETUP] Welcome message sent`);
      
      console.log(`[SLACK_SETUP] Slack setup completed successfully for user ${req.user.username}`);
      
      res.json({ 
        success: true, 
        message: "Slack 채널이 성공적으로 생성되었습니다.",
        channelId: channel.id,
        channelName: channel.name
      });

    } catch (error) {
      console.error("[SLACK_SETUP] Error in manual setup:", error);
      res.status(500).json({ error: "슬랙 설정 중 오류가 발생했습니다" });
    }
  });

  // YouTube URL Summary endpoint
  app.post("/api/youtube/summarize", async (req, res) => {
    console.log(`[YOUTUBE_SUMMARY] Received summarize request`);
    
    if (!req.isAuthenticated()) {
      console.log(`[YOUTUBE_SUMMARY] Request rejected - user not authenticated`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { youtubeUrl } = req.body;
      
      if (!youtubeUrl) {
        console.log(`[YOUTUBE_SUMMARY] Missing YouTube URL in request`);
        return res.status(400).json({ error: "YouTube URL이 필요합니다." });
      }

      console.log(`[YOUTUBE_SUMMARY] Processing YouTube URL: ${youtubeUrl} for user: ${req.user.username}`);
      
      // 사용자가 Slack 채널을 설정했는지 확인
      if (!req.user.slackChannelId) {
        console.log(`[YOUTUBE_SUMMARY] User ${req.user.username} does not have Slack channel set up`);
        return res.status(400).json({ error: "먼저 Slack 채널을 설정해주세요." });
      }

      // 1. YouTube URL 처리 (자막 추출 및 요약)
      console.log(`[YOUTUBE_SUMMARY] Starting YouTube processing...`);
      const { transcript, summary } = await youtubeSummaryService.processYouTubeUrl(youtubeUrl);
      
      // 2. Slack 채널로 요약 전송
      console.log(`[YOUTUBE_SUMMARY] Sending summary to Slack channel: ${req.user.slackChannelId}`);
      
      const slackMessage = {
        channel: req.user.slackChannelId,
        text: `🎥 YouTube 영상 요약\n\n📹 영상 링크: ${youtubeUrl}\n\n📝 요약:\n${summary}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🎥 *YouTube 영상 요약*`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn", 
              text: `📹 *영상 링크:* <${youtubeUrl}|YouTube에서 보기>`
            }
          },
          {
            type: "divider"
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📝 *요약:*\n${summary}`
            }
          }
        ]
      };

      const messageResult = await slackService.sendMessage(slackMessage);
      
      if (messageResult) {
        console.log(`[YOUTUBE_SUMMARY] Summary sent successfully to Slack`);
        res.json({ 
          success: true, 
          message: "YouTube 영상이 성공적으로 요약되어 Slack 채널로 전송되었습니다.",
          summary: summary
        });
      } else {
        console.error(`[YOUTUBE_SUMMARY] Failed to send message to Slack`);
        res.status(500).json({ error: "Slack 메시지 전송에 실패했습니다." });
      }

    } catch (error) {
      console.error("[YOUTUBE_SUMMARY] Error processing YouTube URL:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "YouTube 영상 처리 중 오류가 발생했습니다." 
      });
    }
  });

  // Slack Events API endpoint
  app.post("/api/slack/events", async (req, res) => {
    console.log(`[SLACK_EVENTS] Received Slack event`);
    
    try {
      const signature = req.headers['x-slack-signature'] as string;
      const timestamp = req.headers['x-slack-request-timestamp'] as string;
      const body = JSON.stringify(req.body);

      console.log(`[SLACK_EVENTS] Event details:`, {
        type: req.body.type,
        eventType: req.body.event?.type,
        headers: {
          signature: signature ? signature.substring(0, 20) + '...' : 'missing',
          timestamp: timestamp
        }
      });

      // URL verification for initial setup
      if (req.body.type === 'url_verification') {
        console.log(`[SLACK_EVENTS] URL verification challenge received: ${req.body.challenge}`);
        return res.json({ challenge: req.body.challenge });
      }

      // Verify request authenticity
      console.log(`[SLACK_EVENTS] Verifying request signature...`);
      const isValid = await slackService.verifyRequest(body, signature, timestamp);
      if (!isValid) {
        console.log(`[SLACK_EVENTS] Invalid request signature - rejecting request`);
        return res.status(401).json({ error: "Unauthorized" });
      }

      console.log(`[SLACK_EVENTS] Request signature verified successfully`);

      // Handle team_join event
      if (req.body.type === 'event_callback' && req.body.event.type === 'team_join') {
        console.log(`[SLACK_EVENTS] Processing team_join event`);
        console.log(`[SLACK_EVENTS] User profile:`, req.body.event.user.profile);
        
        // team_join 이벤트에서 이메일 정보 추출
        const event = {
          type: 'team_join' as const,
          user: {
            id: req.body.event.user.id,
            email: req.body.event.user.profile.email,
            name: req.body.event.user.profile.display_name || req.body.event.user.profile.real_name
          },
          event_ts: req.body.event.event_ts
        };

        console.log(`[SLACK_EVENTS] Extracted event data:`, event);
        await slackService.handleTeamJoinEvent(event);
        console.log(`[SLACK_EVENTS] Team join event processing completed`);
      } else {
        console.log(`[SLACK_EVENTS] Unhandled event type: ${req.body.type} / ${req.body.event?.type}`);
      }

      console.log(`[SLACK_EVENTS] Sending success response`);
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error("[SLACK_EVENTS] Error processing event:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get monitored videos for user
  app.get("/api/monitored-videos/:userId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const userId = parseInt(req.params.userId);
      
      if (req.user.id !== userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const limit = parseInt(req.query.limit as string) || 20;
      const monitoredVideos = await storage.getMonitoredVideos(userId, limit);
      
      console.log(`[MONITORED_VIDEOS] Retrieved ${monitoredVideos.length} monitored videos for user ${userId}`);
      res.json(monitoredVideos);
      
    } catch (error) {
      console.error("[MONITORED_VIDEOS] Error getting monitored videos:", error);
      res.status(500).json({ error: "모니터링된 영상을 가져오는 중 오류가 발생했습니다" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
