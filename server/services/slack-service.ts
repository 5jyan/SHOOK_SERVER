import { SlackService as BaseSlackService } from "../lib/slack";
import { storage } from "../repositories/storage";
import { validateEmail } from "../utils/validation";
import { errorLogger } from "./error-logging-service";

export class SlackServiceExtended {
  private slackService: BaseSlackService;

  constructor() {
    this.slackService = new BaseSlackService();
  }

  async getSlackStatus(user: any) {
    return {
      isConnected: !!user.slackChannelId,
      channelId: user.slackChannelId,
      userId: user.slackUserId,
      joinedAt: user.slackJoinedAt
    };
  }

  // --- Helper functions for setupSlackIntegration ---

  private validateUserEmail(email: string) {
    const validation = validateEmail(email);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }
  }

  private checkIfSlackAlreadySetup(user: any) {
    if (user.slackChannelId) {
      return {
        success: true,
        message: "Slack이 이미 설정되어 있습니다.",
        channelId: user.slackChannelId
      };
    }
    return null; // Slack not yet set up
  }

  private async findSlackUser(email: string) {
    const emailVerification = await this.slackService.verifyEmailInWorkspace(email);
    if (!emailVerification.exists || !emailVerification.userId) {
      throw new Error(`이메일 ${email}로 Slack 워크스페이스에서 사용자를 찾을 수 없습니다. 먼저 워크스페이스에 가입해주세요.`);
    }
    return { id: emailVerification.userId, email };
  }

  private async createAndInviteChannel(channelName: string, username: string, slackUserId: string) {
    const channel = await this.slackService.createPrivateChannel(channelName, username);
    if (!channel) {
      throw new Error("Slack 채널 생성에 실패했습니다.");
    }
    await this.slackService.inviteUserToChannel(channel.id, slackUserId);
    return channel;
  }

  private async updateUserSlackInfoInDb(userId: number, slackUserId: string, slackChannelId: string, slackEmail: string) {
    await storage.updateUserSlackInfo(userId, {
      slackUserId: slackUserId,
      slackChannelId: slackChannelId,
      slackEmail: slackEmail,
      slackJoinedAt: new Date()
    });
  }

  private async sendWelcomeMessageToChannel(channelId: string, username: string) {
    await this.slackService.sendWelcomeMessage(channelId, username);
  }

  // --- Main setupSlackIntegration method ---
  async setupSlackIntegration(user: any, email: string) {
    console.log(`[SLACK_SERVICE] Setting up Slack integration for user ${user.username} with email ${email}`);

    try {
      this.validateUserEmail(email);

      const existingSetup = this.checkIfSlackAlreadySetup(user);
      if (existingSetup) {
        return existingSetup;
      }

      const slackUser = await this.findSlackUser(email);
      const channelName = `${user.username}님의_채널`;
      const channel = await this.createAndInviteChannel(channelName, user.username, slackUser.id);

      await this.updateUserSlackInfoInDb(user.id, slackUser.id, channel.id, email);
      await this.slackService.inviteAdminToChannel(channel.id);
      await this.sendWelcomeMessageToChannel(channel.id, user.username);
      await this.sendExistingChannelSummaries(user.id, channel.id);

      return {
        success: true,
        message: "Slack 채널이 성공적으로 생성되었습니다. 추가된 채널들의 최신 영상 요약도 함께 전송되었습니다.",
        channelId: channel.id,
        channelName: channel.name
      };
    }
    catch (error) {
      await errorLogger.logError(error as Error, {
        service: 'SlackService',
        operation: 'setupSlackIntegration',
        userId: user.id,
        additionalInfo: { email, username: user.username }
      });
      throw error;
    }
  }

  // --- Helper for sendExistingChannelSummaries ---
  private formatSummaryMessage(channelTitle: string, videoTitle: string, caption: string, slackChannelId: string) {
    return {
      channel: slackChannelId,
      text: `🎥 ${channelTitle} - 최신 영상 요약\n\n📹 영상: ${videoTitle}\n\n📝 요약:\n${caption}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎥 *${channelTitle}* - 최신 영상 요약`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📹 *영상:* ${videoTitle}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📝 *요약:*\n${caption}`
          }
        },
        {
          type: "divider"
        }
      ]
    };
  }

  private async sendExistingChannelSummaries(userId: number, slackChannelId: string) {
    try {
      const userChannels = await storage.getUserChannels(userId);
      console.log(`[SLACK_SERVICE] Found ${userChannels.length} channels to send summaries for`);

      for (const userChannel of userChannels) {
        if (userChannel.caption && userChannel.recentVideoTitle) {
          console.log(`[SLACK_SERVICE] Sending summary for channel: ${userChannel.title}`);

          const summaryMessage = this.formatSummaryMessage(
            userChannel.title,
            userChannel.recentVideoTitle,
            userChannel.caption,
            slackChannelId
          );

          await this.slackService.sendMessage(summaryMessage);
        }
      }
    }
    catch (error) {
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


