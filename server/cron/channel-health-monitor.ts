import * as cron from 'node-cron';
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { DatabaseStorage } from '../database-storage';
import { WhatsAppApiService } from '../services/whatsapp-api';
import { triggerNotification, NOTIFICATION_EVENTS } from '../services/notification.service';
import { db } from '../db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

const storage = new DatabaseStorage();

export class ChannelHealthMonitor {
  private static instance: ChannelHealthMonitor;
  private cronJob: cron.ScheduledTask | null = null;

  private constructor() {}

  static getInstance(): ChannelHealthMonitor {
    if (!ChannelHealthMonitor.instance) {
      ChannelHealthMonitor.instance = new ChannelHealthMonitor();
    }
    return ChannelHealthMonitor.instance;
  }

  
  async checkAllChannelsHealth() {
    console.log('[Channel Health Monitor] Starting health check for all channels...');
    
    try {
      const channels = await storage.getChannels();
      
      for (const channel of channels) {
        if (channel.isActive === false) {
          console.log(`[Channel Health Monitor] Skipping inactive channel: ${channel.name} (${channel.phoneNumber})`);
          continue;
        }
        if (!channel.accessToken || !channel.phoneNumberId) {
          console.log(`[Channel Health Monitor] Skipping channel with missing credentials: ${channel.name} (${channel.phoneNumber})`);
          continue;
        }
        await this.checkChannelHealth(channel.id);
      }
      
      console.log('[Channel Health Monitor] Health check completed for all channels');
    } catch (error) {
      console.error('[Channel Health Monitor] Error checking channels health:', error);
    }
  }

  
  async checkChannelHealth(channelId: string) {
    try {
      const channel = await storage.getChannel(channelId);
      if (!channel) {
        console.error(`[Channel Health Monitor] Channel ${channelId} not found`);
        return;
      }

      if (channel.isActive === false) {
        console.log(`[Channel Health Monitor] Skipping inactive channel: ${channel.name} (${channel.phoneNumber})`);
        return;
      }

      if (!channel.accessToken || !channel.phoneNumberId) {
        console.log(`[Channel Health Monitor] Skipping channel with missing credentials: ${channel.name} (${channel.phoneNumber})`);
        return;
      }

      console.log(`[Channel Health Monitor] Checking health for channel: ${channel.name} (${channel.phoneNumber})`);

      const apiVersion = process.env.WHATSAPP_API_VERSION || 'v24.0';
      
      const fields = 'id,account_mode,display_phone_number,is_official_business_account,is_pin_enabled,is_preverified_number,messaging_limit_tier,name_status,new_name_status,platform_type,quality_rating,quality_score,search_visibility,status,throughput,verified_name,code_verification_status,certificate';
      const url = `https://graph.facebook.com/${apiVersion}/${channel.phoneNumberId}?fields=${fields}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${channel.accessToken}`
        }
      });

      const data = await response.json();
      
      if (response.ok) {
        const healthDetails = {
          status: data.account_mode || 'UNKNOWN',
          name_status: data.name_status || 'UNKNOWN',
          phone_number: data.display_phone_number || channel.phoneNumber,
          quality_rating: data.quality_rating || 'UNKNOWN',
          throughput_level: data.throughput?.level || 'STANDARD',
          verification_status: data.code_verification_status || 'NOT_VERIFIED',
          messaging_limit: data.messaging_limit_tier || 'UNKNOWN',
          verified_name: typeof data.verified_name === 'string' ? data.verified_name : '',
        };

        const previousStatus = channel.healthStatus;
        const healthyModes = ['LIVE', 'CONNECTED', 'SANDBOX'];
        const isAccountHealthy = healthyModes.includes(data.account_mode);
        const isQualityGood = ['GREEN', 'UNKNOWN'].includes(healthDetails.quality_rating);
        const newStatus = isAccountHealthy && isQualityGood ? 'healthy' : 'warning';

        await storage.updateChannel(channelId, {
          healthStatus: newStatus,
          lastHealthCheck: new Date(),
          healthDetails
        });

        
        if (previousStatus === 'healthy' && newStatus !== 'healthy') {
          await this.notifyChannelIssue(channel, healthDetails);
        }

        console.log(`[Channel Health Monitor] Channel ${channel.name} status: ${newStatus}`);
      } else {
        const errorMessage = data.error?.message || 'Unknown error';
        
        await storage.updateChannel(channelId, {
          healthStatus: 'error',
          lastHealthCheck: new Date(),
          healthDetails: { 
            error: errorMessage,
            error_code: data.error?.code,
            error_type: data.error?.type
          }
        });

        
        await this.notifyChannelError(channel, errorMessage);
        
        console.error(`[Channel Health Monitor] Channel ${channel.name} error: ${errorMessage}`);
      }
    } catch (error: any) {
      console.error(`[Channel Health Monitor] Error checking channel ${channelId}:`, error);
      
      await storage.updateChannel(channelId, {
        healthStatus: 'error',
        lastHealthCheck: new Date(),
        healthDetails: { 
          error: 'Network or system error',
          details: error.message
        }
      });
    }
  }

  private async notifyChannelIssue(channel: any, details: any) {
    console.warn(`[Channel Health Monitor] ISSUE DETECTED for ${channel.name}:`, {
      phoneNumber: channel.phoneNumber,
      status: details.status,
      quality_rating: details.quality_rating,
      messaging_limit: details.messaging_limit
    });

    await storage.createApiLog({
      channelId: channel.id,
      requestType: 'health_check',
      endpoint: 'HEALTH_CHECK',
      method: 'GET',
      responseStatus: 200,
      responseBody: details,
      duration: 0
    });

    try {
      if (channel.createdBy) {
        const ownerAndTeam = await db.select().from(users).where(eq(users.id, channel.createdBy));
        const teamMembers = await db.select().from(users).where(eq(users.createdBy, channel.createdBy));
        const allUsers = [...ownerAndTeam, ...teamMembers];
        const targetUserIds = [...new Set(allUsers.map((u: any) => u.id))];
        if (targetUserIds.length > 0) {
          await triggerNotification(NOTIFICATION_EVENTS.CHANNEL_HEALTH_WARNING, {
            channelName: channel.name || "Unknown",
            channelPhone: channel.phoneNumber || "",
            healthStatus: details.status || "Warning",
            qualityRating: details.quality_rating || "Unknown",
            issueDetails: `Quality: ${details.quality_rating}, Messaging limit: ${details.messaging_limit}`,
          }, targetUserIds, channel.id);
        }
      }
    } catch (err) {
      console.error("[Channel Health Monitor] Error sending health notification:", err);
    }
  }

  private async notifyChannelError(channel: any, errorMessage: string) {
    console.error(`[Channel Health Monitor] ERROR for ${channel.name}:`, {
      phoneNumber: channel.phoneNumber,
      error: errorMessage
    });

    await storage.createApiLog({
      channelId: channel.id,
      requestType: 'health_check',
      endpoint: 'HEALTH_CHECK',
      method: 'GET',
      responseStatus: 500,
      responseBody: { error: errorMessage },
      duration: 0
    });

    try {
      if (channel.createdBy) {
        const ownerAndTeam = await db.select().from(users).where(eq(users.id, channel.createdBy));
        const teamMembers = await db.select().from(users).where(eq(users.createdBy, channel.createdBy));
        const allUsers = [...ownerAndTeam, ...teamMembers];
        const targetUserIds = [...new Set(allUsers.map((u: any) => u.id))];
        if (targetUserIds.length > 0) {
          await triggerNotification(NOTIFICATION_EVENTS.CHANNEL_HEALTH_WARNING, {
            channelName: channel.name || "Unknown",
            channelPhone: channel.phoneNumber || "",
            healthStatus: "Error",
            qualityRating: "N/A",
            issueDetails: errorMessage,
          }, targetUserIds, channel.id);
        }
      }
    } catch (err) {
      console.error("[Channel Health Monitor] Error sending health notification:", err);
    }
  }

  
  start() {
    
    this.cronJob = cron.schedule('0 2 * * *', async () => {
      await this.checkAllChannelsHealth();
    });

    
    this.checkAllChannelsHealth();

    console.log('[Channel Health Monitor] Started - will run daily at 2 AM');
  }

  
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('[Channel Health Monitor] Stopped');
    }
  }

  
  async runManualCheck() {
    await this.checkAllChannelsHealth();
  }
}

export const channelHealthMonitor = ChannelHealthMonitor.getInstance();
