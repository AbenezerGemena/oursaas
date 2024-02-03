import type { Request, Response, NextFunction } from 'express';
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { storage } from '../storage';

export async function resolveTenantChannels(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const user = (req.session as any)?.user || (req as any).user;
    
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (user.role === 'superadmin') {
      (req as any).isSuperAdmin = true;
      (req as any).tenantChannelIds = null;
      return next();
    }

    const ownerId = user.role === 'team' ? user.createdBy : user.id;
    
    if (!ownerId) {
      (req as any).isSuperAdmin = false;
      (req as any).tenantChannelIds = [];
      return next();
    }

    const channels = await storage.getChannelsByUserId(ownerId);
    const channelIds = channels.map((ch: any) => ch.id);

    (req as any).isSuperAdmin = false;
    (req as any).tenantChannelIds = channelIds;
    next();
  } catch (error) {
    next(error);
  }
}

export function verifyChannelOwnership(
  req: Request,
  channelId: string
): boolean {
  if ((req as any).isSuperAdmin) return true;
  const tenantChannelIds: string[] = (req as any).tenantChannelIds || [];
  return tenantChannelIds.includes(channelId);
}
