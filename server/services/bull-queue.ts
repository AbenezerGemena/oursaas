import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { isRedisAvailable, getRedisClient } from "./redis";
import { db } from "../db";
import { messageQueue, channels, campaigns } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { WhatsAppApiService } from "./whatsapp-api";
import { cacheGet, CACHE_KEYS, CACHE_TTL } from "./cache";

const QUEUE_NAME = "whatsapp-messages";

let messageQueueBull: Queue | null = null;
let messageWorker: Worker | null = null;
let queueEvents: QueueEvents | null = null;

function getRedisConnection() {
  const client = getRedisClient();
  if (!client) return null;
  return {
    host: (client.options as any)?.host || "127.0.0.1",
    port: (client.options as any)?.port || 6379,
    password: (client.options as any)?.password,
    db: (client.options as any)?.db || 0,
  };
}

function getConnectionFromUrl(): Record<string, any> | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port || "6379", 10),
      password: url.password || undefined,
      db: url.pathname ? parseInt(url.pathname.slice(1) || "0", 10) : 0,
    };
  } catch {
    return null;
  }
}

export function isBullQueueAvailable(): boolean {
  return messageQueueBull !== null && isRedisAvailable();
}

export function getBullQueue(): Queue | null {
  return messageQueueBull;
}

export async function initBullQueue(): Promise<boolean> {
  if (!isRedisAvailable()) {
    console.log("[BullMQ] Redis not available — using DB polling fallback");
    return false;
  }

  const connection = getConnectionFromUrl() || getRedisConnection();
  if (!connection) {
    console.log("[BullMQ] Could not determine Redis connection — using DB polling fallback");
    return false;
  }

  try {
    messageQueueBull = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });

    messageWorker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        await processMessageJob(job);
      },
      {
        connection,
        concurrency: parseInt(process.env.BULLMQ_CONCURRENCY || "10", 10),
        limiter: {
          max: parseInt(process.env.BULLMQ_RATE_MAX || "50", 10),
          duration: parseInt(process.env.BULLMQ_RATE_DURATION || "1000", 10),
        },
      }
    );

    messageWorker.on("completed", (job: Job) => {
      console.log(`[BullMQ] Job ${job.id} completed`);
    });

    messageWorker.on("failed", (job: Job | undefined, err: Error) => {
      console.error(`[BullMQ] Job ${job?.id} failed:`, err.message);
    });

    messageWorker.on("error", (err: Error) => {
      console.error("[BullMQ] Worker error:", err.message);
    });

    queueEvents = new QueueEvents(QUEUE_NAME, { connection });

    console.log("[BullMQ] Queue and worker initialized successfully");
    return true;
  } catch (err: any) {
    console.error("[BullMQ] Failed to initialize:", err.message);
    messageQueueBull = null;
    messageWorker = null;
    queueEvents = null;
    return false;
  }
}

async function processMessageJob(job: Job) {
  const { messageId, channelId, recipientPhone, templateName, templateParams, messageType, campaignId, attempts } = job.data;

  try {
    await db
      .update(messageQueue)
      .set({ status: "processing", processedAt: new Date() })
      .where(eq(messageQueue.id, messageId));

    let channel = await cacheGet(
      CACHE_KEYS.channel(channelId),
      CACHE_TTL.channel,
      async () => {
        const [ch] = await db
          .select()
          .from(channels)
          .where(eq(channels.id, channelId))
          .limit(1);
        return ch || null;
      }
    );

    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    const canSend = await WhatsAppApiService.checkRateLimit(channel.id);
    if (!canSend) {
      await db
        .update(messageQueue)
        .set({ status: "queued", scheduledFor: new Date(Date.now() + 5000) })
        .where(eq(messageQueue.id, messageId));
      throw new Error("Rate limited — will retry");
    }

    const isMarketing = messageType === "marketing";

    let response;
    if (templateName) {
      response = await WhatsAppApiService.sendTemplateMessage(
        channel,
        recipientPhone,
        templateName,
        templateParams || [],
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
        attempts: (attempts || 0) + 1,
      })
      .where(eq(messageQueue.id, messageId));

    if (campaignId) {
      await db
        .update(campaigns)
        .set({ sentCount: sql`${campaigns.sentCount} + 1` })
        .where(eq(campaigns.id, campaignId));
    }

    console.log(`[BullMQ] Message sent: ${messageId}`);
  } catch (error) {
    console.error(`[BullMQ] Failed to send message ${messageId}:`, error);

    const currentAttempts = (attempts || 0) + 1;
    await db
      .update(messageQueue)
      .set({
        status: currentAttempts >= 3 ? "failed" : "queued",
        attempts: currentAttempts,
        errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(messageQueue.id, messageId));

    if (campaignId && currentAttempts >= 3) {
      await db
        .update(campaigns)
        .set({ failedCount: sql`${campaigns.failedCount} + 1` })
        .where(eq(campaigns.id, campaignId));
    }

    throw error;
  }
}

export async function addMessageToBullQueue(messageData: {
  messageId: string;
  channelId: string;
  recipientPhone: string;
  templateName: string;
  templateParams?: any[];
  messageType: string;
  campaignId?: string;
  attempts?: number;
  scheduledFor?: Date;
}): Promise<boolean> {
  if (!messageQueueBull) return false;

  try {
    const jobOptions: any = {};

    if (messageData.scheduledFor) {
      const delay = messageData.scheduledFor.getTime() - Date.now();
      if (delay > 0) {
        jobOptions.delay = delay;
      }
    }

    await messageQueueBull.add("send-message", messageData, jobOptions);
    return true;
  } catch (err: any) {
    console.error("[BullMQ] Failed to add job:", err.message);
    return false;
  }
}

export async function addBulkMessagesToBullQueue(
  messages: Array<{
    messageId: string;
    channelId: string;
    recipientPhone: string;
    templateName: string;
    templateParams?: any[];
    messageType: string;
    campaignId?: string;
    scheduledFor?: Date;
  }>
): Promise<number> {
  if (!messageQueueBull) return 0;

  try {
    const jobs = messages.map((msg) => {
      const jobOptions: any = {};
      if (msg.scheduledFor) {
        const delay = msg.scheduledFor.getTime() - Date.now();
        if (delay > 0) {
          jobOptions.delay = delay;
        }
      }
      return {
        name: "send-message",
        data: msg,
        opts: jobOptions,
      };
    });

    await messageQueueBull.addBulk(jobs);
    return messages.length;
  } catch (err: any) {
    console.error("[BullMQ] Failed to add bulk jobs:", err.message);
    return 0;
  }
}

export async function getBullQueueStats(): Promise<Record<string, number> | null> {
  if (!messageQueueBull) return null;

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      messageQueueBull.getWaitingCount(),
      messageQueueBull.getActiveCount(),
      messageQueueBull.getCompletedCount(),
      messageQueueBull.getFailedCount(),
      messageQueueBull.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  } catch {
    return null;
  }
}

export async function shutdownBullQueue(): Promise<void> {
  try {
    if (messageWorker) {
      await messageWorker.close();
      messageWorker = null;
    }
    if (queueEvents) {
      await queueEvents.close();
      queueEvents = null;
    }
    if (messageQueueBull) {
      await messageQueueBull.close();
      messageQueueBull = null;
    }
    console.log("[BullMQ] Queue shut down gracefully");
  } catch (err: any) {
    console.error("[BullMQ] Error during shutdown:", err.message);
  }
}
