import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { 
  apiLogs, 
  type ApiLog, 
  type InsertApiLog 
} from "@shared/schema";

export class ApiLogRepository {
  async create(insertLog: InsertApiLog): Promise<ApiLog> {
    const [log] = await db
      .insert(apiLogs)
      .values(insertLog)
      .returning();
    return log;
  }

  async getRecent(limit: number = 100): Promise<ApiLog[]> {
    return await db
      .select()
      .from(apiLogs)
      .orderBy(desc(apiLogs.createdAt))
      .limit(limit);
  }

  async getByChannel(channelId: string, limit: number = 100): Promise<ApiLog[]> {
    return await db
      .select()
      .from(apiLogs)
      .where(eq(apiLogs.channelId, channelId))
      .orderBy(desc(apiLogs.createdAt))
      .limit(limit);
  }
}
