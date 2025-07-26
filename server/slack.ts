import { WebClient } from "@slack/web-api";
import crypto from "crypto";
import { storage } from "./storage";

interface SlackUser {
  id: string;
  email: string;
  name: string;
}

interface SlackTeamJoinEvent {
  type: "team_join";
  user: SlackUser;
  event_ts: string;
}

export class SlackService {
  private slack: WebClient;
  private botUserSlack: WebClient;
  private signingSecret: string;

  constructor() {
    console.log(`[SLACK_SERVICE] Initializing Slack service...`);
    
    if (!process.env.SLACK_BOT_TOKEN) {
      console.error(`[SLACK_SERVICE] SLACK_BOT_TOKEN environment variable is missing`);
      throw new Error("SLACK_BOT_TOKEN environment variable must be set");
    }

    if (!process.env.SLACK_BOT_USER_OAUTH_TOKEN) {
      console.error(`[SLACK_SERVICE] SLACK_BOT_USER_OAUTH_TOKEN environment variable is missing`);
      throw new Error("SLACK_BOT_USER_OAUTH_TOKEN environment variable must be set");
    }

    if (!process.env.SLACK_CHANNEL_ID) {
      console.error(`[SLACK_SERVICE] SLACK_CHANNEL_ID environment variable is missing`);
      throw new Error("SLACK_CHANNEL_ID environment variable must be set");
    }

    console.log(`[SLACK_SERVICE] Environment variables validated successfully`);
    
    // Bot 토큰 (채널 생성, 메시지 전송용)
    this.slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    // Bot User OAuth 토큰 (이메일 검증용 - users:read.email 권한 필요)
    this.botUserSlack = new WebClient(process.env.SLACK_BOT_USER_OAUTH_TOKEN);
    this.signingSecret = process.env.SLACK_SIGNING_SECRET || '';
    
    console.log(`[SLACK_SERVICE] WebClient initialized with bot token: ${process.env.SLACK_BOT_TOKEN?.substring(0, 20)}...`);
    console.log(`[SLACK_SERVICE] BotUserSlack initialized with bot user token: ${process.env.SLACK_BOT_USER_OAUTH_TOKEN?.substring(0, 20)}...`);
    console.log(`[SLACK_SERVICE] Signing secret ${this.signingSecret ? 'is set' : 'is not set'}`);
  }

  /**
   * 이메일이 Slack 워크스페이스에 존재하는지 확인
   */
  async verifyEmailInWorkspace(email: string): Promise<{ exists: boolean; userId?: string; userInfo?: any }> {
    try {
      console.log(`[SLACK_SERVICE] Verifying email in workspace: ${email}`);
      console.log(`[SLACK_SERVICE] Using SLACK_BOT_USER_OAUTH_TOKEN for email verification`);
      
      // Bot User OAuth 토큰을 사용하여 이메일 검증 (users:read.email 권한 필요)
      const response = await this.botUserSlack.users.lookupByEmail({
        email: email
      });

      console.log(`[SLACK_SERVICE] Slack API users.lookupByEmail response:`, {
        ok: response.ok,
        error: response.error,
        userId: response.user?.id,
        userProfile: response.user?.profile
      });

      if (response.ok && response.user) {
        console.log(`[SLACK_SERVICE] Email ${email} found in workspace with user ID: ${response.user.id}`);
        return {
          exists: true,
          userId: response.user.id,
          userInfo: response.user
        };
      } else {
        console.log(`[SLACK_SERVICE] Email ${email} not found in workspace. Error: ${response.error}`);
        return { exists: false };
      }
    } catch (error) {
      console.error(`[SLACK_SERVICE] Error verifying email in workspace:`, error);
      return { exists: false };
    }
  }

  /**
   * 요청 서명 검증
   */
  async verifyRequest(body: string, signature: string, timestamp: string): Promise<boolean> {
    try {
      console.log(`[SLACK_SERVICE] Verifying request signature...`);
      console.log(`[SLACK_SERVICE] Signature: ${signature}`);
      console.log(`[SLACK_SERVICE] Timestamp: ${timestamp}`);
      
      // Verify timestamp (should be within 5 minutes)
      const time = Math.floor(new Date().getTime() / 1000);
      const timeDiff = Math.abs(time - parseInt(timestamp));
      
      console.log(`[SLACK_SERVICE] Current time: ${time}, Request time: ${timestamp}, Difference: ${timeDiff}s`);
      
      if (timeDiff > 300) {
        console.log(`[SLACK_SERVICE] Request timestamp too old: ${timeDiff}s > 300s`);
        return false;
      }

      // Create signature
      const sigBasestring = 'v0:' + timestamp + ':' + body;
      const mySignature = 'v0=' + crypto
        .createHmac('sha256', this.signingSecret)
        .update(sigBasestring, 'utf8')
        .digest('hex');

      console.log(`[SLACK_SERVICE] Generated signature: ${mySignature}`);
      
      const isValid = crypto.timingSafeEqual(
        Buffer.from(mySignature, 'utf8'),
        Buffer.from(signature, 'utf8')
      );

      console.log(`[SLACK_SERVICE] Signature verification result: ${isValid}`);
      return isValid;
    } catch (error) {
      console.error(`[SLACK_SERVICE] Error verifying request:`, error);
      return false;
    }
  }

  /**
   * 프라이빗 채널 생성
   */
  async createPrivateChannel(channelName: string, userName: string): Promise<{ id: string; name: string } | null> {
    try {
      console.log(`[SLACK_SERVICE] Creating private channel: ${channelName} for user: ${userName}`);
      
      const response = await this.slack.conversations.create({
        name: channelName,
        is_private: true
      });

      console.log(`[SLACK_SERVICE] conversations.create response:`, {
        ok: response.ok,
        error: response.error,
        channelId: response.channel?.id,
        channelName: response.channel?.name
      });
      
      if (response.ok && response.channel) {
        console.log(`[SLACK_SERVICE] Successfully created private channel: ${response.channel.name} (ID: ${response.channel.id})`);
        return {
          id: response.channel.id!,
          name: response.channel.name!
        };
      } else {
        console.error(`[SLACK_SERVICE] Failed to create channel. Error: ${response.error}`);
        return null;
      }
    } catch (error) {
      console.error(`[SLACK_SERVICE] Error creating channel:`, error);
      return null;
    }
  }

  /**
   * 사용자를 채널에 초대
   */
  async inviteUserToChannel(channelId: string, userId: string): Promise<boolean> {
    try {
      console.log(`[SLACK_SERVICE] Inviting user ${userId} to channel ${channelId}`);
      
      const response = await this.slack.conversations.invite({
        channel: channelId,
        users: userId
      });

      console.log(`[SLACK_SERVICE] conversations.invite response:`, {
        ok: response.ok,
        error: response.error
      });
      
      if (response.ok) {
        console.log(`[SLACK_SERVICE] Successfully invited user ${userId} to channel ${channelId}`);
        return true;
      } else {
        console.error(`[SLACK_SERVICE] Failed to invite user to channel. Error: ${response.error}`);
        return false;
      }
    } catch (error) {
      console.error(`[SLACK_SERVICE] Error inviting user to channel:`, error);
      return false;
    }
  }

  /**
   * 일반 메시지 전송
   */
  async sendMessage(message: any): Promise<string | undefined> {
    try {
      console.log(`[SLACK_SERVICE] Sending message to channel ${message.channel}`);
      
      const response = await this.slack.chat.postMessage(message);

      console.log(`[SLACK_SERVICE] chat.postMessage response:`, {
        ok: response.ok,
        error: response.error,
        ts: response.ts
      });
      
      if (response.ok) {
        console.log(`[SLACK_SERVICE] Message sent successfully to channel ${message.channel}`);
        return response.ts;
      } else {
        console.error(`[SLACK_SERVICE] Failed to send message. Error: ${response.error}`);
        return undefined;
      }
    } catch (error) {
      console.error(`[SLACK_SERVICE] Error sending message:`, error);
      return undefined;
    }
  }

  /**
   * 환영 메시지 전송
   */
  async sendWelcomeMessage(channelId: string, userName: string): Promise<void> {
    try {
      console.log(`[SLACK_SERVICE] Sending welcome message to channel ${channelId} for user ${userName}`);
      
      const message = {
        channel: channelId,
        text: `안녕하세요 ${userName}님! 🎉`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `안녕하세요 *${userName}*님! YouTube 영상 요약 서비스에 오신 것을 환영합니다! 🎉`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "이 채널에서 구독하신 YouTube 채널의 새로운 영상 요약을 받아보실 수 있습니다.\n\n📺 새로운 영상이 업로드되면 자동으로 요약본을 전달해드립니다.\n⏰ 10분마다 새로운 영상을 확인합니다.\n📝 영상 자막을 분석하여 핵심 내용을 요약해드립니다."
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*웹사이트에서 YouTube 채널을 추가하시면 요약 서비스가 시작됩니다!*"
            }
          }
        ]
      };

      const response = await this.slack.chat.postMessage(message);

      console.log(`[SLACK_SERVICE] chat.postMessage response:`, {
        ok: response.ok,
        error: response.error,
        ts: response.ts
      });
      
      if (response.ok) {
        console.log(`[SLACK_SERVICE] Welcome message sent successfully to channel ${channelId}`);
      } else {
        console.error(`[SLACK_SERVICE] Failed to send welcome message. Error: ${response.error}`);
      }
    } catch (error) {
      console.error(`[SLACK_SERVICE] Error sending welcome message:`, error);
    }
  }

  /**
   * 비디오 요약 메시지 전송
   */
  async sendVideoSummary(channelId: string, videoTitle: string, videoUrl: string, summary: string): Promise<void> {
    try {
      console.log(`[SLACK_SERVICE] Sending video summary to channel ${channelId}`);
      console.log(`[SLACK_SERVICE] Video: ${videoTitle}`);
      console.log(`[SLACK_SERVICE] URL: ${videoUrl}`);
      
      const message = {
        channel: channelId,
        text: `새로운 영상 요약: ${videoTitle}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🎬 새로운 영상 요약"
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${videoTitle}*\n\n${summary}`
            },
            accessory: {
              type: "button",
              text: {
                type: "plain_text",
                text: "영상 보기 🎥"
              },
              url: videoUrl,
              action_id: "view_video"
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `🔗 <${videoUrl}|영상 링크>`
              }
            ]
          }
        ]
      };

      const response = await this.slack.chat.postMessage(message);

      console.log(`[SLACK_SERVICE] Video summary chat.postMessage response:`, {
        ok: response.ok,
        error: response.error,
        ts: response.ts
      });
      
      if (response.ok) {
        console.log(`[SLACK_SERVICE] Video summary sent successfully to channel ${channelId}`);
      } else {
        console.error(`[SLACK_SERVICE] Failed to send video summary. Error: ${response.error}`);
      }
    } catch (error) {
      console.error(`[SLACK_SERVICE] Error sending video summary:`, error);
    }
  }

  /**
   * Team join 이벤트 처리
   */
  async handleTeamJoinEvent(event: SlackTeamJoinEvent): Promise<void> {
    try {
      console.log(`[SLACK_SERVICE] Processing team join event for user: ${event.user.email}`);
      console.log(`[SLACK_SERVICE] User details:`, {
        id: event.user.id,
        email: event.user.email,
        name: event.user.name,
        event_ts: event.event_ts
      });
      
      // 이메일로 우리 데이터베이스에서 사용자 찾기
      const user = await storage.getUserByEmail(event.user.email);
      if (!user) {
        console.log(`[SLACK_SERVICE] User not found in database: ${event.user.email}`);
        return;
      }

      console.log(`[SLACK_SERVICE] Found user in database: ${user.username} (ID: ${user.id})`);

      // 사용자 전용 채널 생성
      const channelName = `${user.username}-channel`;
      const channel = await this.createPrivateChannel(channelName, user.username);
      
      if (channel) {
        // 사용자를 채널에 초대
        const inviteSuccess = await this.inviteUserToChannel(channel.id, event.user.id);
        
        // 데이터베이스에 Slack 연동 정보 저장
        await storage.updateUserSlackInfo(user.id, {
          slackUserId: event.user.id,
          slackChannelId: channel.id,
          slackJoinedAt: new Date()
        });

        console.log(`[SLACK_SERVICE] Successfully updated database with Slack info for user ${user.username}`);
        
        // 관리자 추가
        console.log(`[SLACK_SERVICE] Adding admin to channel ${channel.id}`);
        const adminEmail = 'saulpark12@gmail.com';
        const adminVerification = await this.verifyEmailInWorkspace(adminEmail);
        
        if (adminVerification.exists) {
          console.log(`[SLACK_SERVICE] Admin email ${adminEmail} found, inviting to channel`);
          const adminInviteSuccess = await this.inviteUserToChannel(channel.id, adminVerification.userId!);
          if (adminInviteSuccess) {
            console.log(`[SLACK_SERVICE] Admin successfully added to channel`);
          } else {
            console.log(`[SLACK_SERVICE] Failed to add admin to channel`);
          }
        } else {
          console.log(`[SLACK_SERVICE] Admin email ${adminEmail} not found in workspace`);
        }
        
        // 환영 메시지 전송
        await this.sendWelcomeMessage(channel.id, user.username);
        
        console.log(`[SLACK_SERVICE] Team join event processed successfully for user ${user.username}`);
      } else {
        console.error(`[SLACK_SERVICE] Failed to create channel for user ${user.username}`);
      }
    } catch (error) {
      console.error(`[SLACK_SERVICE] Error handling team join event:`, error);
    }
  }
}

export const slackService = new SlackService();