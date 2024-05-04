import { db } from "../db";
import { eq, desc, sql, lte } from "drizzle-orm";
import { 
  campaigns, 
  users,
  type Campaign, 
  type InsertCampaign 
} from "@shared/schema";

export class CampaignRepository {
  async getAllold(page: number = 1, limit: number = 10): Promise<{
  data: Campaign[];
  total: number;
  page: number;
  limit: number;
}> {
  const offset = (page - 1) * limit;

  
  const campaignsList = await db
    .select()
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt))
    .limit(limit)
    .offset(offset);

  
  const totalResult = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(campaigns);

  return {
    data: campaignsList,
    total: totalResult[0]?.total ?? 0,
    page,
    limit,
  };
}

async getAll(
  page: number = 1,
  limit: number = 10
) {
  const offset = (page - 1) * limit;

  const campaignsList = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      createdBy: campaigns.createdBy,
      createdByName: sql<string>`
        CONCAT(
          COALESCE(${users.firstName}, ''), ' ', COALESCE(${users.lastName}, '')
        )
      `.as("createdByName"),
      status: campaigns.status,
      createdAt: campaigns.createdAt,
      updatedAt: campaigns.updatedAt,
    })
    .from(campaigns)
    
    .leftJoin(users, eq(users.id, sql`${campaigns.createdBy}::text`))
    .orderBy(desc(campaigns.createdAt))
    .limit(limit)
    .offset(offset);

  const totalResult = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(campaigns);

  return {
    data: campaignsList,
    total: totalResult[0]?.total ?? 0,
    page,
    limit,
  };
}

  
  
  
  
  
  
  

  async getByChannel(
  channelId: string,
  page: number = 1,
  limit: number = 10
): Promise<{ data: Campaign[]; total: number; page: number; limit: number }> {
  const offset = (page - 1) * limit;

  
  const data = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.channelId, channelId))
    .orderBy(desc(campaigns.createdAt))
    .limit(limit)
    .offset(offset);

  
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(campaigns)
    .where(eq(campaigns.channelId, channelId));

  return {
    data,
    total: Number(count),
    page,
    limit,
  };
}

  async getById(id: string): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    return campaign || undefined;
  }

  
  
  
  

 async getCampaignByUserId(
  userId: string,
  page: number = 1,
  limit: number = 10
) {
  const offset = (page - 1) * limit;

  const campaignsList = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.createdBy, userId))
    .orderBy(desc(campaigns.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  const totalResult = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(campaigns)
    .where(eq(campaigns.createdBy, userId));

  return {
    data: campaignsList,
    total: totalResult[0]?.total ?? 0,
    page,
    limit
  };
}

  async create(insertCampaign: InsertCampaign & { createdBy: string }): Promise<Campaign> {
    const [campaign] = await db
      .insert(campaigns)
      .values({
        ...insertCampaign,
        contactGroups: (insertCampaign.contactGroups || []) as string[],
      })
      .returning();
    return campaign;
  }

 async getScheduledCampaigns(now: Date) {
    return db
      .select()
      .from(campaigns)
      .where(
        sql`
          ${campaigns.status} = 'scheduled'
          AND ${campaigns.scheduledAt} IS NOT NULL
          AND ${campaigns.scheduledAt} <= ${now}
        `
      )
      .orderBy(campaigns.scheduledAt);
  }
  

  async update(id: string, campaign: Partial<Campaign>): Promise<Campaign | undefined> {
    const [updated] = await db
      .update(campaigns)
      .set(campaign)
      .where(eq(campaigns.id, id))
      .returning();
    return updated || undefined;
  }

  async incrementSentCount(id: string): Promise<void> {
    await db
      .update(campaigns)
      .set({ sentCount: sql`COALESCE(${campaigns.sentCount}, 0) + 1` })
      .where(eq(campaigns.id, id));
  }

  async incrementFailedCount(id: string): Promise<void> {
    await db
      .update(campaigns)
      .set({ failedCount: sql`COALESCE(${campaigns.failedCount}, 0) + 1` })
      .where(eq(campaigns.id, id));
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(campaigns).where(eq(campaigns.id, id)).returning();
    return result.length > 0;
  }

   async getAllCampaignCount(): Promise<number> {
    const campaignsList = await db.select().from(campaigns);
    return campaignsList.length;
  }
}
