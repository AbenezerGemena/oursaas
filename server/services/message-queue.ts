import { db } from "../db";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { messageQueue, channels, campaigns } from "@shared/schema";
import { eq, and, lte, or, isNull, sql, inArray } from "drizzle-orm";
import { WhatsAppApiService } from "./whatsapp-api";
import { storage } from '../storage';
import { cacheGet, CACHE_KEYS, CACHE_TTL } from './cache';
import { initBullQueue, isBullQueueAvailable, addBulkMessagesToBullQueue, getBullQueueStats } from './bull-queue';

export class MessageQueueService {
  private static isProcessing = false;
  private static processingTimeout: NodeJS.Timeout | null = null;
  private static currentBackoffMs = 5000;
  private static readonly MIN_BACKOFF_MS = 5000;
  private static readonly MAX_BACKOFF_MS = 30000;
  private static readonly BATCH_SIZE = process.env.MESSAGE_QUEUE_BATCH_SIZE
    ? parseInt(process.env.MESSAGE_QUEUE_BATCH_SIZE, 10)
    : 50;
  private static usingBullMQ = false;

  static async startProcessing(intervalMs: number = 5000) {
    if (this.processingTimeout) {
      return;
    }

    const bullInitialized = await initBullQueue();
    if (bullInitialized) {
      this.usingBullMQ = true;
      console.log("[MessageQueue] Using BullMQ for message processing (Redis-backed)");
      return;
    }

    this.currentBackoffMs = process.env.MESSAGE_QUEUE_INTERVAL_MS
      ? parseInt(process.env.MESSAGE_QUEUE_INTERVAL_MS, 10)
      : intervalMs;

    this.scheduleNext();

    console.log(`[MessageQueue] Using DB polling fallback (batch size: ${this.BATCH_SIZE}, initial interval: ${this.currentBackoffMs}ms)`);
  }

  private static scheduleNext() {
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }
    this.processingTimeout = setTimeout(async () => {
      if (!this.isProcessing) {
        await this.processQueue();
      }
      this.scheduleNext();
    }, this.currentBackoffMs);
  }

  static async stopProcessing() {
    if (this.usingBullMQ) {
      const { shutdownBullQueue } = await import('./bull-queue');
      await shutdownBullQueue();
      this.usingBullMQ = false;
      console.log("[MessageQueue] BullMQ processing stopped");
      return;
    }
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
      console.log("[MessageQueue] DB polling processing stopped");
    }
  }

  private static async processQueue() {
    this.isProcessing = true;

    try {
      const lockResult = await db.execute(sql`SELECT pg_try_advisory_lock(42424242) AS acquired`);
      const acquired = (lockResult as any).rows?.[0]?.acquired ?? (lockResult as any)[0]?.acquired;
      if (!acquired) {
        return;
      }

      try {
        await db
          .update(messageQueue)
          .set({ status: "queued" })
          .where(
            and(
              eq(messageQueue.status, "processing"),
              sql`${messageQueue.processedAt} < NOW() - INTERVAL '5 minutes'`
            )
          );

        const messages = await db
          .select()
          .from(messageQueue)
          .where(
            and(
              eq(messageQueue.status, "queued"),
              lte(messageQueue.attempts, 3),
              or(
                isNull(messageQueue.scheduledFor),
                sql`${messageQueue.scheduledFor} <= NOW()`
              )
            )
          )
          .limit(this.BATCH_SIZE);

        if (messages.length === 0) {
          this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.MAX_BACKOFF_MS);
          return;
        }

        this.currentBackoffMs = this.MIN_BACKOFF_MS;

        const messageIds = messages.map(m => m.id);
        await db
          .update(messageQueue)
          .set({
            status: "processing",
            processedAt: new Date()
          })
          .where(inArray(messageQueue.id, messageIds));

        const channelIds = [...new Set(messages.map(m => m.channelId).filter(Boolean))];
        const channelCache = new Map<string, any>();
        if (channelIds.length > 0) {
          const fetchedChannels = await db
            .select()
            .from(channels)
            .where(inArray(channels.id, channelIds));
          for (const ch of fetchedChannels) {
            channelCache.set(ch.id, ch);
          }
        }

        for (const message of messages) {
          await this.processMessage(message, channelCache);
        }
      } finally {
        await db.execute(sql`SELECT pg_advisory_unlock(42424242)`);
      }
    } catch (error) {
      console.error("[MessageQueue] Error processing queue:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  private static async processMessage(message: any, channelCache?: Map<string, any>) {
    try {

      let channel = channelCache?.get(message.channelId);
      if (!channel) {
        channel = await cacheGet(
          CACHE_KEYS.channel(message.channelId),
          CACHE_TTL.channel,
          async () => {
            const [ch] = await db
              .select()
              .from(channels)
              .where(eq(channels.id, message.channelId))
              .limit(1);
            return ch || null;
          }
        );
      }

      if (!channel) {
        throw new Error(`Channel not found: ${message.channelId}`);
      }

      const canSend = await WhatsAppApiService.checkRateLimit(channel.id);
      if (!canSend) {
        await db
          .update(messageQueue)
          .set({ 
            status: "queued",
            scheduledFor: new Date(Date.now() + 5000)
          })
          .where(eq(messageQueue.id, message.id));
        return;
      }

      const isMarketing = message.messageType === "marketing" && 
                         message.sentVia !== "cloud_api";

      let response;
      if (message.templateName) {
        response = await WhatsAppApiService.sendTemplateMessage(
          channel,
          message.recipientPhone,
          message.templateName,
          message.templateParams || [],
          "en_US",
          isMarketing
        );
      } else {
        throw new Error("Non-template messages not yet implemented");
      }

      await db
        .update(messageQueue)
        .set({
          status: "sent",
          whatsappMessageId: response.messages?.[0]?.id,
          sentVia: isMarketing ? "marketing_messages" : "cloud_api",
          attempts: message.attempts + 1
        })
        .where(eq(messageQueue.id, message.id));

      if (message.campaignId) {
        await db
          .update(campaigns)
          .set({
            sentCount: sql`${campaigns.sentCount} + 1`
          })
          .where(eq(campaigns.id, message.campaignId));
      }

      console.log(`[MessageQueue] Message sent: ${message.id}`);
    } catch (error) {
      console.error(`[MessageQueue] Failed to send message ${message.id}:`, error);

      await db
        .update(messageQueue)
        .set({
          status: message.attempts >= 2 ? "failed" : "queued",
          attempts: message.attempts + 1,
          errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
          errorMessage: error instanceof Error ? error.message : String(error),
          scheduledFor: message.attempts < 2 
            ? new Date(Date.now() + Math.pow(2, message.attempts + 1) * 1000)
            : null
        })
        .where(eq(messageQueue.id, message.id));

      if (message.campaignId && message.attempts >= 2) {
        await db
          .update(campaigns)
          .set({
            failedCount: sql`${campaigns.failedCount} + 1`
          })
          .where(eq(campaigns.id, message.campaignId));
      }
    }
  }

  static async queueCampaignMessages(
    campaignId: string,
    channelId: string,
    recipients: string[],
    templateName: string,
    templateParams: any[] = [],
    messageType: string = "marketing",
    scheduledFor?: Date
  ): Promise<number> {
    const messagesToQueue = recipients.map(phone => ({
      campaignId,
      channelId,
      recipientPhone: phone,
      templateName,
      templateParams,
      messageType,
      status: "queued" as const,
      scheduledFor
    }));

    const batchSize = 100;
    let totalQueued = 0;

    for (let i = 0; i < messagesToQueue.length; i += batchSize) {
      const batch = messagesToQueue.slice(i, i + batchSize);
      const inserted = await db.insert(messageQueue).values(batch).returning({ id: messageQueue.id });
      totalQueued += batch.length;

      if (this.usingBullMQ && isBullQueueAvailable()) {
        const bullJobs = inserted.map((row, idx) => ({
          messageId: row.id,
          channelId,
          recipientPhone: batch[idx].recipientPhone,
          templateName,
          templateParams,
          messageType,
          campaignId,
          scheduledFor,
        }));
        await addBulkMessagesToBullQueue(bullJobs);
      }
    }

    return totalQueued;
  }

  static async getQueueStats() {
    const stats = await db
      .select({
        status: messageQueue.status,
        count: sql<number>`count(*)::int`
      })
      .from(messageQueue)
      .groupBy(messageQueue.status);

    const dbStats = stats.reduce((acc, stat) => {
      if (stat.status) {
        acc[stat.status] = stat.count;
      }
      return acc;
    }, {} as Record<string, number>);

    if (this.usingBullMQ) {
      const bullStats = await getBullQueueStats();
      if (bullStats) {
        return { ...dbStats, bullmq: bullStats, engine: "bullmq" as const };
      }
    }

    return { ...dbStats, engine: "db-polling" as const };
  }

  static async clearOldFailedMessages(daysOld: number = 7) {
    const result = await db
      .delete(messageQueue)
      .where(
        and(
          eq(messageQueue.status, "failed"),
          sql`${messageQueue.createdAt} < NOW() - INTERVAL '${daysOld} days'`
        )
      );

    return result;
  }
}
