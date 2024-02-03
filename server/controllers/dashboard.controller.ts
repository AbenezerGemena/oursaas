import type { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from '../storage';
import { AppError, asyncHandler } from '../middlewares/error.middleware';
import type { RequestWithChannel } from '../middlewares/channel.middleware';

export const getDashboardStats = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  const channelId = req.query.channelId as string | undefined;
  const user = (req.session as any)?.user;
  
  if (channelId) {
    if (user && user.role !== 'superadmin') {
      const ownerId = user.role === 'team' ? user.createdBy : user.id;
      const channels = await storage.getChannelsByUserId(ownerId);
      const channelIds = channels.map((ch: any) => ch.id);
      if (!channelIds.includes(channelId)) {
        return res.status(403).json({ error: 'Access denied to this channel' });
      }
    }
    const userId = user?.id || '';
    const stats = await storage.getDashboardStatsByChannel(channelId, userId);
    res.json(stats);
  } else if (user && user.role === 'superadmin') {
    const stats = await storage.getDashboardStats();
    res.json(stats);
  } else {
    const ownerId = user?.role === 'team' ? user?.createdBy : user?.id;
    if (!ownerId) return res.json({ totalMessages: 0, activeCampaigns: 0, deliveryRate: 0, newLeads: 0, messagesGrowth: 0, campaignsRunning: 0, unreadChats: 0 });
    const channels = await storage.getChannelsByUserId(ownerId);
    if (channels.length === 0) return res.json({ totalMessages: 0, activeCampaigns: 0, deliveryRate: 0, newLeads: 0, messagesGrowth: 0, campaignsRunning: 0, unreadChats: 0 });
    const stats = await storage.getDashboardStatsByChannel(channels[0].id, user?.id || '');
    res.json(stats);
  }
});

export const getDashboardStatsForAdmin = asyncHandler(async (req: RequestWithChannel, res: Response) => {
    const user = (req.session as any)?.user;
    if (!user || user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const stats = await storage.getDashboardStats();
    res.json(stats);
});

export const getDashboardStatsForUser = asyncHandler(async(req: RequestWithChannel, res: Response) => {
  const channelId = req.query.channelId as string | undefined;
  const user = (req.session as any)?.user;
  const userId = user?.id;

  
  if (channelId && user && user.role !== 'superadmin') {
    const ownerId = user.role === 'team' ? user.createdBy : user.id;
    const channels = await storage.getChannelsByUserId(ownerId);
    const channelIds = channels.map((ch: any) => ch.id);
    if (!channelIds.includes(channelId)) {
      return res.status(403).json({ error: 'Access denied to this channel' });
    }
  }

  const stats = await storage.getDashboardStatsByChannel(channelId || '', userId)
  res.json(stats);
})

export const getAnalytics = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  const channelId = req.query.channelId as string | undefined;
  const days = req.query.days ? parseInt(req.query.days as string) : undefined;
  const user = (req.session as any)?.user;
  
  if (channelId) {
    if (user && user.role !== 'superadmin') {
      const ownerId = user.role === 'team' ? user.createdBy : user.id;
      const channels = await storage.getChannelsByUserId(ownerId);
      const channelIds = channels.map((ch: any) => ch.id);
      if (!channelIds.includes(channelId)) {
        return res.status(403).json({ error: 'Access denied to this channel' });
      }
    }
    const analytics = await storage.getAnalyticsByChannel(channelId, days);
    res.json(analytics);
  } else if (user && user.role === 'superadmin') {
    const analytics = await storage.getAnalytics();
    res.json(analytics);
  } else {
    const ownerId = user?.role === 'team' ? user?.createdBy : user?.id;
    if (!ownerId) return res.json([]);
    const channels = await storage.getChannelsByUserId(ownerId);
    if (channels.length === 0) return res.json([]);
    const analytics = await storage.getAnalyticsByChannel(channels[0].id, days);
    res.json(analytics);
  }
});

export const createAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const analytics = await storage.createAnalytics(req.body);
  res.json(analytics);
});
