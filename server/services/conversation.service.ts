import { conversations, messages, users , contacts  } from "@shared/schema";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { eq,desc,and, sql } from "drizzle-orm";
import { db } from "../db";

export async function getConversationsFromDB(channelId: string) {
  const rows = await db
    .select({
      conversation: conversations,
      contact: contacts,
      assignedToName:
        sql`${users.firstName} || ' ' || ${users.lastName}`.as("assignedBy"),
    })
    .from(conversations)
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    .leftJoin(users, eq(conversations.assignedTo, users.id))
    .where(eq(conversations.channelId, channelId))
    .orderBy(desc(conversations.lastMessageAt));

  return rows.map(row => ({
    ...row.conversation,
    lastMessageAt: row.conversation.lastMessageAt || null,
    lastMessageText: row.conversation.lastMessageText || null,
    assignedToName: row.assignedToName || null,
    contact: row.contact || null,
  }));
}
