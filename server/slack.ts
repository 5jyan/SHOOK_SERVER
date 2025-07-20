
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
  private botToken: string;
  private signingSecret: string;

  constructor() {
    this.botToken = process.env.SLACK_BOT_TOKEN || "";
    this.signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  }

  async verifyRequest(body: string, signature: string, timestamp: string): Promise<boolean> {
    const crypto = require('crypto');
    
    // Verify timestamp (should be within 5 minutes)
    const time = Math.floor(new Date().getTime() / 1000);
    if (Math.abs(time - parseInt(timestamp)) > 300) {
      return false;
    }

    // Create signature
    const sigBasestring = 'v0:' + timestamp + ':' + body;
    const mySignature = 'v0=' + crypto
      .createHmac('sha256', this.signingSecret)
      .update(sigBasestring, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  }

  async handleTeamJoinEvent(event: SlackTeamJoinEvent): Promise<void> {
    try {
      console.log(`[SLACK] Team join event received for user: ${event.user.email}`);
      
      // 이메일로 우리 데이터베이스에서 사용자 찾기
      const user = await storage.getUserByEmail(event.user.email);
      if (!user) {
        console.log(`[SLACK] User not found in database: ${event.user.email}`);
        return;
      }

      console.log(`[SLACK] Found user in database: ${user.username} (ID: ${user.id})`);

      // 사용자 전용 채널 생성
      const channelName = `youtube-summary-${user.id}`;
      const channel = await this.createPrivateChannel(channelName, user.username);
      
      if (channel) {
        // 사용자를 채널에 초대
        await this.inviteUserToChannel(channel.id, event.user.id);
        
        // 데이터베이스에 Slack 연동 정보 저장
        await storage.updateUserSlackInfo(user.id, {
          slackUserId: event.user.id,
          slackChannelId: channel.id,
          slackJoinedAt: new Date()
        });

        console.log(`[SLACK] Successfully set up private channel for user ${user.username}`);
        
        // 환영 메시지 전송
        await this.sendWelcomeMessage(channel.id, user.username);
      }
    } catch (error) {
      console.error('[SLACK] Error handling team join event:', error);
    }
  }

  async createPrivateChannel(channelName: string, userName: string): Promise<{ id: string; name: string } | null> {
    try {
      const response = await fetch('https://slack.com/api/conversations.create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: channelName,
          is_private: true,
          purpose: `${userName}님의 YouTube 영상 요약 전용 채널`
        }),
      });

      const data = await response.json();
      
      if (data.ok) {
        console.log(`[SLACK] Created private channel: ${data.channel.name} (${data.channel.id})`);
        return {
          id: data.channel.id,
          name: data.channel.name
        };
      } else {
        console.error('[SLACK] Failed to create channel:', data.error);
        return null;
      }
    } catch (error) {
      console.error('[SLACK] Error creating channel:', error);
      return null;
    }
  }

  async inviteUserToChannel(channelId: string, userId: string): Promise<boolean> {
    try {
      const response = await fetch('https://slack.com/api/conversations.invite', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelId,
          users: userId
        }),
      });

      const data = await response.json();
      
      if (data.ok) {
        console.log(`[SLACK] Successfully invited user ${userId} to channel ${channelId}`);
        return true;
      } else {
        console.error('[SLACK] Failed to invite user to channel:', data.error);
        return false;
      }
    } catch (error) {
      console.error('[SLACK] Error inviting user to channel:', error);
      return false;
    }
  }

  async sendWelcomeMessage(channelId: string, userName: string): Promise<void> {
    try {
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

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const data = await response.json();
      
      if (data.ok) {
        console.log(`[SLACK] Welcome message sent to channel ${channelId}`);
      } else {
        console.error('[SLACK] Failed to send welcome message:', data.error);
      }
    } catch (error) {
      console.error('[SLACK] Error sending welcome message:', error);
    }
  }

  async sendVideoSummary(channelId: string, videoTitle: string, videoUrl: string, summary: string): Promise<void> {
    try {
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

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const data = await response.json();
      
      if (data.ok) {
        console.log(`[SLACK] Video summary sent to channel ${channelId}`);
      } else {
        console.error('[SLACK] Failed to send video summary:', data.error);
      }
    } catch (error) {
      console.error('[SLACK] Error sending video summary:', error);
    }
  }
}

export const slackService = new SlackService();
