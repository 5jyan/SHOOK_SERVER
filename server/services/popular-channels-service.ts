import { storage } from "../repositories/storage.js";
import { errorLogger } from "./error-logging-service.js";
import { logWithTimestamp, errorWithTimestamp } from "../utils/timestamp.js";
import { runWithBatchContext } from "../utils/transaction-context.js";

const DAILY_MS = 24 * 60 * 60 * 1000;

export class PopularChannelsService {
  private refreshTimeout: NodeJS.Timeout | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;

  async getPopularChannels() {
    return storage.getPopularChannels();
  }

  async refreshPopularChannels(reason: string): Promise<number> {
    return runWithBatchContext("popular-channels-refresh", async () => {
      try {
        logWithTimestamp(`[POPULAR_CHANNELS] Refresh starting (${reason})`);
        const topChannels = await storage.getTopSubscribedChannels(3);
        const entries = topChannels.map((channel, index) => ({
          rank: index + 1,
          channelId: channel.channelId,
          userSubscriberCount: channel.subscriberCount,
        }));

        await storage.replacePopularChannels(entries);
        logWithTimestamp(`[POPULAR_CHANNELS] Refresh completed (${entries.length} channels)`);
        return entries.length;
      } catch (error) {
        errorWithTimestamp("[POPULAR_CHANNELS] Refresh failed:", error);
        await errorLogger.logError(error as Error, {
          service: "PopularChannelsService",
          operation: "refreshPopularChannels",
          additionalInfo: { reason },
        });
        return 0;
      }
    });
  }

  async ensureCache() {
    const existing = await storage.getPopularChannels();
    if (existing.length === 0) {
      await this.refreshPopularChannels("startup-empty-cache");
    }
  }

  startDailyRefresh(): void {
    if (this.refreshInterval || this.refreshTimeout) {
      logWithTimestamp("[POPULAR_CHANNELS] Daily refresh already scheduled");
      return;
    }

    const scheduleNext = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      const delay = nextMidnight.getTime() - now.getTime();

      this.refreshTimeout = setTimeout(async () => {
        await this.refreshPopularChannels("scheduled");
        this.refreshInterval = setInterval(() => {
          this.refreshPopularChannels("scheduled");
        }, DAILY_MS);
      }, delay);

      logWithTimestamp(`[POPULAR_CHANNELS] Next refresh scheduled in ${Math.round(delay / 1000)}s`);
    };

    scheduleNext();
    this.ensureCache().catch((error) => {
      errorWithTimestamp("[POPULAR_CHANNELS] Failed to ensure cache:", error);
    });
  }

  stopDailyRefresh(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    logWithTimestamp("[POPULAR_CHANNELS] Daily refresh stopped");
  }
}
