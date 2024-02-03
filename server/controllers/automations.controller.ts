import type { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from '../storage';
import { insertAutomationSchema } from '@shared/schema';
import { AppError, asyncHandler } from '../middlewares/error.middleware';
import type { RequestWithChannel } from '../middlewares/channel.middleware';

export const getAutomations = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  const channelId = req.query.channelId as string | undefined;
  const automations = channelId 
    ? await storage.getAutomationsByChannel(channelId)
    : await storage.getAutomations();
  res.json(automations);
});

export const getAutomation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const automation = await storage.getAutomation(id);
  if (!automation) {
    throw new AppError(404, 'Automation not found');
  }
  res.json(automation);
});

export const createAutomation = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  console.log('Request body:', req.body); 
  const validatedAutomation = insertAutomationSchema.parse(req.body);
  
  
  let channelId = validatedAutomation.channelId;
  if (!channelId) {
    const activeChannel = await storage.getActiveChannel();
    if (activeChannel) {
      channelId = activeChannel.id;
    }
  }
  
  const automation = await storage.createAutomation({
    ...validatedAutomation,
    channelId
  });
  
  res.json(automation);
});

export const updateAutomation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const automation = await storage.updateAutomation(id, req.body);
  if (!automation) {
    throw new AppError(404, 'Automation not found');
  }
  res.json(automation);
});

export const deleteAutomation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const success = await storage.deleteAutomation(id);
  if (!success) {
    throw new AppError(404, 'Automation not found');
  }
  res.status(204).send();
});

export const toggleAutomation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const automation = await storage.getAutomation(id);
  
  if (!automation) {
    throw new AppError(404, 'Automation not found');
  }
  
  const updated = await storage.updateAutomation(id, {
    status: !automation.status ? 'active' : 'inactive'
  });
  
  res.json(updated);
});
