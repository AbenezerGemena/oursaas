import type { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from '../storage';
import { AppError, asyncHandler } from '../middlewares/error.middleware';
import { eq, desc, and, or, like, gte, sql } from 'drizzle-orm';
import { messages, conversations, contacts, whatsappChannels } from '@shared/schema';
import { db } from '../db';

export const getMessageLogs = asyncHandler(async (req: Request, res: Response) => {
  const { channelId, status, dateRange, search, page, pageSize } = req.query;

  let conditions = [];

  if (channelId) {
    conditions.push(eq(conversations.channelId, channelId as string));
  }

  if (dateRange && dateRange !== 'all') {
    const now = new Date();
    let startDate = new Date();

    switch (dateRange) {
      case '1d':
        startDate.setDate(now.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
    }

    conditions.push(gte(messages.createdAt, startDate));
  }

  if (status && status !== 'all') {
    conditions.push(eq(messages.status, status as any));
  }

  if (search) {
    conditions.push(
      or(
        like(conversations.contactPhone, `%${search}%`),
        like(messages.content, `%${search}%`),
        like(conversations.contactName, `%${search}%`)
      )!
    );
  }

  const selectFields = {
    id: messages.id,
    channelId: conversations.channelId,
    phoneNumber: conversations.contactPhone,
    contactName: conversations.contactName,
    channelName: whatsappChannels.name,
    content: messages.content,
    direction: messages.direction,
    fromUser: messages.fromUser,
    status: messages.status,
    errorCode: messages.errorCode,
    errorMessage: messages.errorMessage,
    errorDetails: messages.errorDetails,
    deliveredAt: messages.deliveredAt,
    readAt: messages.readAt,
    whatsappMessageId: messages.whatsappMessageId,
    createdAt: messages.createdAt,
    updatedAt: messages.updatedAt,
    contentType: messages.messageType,
    mediaUrl: messages.mediaUrl,
    mediaId: messages.mediaId,
    mediaMimeType: messages.mediaMimeType,
    metadata: messages.metadata,
    type: messages.type,
  };

  const baseFrom = db
    .select(selectFields)
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .leftJoin(whatsappChannels, eq(conversations.channelId, whatsappChannels.id));

  const countFrom = db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .leftJoin(whatsappChannels, eq(conversations.channelId, whatsappChannels.id));

  let dataQuery = baseFrom as typeof baseFrom;
  let countQuery = countFrom as typeof countFrom;

  if (conditions.length > 0) {
    const whereClause = and(...conditions);
    dataQuery = dataQuery.where(whereClause) as typeof dataQuery;
    countQuery = countQuery.where(whereClause) as typeof countQuery;
  }

  const currentPage = Math.max(1, Number(page) || 1);
  const currentPageSize = Math.min(100, Math.max(1, Number(pageSize) || Number(req.query.limit) || 25));
  const offset = (currentPage - 1) * currentPageSize;

  const [messageLogs, countResult] = await Promise.all([
    dataQuery.orderBy(desc(messages.createdAt)).limit(currentPageSize).offset(offset),
    countQuery,
  ]);

  const total = Number(countResult[0]?.count) || 0;
  const totalPages = Math.ceil(total / currentPageSize);

  const formattedLogs = messageLogs.map((log: any) => ({
    id: log.id,
    channelId: log.channelId || '',
    phoneNumber: log.phoneNumber || '',
    contactName: log.contactName || '',
    channelName: log.channelName || '',
    messageType: (log.direction === 'outbound' || log.direction === 'outgoing') ? 'sent' : 'received',
    contentType: log.contentType || log.type || 'text',
    content: log.content || '',
    mediaUrl: log.mediaUrl || null,
    mediaId: log.mediaId || null,
    mediaMimeType: log.mediaMimeType || null,
    metadata: log.metadata || null,
    templateName: log.content?.startsWith('Template:') ? log.content.replace('Template: ', '') : undefined,
    status: log.status || 'pending',
    errorCode: log.errorCode,
    errorMessage: log.errorMessage,
    errorDetails: log.errorDetails,
    deliveredAt: log.deliveredAt,
    readAt: log.readAt,
    whatsappMessageId: log.whatsappMessageId,
    createdAt: log.createdAt || new Date().toISOString(),
    updatedAt: log.updatedAt || new Date().toISOString(),
  }));

  if (page) {
    res.json({
      data: formattedLogs,
      total,
      page: currentPage,
      pageSize: currentPageSize,
      totalPages,
    });
  } else {
    res.json(formattedLogs);
  }
});

export const updateMessageStatus = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const { status } = req.body;

  
  const [updatedMessage] = await db
    .update(messages)
    .set({
      status,
    })
    .where(eq(messages.id, messageId))
    .returning();

  if (!updatedMessage) {
    throw new AppError(404, 'Message not found');
  }

  res.json(updatedMessage);
});
