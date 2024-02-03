import type { Request, Response } from 'express';
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from '../storage';
import { AppError, asyncHandler } from '../middlewares/error.middleware';
import type { RequestWithChannel } from '../middlewares/channel.middleware';
import { conversations, messages, users , contacts , conversationAssignments , insertConversationAssignmentSchema, insertConversationSchema } from "@shared/schema";
import { eq,desc,and, sql } from "drizzle-orm";
import { db, dbRead } from "../db";
import { triggerService } from "../services/automation-execution-service";

export async function getConversations(req: Request, res: Response) {
  try {
    const channelId = String(req.query.channelId || "");
    const user = (req.session as any)?.user;
    
    if (channelId && user && user.role !== 'superadmin') {
      const ownerId = user.role === 'team' ? user.createdBy : user.id;
      const channels = await storage.getChannelsByUserId(ownerId);
      const channelIds = channels.map((ch: any) => ch.id);
      if (!channelIds.includes(channelId)) {
        return res.status(403).json({ error: 'Access denied to this channel' });
      }
    }

    const rows = await dbRead
      .select({
        conversation: conversations,
        contact: contacts,
        assignedToName: sql`${users.firstName} || ' ' || ${users.lastName}`.as("assignedBy"),
      })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(users, eq(conversations.assignedTo, users.id))
      .where(eq(conversations.channelId, channelId))
      .orderBy(desc(conversations.lastMessageAt));

    const formatted = rows.map((row) => ({
      ...row.conversation,
      lastMessageAt: row.conversation.lastMessageAt || null,
      lastMessageText: row.conversation.lastMessageText || null,
      assignedToName: row.assignedToName || null,
      contact: row.contact || null,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ error: "Unexpected error" });
  }
}

export async function fetchConversationList(channelId: string) {
  const rows = await dbRead
    .select({
      conversation: conversations,
      contact: contacts,
      assignedToName: sql`${users.firstName} || ' ' || ${users.lastName}`.as(
        "assignedBy"
      ),
    })
    .from(conversations)
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    .leftJoin(users, eq(conversations.assignedTo, users.id))
    .where(eq(conversations.channelId, channelId))
    .orderBy(desc(conversations.lastMessageAt));

  return rows.map((row) => ({
    ...row.conversation,
    lastMessageAt: row.conversation.lastMessageAt || null,
    lastMessageText: row.conversation.lastMessageText || null,
    assignedToName: row.assignedToName || null,
    contact: row.contact || null,
  }));
}

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const conversation = await storage.getConversation(id);
  if (!conversation) {
    throw new AppError(404, 'Conversation not found');
  }

  res.json(conversation);
});

export const createConversation = asyncHandler(async (req: RequestWithChannel, res: Response) => {
  const validatedConversation = insertConversationSchema.parse(req.body);
  
  
  let channelId = validatedConversation.channelId;
  if (!channelId) {
    const activeChannel = await storage.getActiveChannel();
    if (activeChannel) {
      channelId = activeChannel.id;
    }
  }
  
  const conversation = await storage.createConversation({
    ...validatedConversation,
    channelId
  });

  try {
    if (!validatedConversation.channelId) {
      throw new Error("channelId is missing");
    }
    if (!validatedConversation.contactId) {
      throw new Error("contactId is missing");
    }
    await triggerService.handleNewConversation(
      conversation.id, 
      validatedConversation.channelId, 
      validatedConversation.contactId
    );
    console.log(`Triggered automations for new conversation: ${conversation.id}`);
  } catch (error) {
    console.error(`Failed to trigger automations:`, error);
    
  }
  
  res.json(conversation);
});

export const updateConversation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  

  const conversation = await storage.updateConversation(id, {assignedTo: req.body.assignedTo, status: req.body.status});

  if (!conversation) {
    throw new AppError(404, 'Conversation not found');
  }

  
  const validatedConversation = insertConversationAssignmentSchema.parse({
    conversationId: id,
    userId: req.body.assignedTo,
    assignedBy: req.user?.id,
    assignedAt: new Date(req.body.assignedAt),
    status: req.body.status,
  });

  
if(req.body.status ==="assigned"){
  const insertConversation = await db
    .insert(conversationAssignments)
    .values(validatedConversation)
    .returning();
}

  res.json(
     {   ...conversation,assignedToName:req.body.assignedToName}
   );
});

export const deleteConversation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const success = await storage.deleteConversation(id);
  if (!success) {
    throw new AppError(404, 'Conversation not found');
  }
  res.status(204).send();
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const conversation = await storage.updateConversation(id, {
    unreadCount: 0
  });
  if (!conversation) {
    throw new AppError(404, 'Conversation not found');
  }
  res.json(conversation);
});
