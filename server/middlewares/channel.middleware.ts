import type { Request, Response, NextFunction } from 'express';
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { storage } from '../storage';
import { AppError } from './error.middleware';

export interface RequestWithChannel extends Request {
  activeChannel?: any;
  channelId?: string;
}

export async function requireActiveChannel(
  req: RequestWithChannel,
  res: Response,
  next: NextFunction
) {
  try {
    const activeChannel = await storage.getActiveChannel();
    if (!activeChannel) {
      throw new AppError(400, 'No active channel found. Please configure a channel first.');
    }
    req.activeChannel = activeChannel;
    req.channelId = activeChannel.id;
    next();
  } catch (error) {
    next(error);
  }
}

export async function extractChannelId(
  req: RequestWithChannel,
  res: Response,
  next: NextFunction
) {
  try {
    
    let channelId = req.query.channelId as string | undefined;
    
    
    if (!channelId) {
      const activeChannel = await storage.getActiveChannel();
      if (activeChannel) {
        channelId = activeChannel.id;
      }
    }
    
    req.channelId = channelId;
    next();
  } catch (error) {
    next(error);
  }
}
