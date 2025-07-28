import { SlackService as BaseSlackService } from "../slack";
import { storage } from "../storage";
import { validateEmail } from "../utils/validation";
import { errorLogger } from "./error-logging-service";

class SlackServiceExtended {
  private slackService: BaseSlackService;

  constructor() {
    this.slackService = new BaseSlackService();
  }

  async setupSlackIntegration(user: any, email: string) {
    console.log(`[SLACK_SERVICE] Setting up Slack integration for user ${user.username} with email ${email}`);
    
    try {
      // Validate email
      const validation = validateEmail(email);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      // Check if user already has Slack setup
      if (user.slackChannelId) {
        return {
          success: true,
          message: "Slack이 이미 설정되어 있습니다.",
          channelId: user.slackChannelId
        };
      }

      // 1. Find user in Slack workspace
      const emailVerification = await this.slackService.verifyEmailInWorkspace(email);
      if (!emailVerification.exists || !emailVerification.userId) {
        throw new Error(`이메일 ${email}로 Slack 워크스페이스에서 사용자를 찾을 수 없습니다. 먼저 워크스페이스에 가입해주세요.`);
      }
      const slackUser = { id: emailVerification.userId, email };

      // 2. Create private channel
      const channelName = `${user.username}-news`;
      const channel = await this.slackService.createPrivateChannel(channelName, user.username);
      
      if (!channel) {
        throw new Error("Slack 채널 생성에 실패했습니다.");
      }

      // 3. Invite users to channel
      await this.slackService.inviteUserToChannel(channel.id, slackUser.id);

      // 4. Update user in database
      await storage.updateUserSlackInfo(user.id, {
        slackUserId: slackUser.id,
        slackChannelId: channel.id,
        slackJoinedAt: new Date()
      });

      // 5. Send welcome message
      await this.slackService.sendWelcomeMessage(channel.id, user.username);

      // 6. Send summaries of existing channels
      await this.sendExistingChannelSummaries(user.id, channel.id);

      return {
        success: true,
        message: "Slack 채널이 성공적으로 생성되었습니다. 추가된 채널들의 최신 영상 요약도 함께 전송되었습니다.",
        channelId: channel.id,
        channelName: channel.name
      };
    } catch (error) {
      await errorLogger.logError(error as Error, {
        service: 'SlackService',
        operation: 'setupSlackIntegration',
        userId: user.id,
        additionalInfo: { email, username: user.username }
      });
      throw error;
    }
  }

  async getSlackStatus(user: any) {
    return {
      isConnected: !!user.slackChannelId,
      channelId: user.slackChannelId,
      userId: user.slackUserId,
      joinedAt: user.slackJoinedAt
    };
  }

  private async sendExistingChannelSummaries(userId: number, slackChannelId: string) {
    try {
      const userChannels = await storage.getUserChannels(userId);
      console.log(`[SLACK_SERVICE] Found ${userChannels.length} channels to send summaries for`);
      
      for (const userChannel of userChannels) {
        if (userChannel.caption && userChannel.recentVideoTitle) {
          console.log(`[SLACK_SERVICE] Sending summary for channel: ${userChannel.title}`);
          
          const summaryMessage = {
            channel: slackChannelId,
            text: `🎥 ${userChannel.title} - 최신 영상 요약\n\n📹 영상: ${userChannel.recentVideoTitle}\n\n📝 요약:\n${userChannel.caption}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🎥 *${userChannel.title}* - 최신 영상 요약`
                }
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `📹 *영상:* ${userChannel.recentVideoTitle}`
                }
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `📝 *요약:*\n${userChannel.caption}`
                }
              },
              {
                type: "divider"
              }
            ]
          };

          await this.slackService.sendMessage(summaryMessage);
        }
      }
    } catch (error) {
      await errorLogger.logError(error as Error, {
        service: 'SlackService',
        operation: 'sendExistingChannelSummaries',
        userId,
        additionalInfo: { slackChannelId }
      });
      // Don't throw error as Slack setup should still complete
    }
  }
}

export const slackService = new SlackServiceExtended();