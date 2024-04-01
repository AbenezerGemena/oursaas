import { db } from "../db";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { sql } from "drizzle-orm";

export class DatabaseService {
  
  static async checkConnection(): Promise<{ healthy: boolean; details: any }> {
    try {
      const result = await db.execute(sql`SELECT 1 as health_check`);
      const connectionCount = await db.execute(sql`
        SELECT count(*) as connection_count 
        FROM pg_stat_activity 
        WHERE state = 'active'
      `);
      
      return {
        healthy: true,
        details: {
          connectionTest: result.rows[0],
          activeConnections: connectionCount.rows[0],
          timestamp: new Date().toISOString(),
        }
      };
    } catch (error: any) {
      return {
        healthy: false,
        details: {
          error: error?.message || 'Unknown error',
          timestamp: new Date().toISOString(),
        }
      };
    }
  }

  
  static async getDatabaseStats() {
    try {
      const tableStats = await db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_rows,
          n_dead_tup as dead_rows
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
      `);

      const databaseSize = await db.execute(sql`
        SELECT pg_size_pretty(pg_database_size(current_database())) as database_size
      `);

      const indexUsage = await db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_tup_read,
          idx_tup_fetch
        FROM pg_stat_user_indexes
        WHERE idx_tup_read > 0
        ORDER BY idx_tup_read DESC
        LIMIT 10
      `);

      return {
        tableStats: tableStats.rows,
        databaseSize: databaseSize.rows[0],
        indexUsage: indexUsage.rows,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Failed to get database stats: ${error?.message || 'Unknown error'}`);
    }
  }

  
  static async cleanupOldData() {
    try {
      const results = [];

      
      const apiLogsResult = await db.execute(sql`
        DELETE FROM api_logs 
        WHERE created_at < NOW() - INTERVAL '30 days'
      `);
      results.push({ table: 'api_logs', deleted: apiLogsResult.rowCount });

      
      const analyticsResult = await db.execute(sql`
        DELETE FROM analytics 
        WHERE date < NOW() - INTERVAL '12 months'
      `);
      results.push({ table: 'analytics', deleted: analyticsResult.rowCount });

      
      const campaignsResult = await db.execute(sql`
        DELETE FROM campaigns 
        WHERE status = 'completed' 
        AND completed_at < NOW() - INTERVAL '6 months'
      `);
      results.push({ table: 'campaigns', deleted: campaignsResult.rowCount });

      return {
        success: true,
        results,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Failed to cleanup old data: ${error?.message || 'Unknown error'}`);
    }
  }

  
  static async optimizeDatabase() {
    try {
      
      await db.execute(sql`ANALYZE`);

      
      await db.execute(sql`VACUUM`);

      return {
        success: true,
        message: "Database optimization completed",
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Failed to optimize database: ${error?.message || 'Unknown error'}`);
    }
  }

  
  static async getSlowQueries() {
    try {
      const slowQueries = await db.execute(sql`
        SELECT 
          query,
          calls,
          total_time,
          mean_time,
          rows
        FROM pg_stat_statements
        WHERE mean_time > 100  -- queries taking more than 100ms on average
        ORDER BY mean_time DESC
        LIMIT 10
      `);

      return slowQueries.rows;
    } catch (error: any) {
      
      return [];
    }
  }

  
  static async ensureOptimalIndexes() {
    try {
      const indexes = [
        
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_phone_trgm_idx 
         ON contacts USING gin(phone gin_trgm_ops)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_name_trgm_idx 
         ON contacts USING gin(name gin_trgm_ops)`,
        
        
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_content_trgm_idx 
         ON messages USING gin(content gin_trgm_ops)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_timestamp_desc_idx 
         ON messages (timestamp DESC)`,
        
        
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS campaigns_name_trgm_idx 
         ON campaigns USING gin(name gin_trgm_ops)`,
        
        
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_channel_status_idx 
         ON conversations (channel_id, status)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_conversation_timestamp_idx 
         ON messages (conversation_id, timestamp DESC)`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS campaign_recipients_campaign_status_idx 
         ON campaign_recipients (campaign_id, status)`,
      ];

      const results = [];
      for (const indexQuery of indexes) {
        try {
          await db.execute(sql.raw(indexQuery));
          results.push({ index: indexQuery.split(' ')[5], status: 'created' });
        } catch (error: any) {
          if (error?.message?.includes('already exists')) {
            results.push({ index: indexQuery.split(' ')[5], status: 'exists' });
          } else {
            results.push({ index: indexQuery.split(' ')[5], status: 'failed', error: error?.message || 'Unknown error' });
          }
        }
      }

      return {
        success: true,
        results,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Failed to ensure optimal indexes: ${error?.message || 'Unknown error'}`);
    }
  }
}
