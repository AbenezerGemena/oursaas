import { db } from "../db";
import { eq, desc, sql, and } from "drizzle-orm";
import { 
  channels, 
  templates,
  campaigns,
  apiLogs,
  aiSettings,
  clientApiKeys,
  clientApiUsageLogs,
  clientWebhooks,
  automationExecutions,
  messageQueue,
  contacts,
  conversations,
  type Channel, 
  type InsertChannel 
} from "@shared/schema";
import { inArray } from "drizzle-orm";

export class ChannelRepository {
  async getAll(): Promise<Channel[]> {
    return await db.select().from(channels).orderBy(desc(channels.createdAt));
  }

  async getAllByUserId(userId: string): Promise<Channel[]> {
    return await db
      .select()
      .from(channels)
      .where(eq(channels.createdBy, userId))
      .orderBy(desc(channels.createdAt));
  }

  async getByUser(
  userId: string,
  page: number = 1,
  limit: number = 10
) {
  const offset = (page - 1) * limit;

  
  const channelsList = await db
    .select()
    .from(channels)
    .where(eq(channels.createdBy, userId))
    .orderBy(desc(channels.createdAt))
    .limit(limit)
    .offset(offset);

  
  const totalResult = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(channels)
    .where(eq(channels.createdBy, userId));

  const total = totalResult[0]?.total ?? 0;

  return {
    data: channelsList,
    pagination: {
      total: Number(total),
      page,
      limit,
      totalPages: Math.ceil(Number(total) / limit),
    },
  };
}

  async getById(id: string): Promise<Channel | undefined> {
    const [channel] = await db.select().from(channels).where(eq(channels.id, id));
    return channel || undefined;
  }

  async getByPhoneNumberId(phoneNumberId: string): Promise<Channel | undefined> {
    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.phoneNumberId, phoneNumberId));
    return channel || undefined;
  }

  async getByPhoneNumber(phoneNumber: string): Promise<Channel[]> {
    return await db
      .select()
      .from(channels)
      .where(eq(channels.phoneNumber, phoneNumber))
      .orderBy(desc(channels.createdAt));
  }

  async create(insertChannel: InsertChannel): Promise<Channel> {
    const [channel] = await db
      .insert(channels)
      .values(insertChannel)
      .returning();
    return channel;
  }

  async update(id: string, channel: Partial<Channel>): Promise<Channel | undefined> {
    const [updated] = await db
      .update(channels)
      .set(channel)
      .where(eq(channels.id, id))
      .returning();
    return updated || undefined;
  }

  async delete(id: string): Promise<boolean> {
    const channelContacts = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.channelId, id));
    const contactIds = channelContacts.map((c: { id: string }) => c.id);
    if (contactIds.length > 0) {
      await db.delete(automationExecutions).where(inArray(automationExecutions.contactId, contactIds));
    }

    const channelConversations = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.channelId, id));
    const conversationIds = channelConversations.map((c: { id: string }) => c.id);
    if (conversationIds.length > 0) {
      await db.delete(automationExecutions).where(inArray(automationExecutions.conversationId, conversationIds));
    }

    await db.delete(clientApiUsageLogs).where(eq(clientApiUsageLogs.channelId, id));
    await db.delete(clientWebhooks).where(eq(clientWebhooks.channelId, id));
    await db.delete(clientApiKeys).where(eq(clientApiKeys.channelId, id));
    await db.delete(apiLogs).where(eq(apiLogs.channelId, id));
    await db.delete(aiSettings).where(eq(aiSettings.channelId, id));
    await db.execute(sql`DELETE FROM message_queue WHERE campaign_id IN (SELECT id FROM campaigns WHERE channel_id = ${id})`);
    await db.delete(campaigns).where(eq(campaigns.channelId, id));
    await db.delete(templates).where(eq(templates.channelId, id));
    await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE channel_id = ${id})`);
    await db.execute(sql`DELETE FROM automation_nodes WHERE automation_id IN (SELECT id FROM automations WHERE channel_id = ${id})`);
    await db.execute(sql`DELETE FROM automation_execution_logs WHERE execution_id IN (SELECT id FROM automation_executions WHERE automation_id IN (SELECT id FROM automations WHERE channel_id = ${id}))`);
    await db.execute(sql`DELETE FROM automation_executions WHERE automation_id IN (SELECT id FROM automations WHERE channel_id = ${id})`);
    await db.execute(sql`DELETE FROM automations WHERE channel_id = ${id}`);
    await db.execute(sql`DELETE FROM conversations WHERE channel_id = ${id}`);
    await db.execute(sql`DELETE FROM contacts WHERE channel_id = ${id}`);
    const result = await db.delete(channels).where(eq(channels.id, id)).returning();
    return result.length > 0;
  }

  async getActive(): Promise<Channel | undefined> {
    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.isActive, true))
      .orderBy(desc(channels.createdAt));
    return channel || undefined;
  }

  async getActiveByUserId(userId: string): Promise<Channel | undefined> {
    const [channel] = await db
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.isActive, true),
          eq(channels.createdBy, userId)
        )
      )
      .orderBy(desc(channels.createdAt));
  
    return channel || undefined;
  }

  async getTotalChannelsByUser(createdBy: string): Promise<number> {
  const result = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.createdBy, createdBy));

  return result.length;
}

}
