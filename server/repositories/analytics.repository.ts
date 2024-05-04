import { db } from "../db";
import { gte, desc, sql } from "drizzle-orm";
import { 
  analytics,
  messages,
  type Analytics, 
  type InsertAnalytics, 
  conversations
} from "@shared/schema";

export class AnalyticsRepository {
  async getAnalyticsByChannel(channelId: string, days?: number): Promise<Analytics[]> {
    const startDate = days 
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) 
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
      const result = await db
      .select({
        date: sql<Date>`DATE(${messages.createdAt})`,
        sent: sql<number>`COUNT(CASE WHEN ${messages.status} = 'sent' THEN 1 END)`,
        delivered: sql<number>`COUNT(CASE WHEN ${messages.status} = 'delivered' THEN 1 END)`,
        read: sql<number>`COUNT(CASE WHEN ${messages.status} = 'read' THEN 1 END)`,
        replied: sql<number>`COUNT(CASE WHEN ${messages.status} = 'replied' THEN 1 END)`,
        failed: sql<number>`COUNT(CASE WHEN ${messages.status} = 'failed' THEN 1 END)`,
      })
      .from(messages)
      .leftJoin(conversations, sql`${messages.conversationId} = ${conversations.id}`)
      .where(
        sql`${conversations.channelId} = ${channelId} AND ${messages.createdAt} >= ${startDate}`
      )
      .groupBy(sql`DATE(${messages.createdAt})`)
      .orderBy(sql`DATE(${messages.createdAt})`);    

    
    return result.map(row => ({
      id: `analytics-${channelId}-${row.date.toISOString()}`,
      channelId: channelId ?? null,
      date: row.date,
      messagesSent: row.sent ?? null,
      messagesDelivered: row.delivered ?? null,
      messagesRead: row.read ?? null,
      messagesReplied: row.replied ?? null,
      createdAt: new Date(),
      newContacts: null,
      activeCampaigns: null,
    }));    
  }

  async getAnalytics(days?: number): Promise<Analytics[]> {
    const startDate = days 
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) 
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const result = await db
      .select({
        date: sql<Date>`DATE(${messages.createdAt})`,
        sent: sql<number>`COUNT(CASE WHEN ${messages.status} = 'sent' THEN 1 END)`,
        delivered: sql<number>`COUNT(CASE WHEN ${messages.status} = 'delivered' THEN 1 END)`,
        read: sql<number>`COUNT(CASE WHEN ${messages.status} = 'read' THEN 1 END)`,
        replied: sql<number>`COUNT(CASE WHEN ${messages.status} = 'replied' THEN 1 END)`,
        failed: sql<number>`COUNT(CASE WHEN ${messages.status} = 'failed' THEN 1 END)`,
      })
      .from(messages)
      .where(gte(messages.createdAt, startDate))
      .groupBy(sql`DATE(${messages.createdAt})`)
      .orderBy(sql`DATE(${messages.createdAt})`);

    
    return result.map(row => ({
      id: `analytics-${row.date.toISOString()}`,
      channelId: null,      
      date: row.date,
      messagesTotal: Number(row.sent) + Number(row.delivered) + Number(row.read) + Number(row.replied) + Number(row.failed),
      messagesSent: Number(row.sent) ?? null,
      messagesDelivered: Number(row.delivered) ?? null,
      messagesRead: Number(row.read) ?? null,
      messagesReplied: Number(row.replied) ?? null,
      messagesFailed: Number(row.failed) ?? null,
      createdAt: new Date() ?? null,
      newContacts: null,
      activeCampaigns: null,
      
    }));
    
  }

  async createOrUpdate(insertAnalytics: InsertAnalytics): Promise<Analytics> {
    const [result] = await db
      .insert(analytics)
      .values(insertAnalytics)
      .onConflictDoUpdate({
        target: [analytics.channelId, analytics.date],
        set: {
          messagesSent: insertAnalytics.messagesSent,
          messagesDelivered: insertAnalytics.messagesDelivered,
          messagesRead: insertAnalytics.messagesRead,
          messagesReplied: insertAnalytics.messagesReplied,
        },
      })
      .returning();
    return result;
  }

  async deleteOldAnalytics(daysToKeep: number): Promise<void> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    await db.delete(analytics).where(gte(analytics.date, cutoffDate));
  }
}
