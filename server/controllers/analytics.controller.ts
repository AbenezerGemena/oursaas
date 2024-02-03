import type { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { db, dbRead } from '../db';
import { messages, campaigns, conversations, whatsappChannels } from '@shared/schema';
import { AppError, asyncHandler } from '../middlewares/error.middleware';
import { eq, and, gte, lte, count, sql, desc } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import ExcelJS from "exceljs";
import { storage } from 'server/storage';

export const getMessageAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { channelId, days = '30', startDate, endDate } = req.query;
  
  const daysNum = parseInt(days as string, 10);
  const start = startDate ? new Date(startDate as string) : new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate as string) : new Date();

  const conditions = [];
  
  if (channelId) {
    conditions.push(eq(conversations.channelId, channelId as string));
  }
  
  conditions.push(gte(messages.createdAt, start));
  conditions.push(lte(messages.createdAt, end));

  
  const messageStats = await dbRead
    .select({
      date: sql<string>`DATE(${messages.createdAt})`,
      totalSent: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' THEN 1 END)`,
      delivered: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} IN ('delivered', 'read') THEN 1 END)`,
      read: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'read' THEN 1 END)`,
      failed: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'failed' THEN 1 END)`,
      pending: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'pending' THEN 1 END)`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(...conditions))
    .groupBy(sql`DATE(${messages.createdAt})`)
    .orderBy(sql`DATE(${messages.createdAt})`);

  
  const overallStats = await dbRead
    .select({
      totalMessages: count(messages.id),
      totalOutbound: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' THEN 1 END)`,
      totalInbound: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'inbound' THEN 1 END)`,
      totalDelivered: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} IN ('delivered', 'read') THEN 1 END)`,
      totalRead: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'read' THEN 1 END)`,
      totalFailed: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'failed' THEN 1 END)`,
      totalReplied: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'inbound' AND ${messages.status} != 'failed' THEN 1 END)`,
      uniqueContacts: sql<number>`COUNT(DISTINCT ${conversations.contactPhone})`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(...conditions));

  
  let avgResponseResult: { avgResponseMs: number | null }[] = [{ avgResponseMs: null }];
  try {
    avgResponseResult = await dbRead
      .select({
        avgResponseMs: sql<number>`AVG(response_time_ms)`,
      })
      .from(sql`(
        SELECT EXTRACT(EPOCH FROM (first_reply.created_at - outb.created_at)) * 1000 AS response_time_ms
        FROM messages outb
        INNER JOIN conversations c ON outb.conversation_id = c.id
        CROSS JOIN LATERAL (
          SELECT inb.created_at
          FROM messages inb
          WHERE inb.conversation_id = outb.conversation_id
            AND inb.direction = 'inbound'
            AND inb.created_at > outb.created_at
            AND inb.created_at <= ${end}
            AND inb.status != 'failed'
          ORDER BY inb.created_at ASC
          LIMIT 1
        ) first_reply
        WHERE outb.direction = 'outbound'
          ${channelId ? sql`AND c.channel_id = ${channelId as string}` : sql``}
          AND outb.created_at >= ${start}
          AND outb.created_at <= ${end}
          AND EXTRACT(EPOCH FROM (first_reply.created_at - outb.created_at)) BETWEEN 0 AND 86400
        ) sub`);
  } catch (e) {
    
  }

  
  const messageTypes = await dbRead
    .select({
      direction: messages.direction,
      count: count(messages.id),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(...conditions))
    .groupBy(messages.direction);

  
  const hourlyDistribution = await dbRead
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${messages.createdAt})`,
      count: count(messages.id),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(...conditions))
    .groupBy(sql`EXTRACT(HOUR FROM ${messages.createdAt})`)
    .orderBy(sql`EXTRACT(HOUR FROM ${messages.createdAt})`);

  const avgResponseMs = avgResponseResult[0]?.avgResponseMs || null;
  let avgResponseTime: string | null = null;
  if (avgResponseMs) {
    const totalSeconds = Math.round(avgResponseMs / 1000);
    if (totalSeconds < 60) {
      avgResponseTime = `${totalSeconds}s`;
    } else if (totalSeconds < 3600) {
      avgResponseTime = `${Math.round(totalSeconds / 60)}m`;
    } else {
      avgResponseTime = `${(totalSeconds / 3600).toFixed(1)}h`;
    }
  }

  res.json({
    dailyStats: messageStats,
    overall: overallStats[0] || {},
    messageTypes,
    hourlyDistribution,
    avgResponseTime,
    period: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      days: daysNum,
    },
  });
});

export const getCampaignAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { channelId } = req.query;
  
  const conditions = [];
  if (channelId) {
    conditions.push(eq(campaigns.channelId, channelId as string));
  }

  
  const campaignStats = await dbRead
    .select()
    .from(campaigns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(campaigns.createdAt));

  const campaignsWithRates = campaignStats.map((campaign: any) => ({
    ...campaign,
    deliveryRate: (campaign.sentCount && campaign.sentCount > 0)
      ? Math.min(((campaign.deliveredCount || 0) / campaign.sentCount) * 100, 100)
      : 0,
    readRate: (campaign.deliveredCount && campaign.deliveredCount > 0)
      ? Math.min(((campaign.readCount || 0) / campaign.deliveredCount) * 100, 100)
      : 0,
    replyRate: (campaign.deliveredCount && campaign.deliveredCount > 0)
      ? Math.min(((campaign.repliedCount || 0) / campaign.deliveredCount) * 100, 100)
      : 0,
  }));

  
  const aggregatedStats = campaignStats.reduce((acc: any, campaign: any) => ({
    totalCampaigns: acc.totalCampaigns + 1,
    activeCampaigns: acc.activeCampaigns + (campaign.status === 'active' ? 1 : 0),
    completedCampaigns: acc.completedCampaigns + (campaign.status === 'completed' ? 1 : 0),
    totalRecipients: acc.totalRecipients + (campaign.recipientCount || 0),
    totalSent: acc.totalSent + (campaign.sentCount || 0),
    totalDelivered: acc.totalDelivered + (campaign.deliveredCount || 0),
    totalRead: acc.totalRead + (campaign.readCount || 0),
    totalReplied: acc.totalReplied + (campaign.repliedCount || 0),
    totalFailed: acc.totalFailed + (campaign.failedCount || 0),
  }), {
    totalCampaigns: 0,
    activeCampaigns: 0,
    completedCampaigns: 0,
    totalRecipients: 0,
    totalSent: 0,
    totalDelivered: 0,
    totalRead: 0,
    totalReplied: 0,
    totalFailed: 0,
  });

  res.json({
    campaigns: campaignsWithRates,
    summary: aggregatedStats,
  });
});

export const getCampaignAnalyticsById = asyncHandler(async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  
  const campaign = await storage.getCampaign(campaignId);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

  
  const endDate = new Date();
  const startDate = new Date(campaign.createdAt || new Date());
  
  const dailyStats = await dbRead
    .select({
      date: sql<string>`DATE(${messages.timestamp})`,
      sent: count(messages.id),
      delivered: sql<number>`COUNT(CASE WHEN ${messages.status} IN ('delivered', 'read') THEN 1 END)`,
      read: sql<number>`COUNT(CASE WHEN ${messages.status} = 'read' THEN 1 END)`,
      failed: sql<number>`COUNT(CASE WHEN ${messages.status} = 'failed' THEN 1 END)`,
    })
    .from(messages)
    .where(eq(messages.campaignId, campaignId))
    .groupBy(sql`DATE(${messages.timestamp})`)
    .orderBy(sql`DATE(${messages.timestamp})`);

  
  const recipientStats = await dbRead
    .select({
      status: messages.status,
      count: count(messages.id),
    })
    .from(messages)
    .where(eq(messages.campaignId, campaignId))
    .groupBy(messages.status);

  
  const errorAnalysis = await dbRead
    .select({
      errorCode: sql<string>`${messages.errorDetails}->>'code'`,
      errorMessage: sql<string>`${messages.errorDetails}->>'message'`,
      count: count(messages.id),
    })
    .from(messages)
    .where(and(
      eq(messages.campaignId, campaignId),
      eq(messages.status, 'failed')
    ))
    .groupBy(sql`${messages.errorDetails}->>'code'`, sql`${messages.errorDetails}->>'message'`)
    .orderBy(desc(count(messages.id)));
  res.status(200).json({
    campaign,
    dailyStats,
    recipientStats,
    errorAnalysis,
  });
});

export const getCampaignDetails = asyncHandler(async (req: Request, res: Response) => {
  const { campaignId } = req.params;

  const campaign = await dbRead
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign.length) {
    throw new AppError(404, 'Campaign not found');
  }

  
  const messageStats = await dbRead
    .select({
      date: sql<string>`DATE(${messages.createdAt})`,
      sent: count(messages.id),
      delivered: sql<number>`COUNT(CASE WHEN ${messages.status} IN ('delivered', 'read') THEN 1 END)`,
      read: sql<number>`COUNT(CASE WHEN ${messages.status} = 'read' THEN 1 END)`,
      failed: sql<number>`COUNT(CASE WHEN ${messages.status} = 'failed' THEN 1 END)`,
    })
    .from(messages)
    .where(eq(messages.campaignId, campaignId))
    .groupBy(sql`DATE(${messages.createdAt})`)
    .orderBy(sql`DATE(${messages.createdAt})`);

  
  const recipientStats = await dbRead
    .select({
      status: messages.status,
      count: count(messages.id),
    })
    .from(messages)
    .where(eq(messages.campaignId, campaignId))
    .groupBy(messages.status);

  
  const errorAnalysis = await dbRead
    .select({
      errorCode: messages.errorCode,
      errorMessage: messages.errorMessage,
      count: count(messages.id),
    })
    .from(messages)
    .where(and(
      eq(messages.campaignId, campaignId),
      eq(messages.status, 'failed')
    ))
    .groupBy(messages.errorCode, messages.errorMessage);

  res.json({
    campaign: campaign[0],
    dailyStats: messageStats,
    recipientStats,
    errorAnalysis,
  });
});

export const exportAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { format = 'pdf', type = 'messages', channelId, days = '30' } = req.query;
  
  if (format === 'pdf') {
    await exportPDF(req, res);
  } else if (format === 'excel') {
    await exportExcel(req, res);
  } else {
    throw new AppError(400, 'Invalid export format');
  }
});

async function exportPDF(req: Request, res: Response) {
  const { type, channelId, days = '30' } = req.query;
  
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=analytics-report-${new Date().toISOString().split('T')[0]}.pdf`);
  
  doc.pipe(res);
  
  
  doc.fontSize(20).text('WhatsApp Analytics Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown(2);

  
  if (type === 'messages' || type === 'all') {
    
    const daysNum = parseInt(days as string);
    const start = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
    
    const conditions = [];
    if (channelId) {
      conditions.push(eq(conversations.channelId, channelId as string));
    }
    conditions.push(gte(messages.createdAt, start));

    const stats = await dbRead
      .select({
        totalMessages: count(messages.id),
        totalOutbound: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' THEN 1 END)`,
        totalInbound: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'inbound' THEN 1 END)`,
        delivered: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} IN ('delivered', 'read') THEN 1 END)`,
        read: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'read' THEN 1 END)`,
        failed: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'failed' THEN 1 END)`,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(...conditions));

    const s = stats[0];
    const outbound = Number(s?.totalOutbound) || 0;
    const deliv = Number(s?.delivered) || 0;
    const readCount = Number(s?.read) || 0;
    const failCount = Number(s?.failed) || 0;
    const delivRate = outbound > 0 ? Math.min((deliv / outbound) * 100, 100).toFixed(1) : '0.0';
    const readRatePdf = deliv > 0 ? Math.min((readCount / deliv) * 100, 100).toFixed(1) : '0.0';
    const failRate = outbound > 0 ? Math.min((failCount / outbound) * 100, 100).toFixed(1) : '0.0';

    doc.fontSize(16).text('Message Statistics', { underline: true });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Total Messages: ${s?.totalMessages || 0}`);
    doc.text(`Outbound: ${outbound}`);
    doc.text(`Inbound: ${Number(s?.totalInbound) || 0}`);
    doc.text(`Delivered: ${deliv} (${delivRate}%)`);
    doc.text(`Read: ${readCount} (${readRatePdf}%)`);
    doc.text(`Failed: ${failCount} (${failRate}%)`);
    doc.moveDown(2);
  }

  if (type === 'campaigns' || type === 'all') {
    
    const campaignStats = await dbRead
      .select({
        totalCampaigns: count(campaigns.id),
        totalSent: sql<number>`SUM(${campaigns.sentCount})`,
        totalDelivered: sql<number>`SUM(${campaigns.deliveredCount})`,
      })
      .from(campaigns)
      .where(channelId ? eq(campaigns.channelId, channelId as string) : undefined);

    doc.fontSize(16).text('Campaign Statistics', { underline: true });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Total Campaigns: ${campaignStats[0]?.totalCampaigns || 0}`);
    doc.text(`Total Sent: ${campaignStats[0]?.totalSent || 0}`);
    doc.text(`Total Delivered: ${campaignStats[0]?.totalDelivered || 0}`);
  }

  doc.end();
}

export async function exportExcel(req: Request, res: Response) {
  const { type, channelId, days = "30" } = req.query;

  const workbook = new ExcelJS.Workbook();

  
  
  
  if (type === "messages" || type === "all") {
    const daysNum = parseInt(days as string, 10);
    const start = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const conditions = [];
    if (channelId) {
      conditions.push(eq(conversations.channelId, channelId as string));
    }
    conditions.push(gte(messages.createdAt, start));

    const messageData = await dbRead
      .select({
        date: sql<string>`DATE(${messages.createdAt})`,
        totalMessages: count(messages.id),
        outbound: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' THEN 1 END)`,
        inbound: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'inbound' THEN 1 END)`,
        delivered: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} IN ('delivered', 'read') THEN 1 END)`,
        read: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'read' THEN 1 END)`,
        failed: sql<number>`COUNT(CASE WHEN ${messages.direction} = 'outbound' AND ${messages.status} = 'failed' THEN 1 END)`,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(...conditions))
      .groupBy(sql`DATE(${messages.createdAt})`)
      .orderBy(sql`DATE(${messages.createdAt})`);

    const ws = workbook.addWorksheet("Message Analytics");

    if (messageData.length > 0) {
      
      ws.columns = Object.keys(messageData[0]).map((key) => ({
        header: key.charAt(0).toUpperCase() + key.slice(1),
        key,
        width: 15,
      }));

      
      messageData.forEach((row) => ws.addRow(row));
    }
  }

  
  
  
  if (type === "campaigns" || type === "all") {
    const campaignData = await dbRead
      .select({
        name: campaigns.name,
        type: campaigns.type,
        status: campaigns.status,
        recipients: campaigns.recipientCount,
        sent: campaigns.sentCount,
        delivered: campaigns.deliveredCount,
        read: campaigns.readCount,
        replied: campaigns.repliedCount,
        failed: campaigns.failedCount,
      })
      .from(campaigns)
      .where(channelId ? eq(campaigns.channelId, channelId as string) : undefined)
      .orderBy(desc(campaigns.createdAt));

    const ws = workbook.addWorksheet("Campaign Analytics");

    if (campaignData.length > 0) {
      ws.columns = Object.keys(campaignData[0]).map((key) => ({
        header: key.charAt(0).toUpperCase() + key.slice(1),
        key,
        width: 15,
      }));

      campaignData.forEach((row) => ws.addRow(row));
    }
  }

  
  
  
  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=analytics-report-${new Date()
      .toISOString()
      .split("T")[0]}.xlsx`
  );
  res.send(buffer);
}
