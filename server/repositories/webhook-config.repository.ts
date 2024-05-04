import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { 
  webhookConfigs, 
  type WebhookConfig, 
  type InsertWebhookConfig 
} from "@shared/schema";

export class WebhookConfigRepository {
  async getAll(): Promise<WebhookConfig[]> {
    return await db.select().from(webhookConfigs);
  }

  async getById(id: string): Promise<WebhookConfig | undefined> {
    const [config] = await db
      .select()
      .from(webhookConfigs)
      .where(eq(webhookConfigs.id, id));
    return config || undefined;
  }

  async getByChannelAndType(channelId: string, type: string): Promise<WebhookConfig | undefined> {
    const [config] = await db
      .select()
      .from(webhookConfigs)
      .where(
        and(
          eq(webhookConfigs.channelId, channelId)
        )
      );
    return config || undefined;
  }

  async create(insertConfig: InsertWebhookConfig): Promise<WebhookConfig> {
    const [config] = await db
      .insert(webhookConfigs)
      .values(insertConfig)
      .returning();
    return config;
  }

  async update(id: string, config: Partial<WebhookConfig>): Promise<WebhookConfig | undefined> {
    const [updated] = await db
      .update(webhookConfigs)
      .set(config)
      .where(eq(webhookConfigs.id, id))
      .returning();
    return updated || undefined;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(webhookConfigs).where(eq(webhookConfigs.id, id)).returning();
    return result.length > 0;
  }

  async getAllByChannel(channelId: string): Promise<WebhookConfig[]> {
    return await db
      .select()
      .from(webhookConfigs)
      .where(eq(webhookConfigs.channelId, channelId));
  }
}
