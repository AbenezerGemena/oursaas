import { db } from "../db";
import { eq } from "drizzle-orm";
import { 
  messages, 
  type Message, 
  type InsertMessage 
} from "@shared/schema";

export class MessageRepository {
  async getByConversation(conversationId: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async create(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db
      .insert(messages)
      .values(insertMessage)
      .returning();
    return message;
  }

  async update(id: string, message: Partial<Message>): Promise<Message | undefined> {
    const [updated] = await db
      .update(messages)
      .set(message)
      .where(eq(messages.id, id))
      .returning();
    return updated || undefined;
  }

  async getByWhatsAppId(whatsappMessageId: string): Promise<Message | undefined> {
    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.whatsappMessageId, whatsappMessageId));
    return message || undefined;
  }
  
  async getConversationMessages(conversationId: string): Promise<Message | undefined> {
    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    return message || undefined;
  }

  async getById(id: string): Promise<Message | undefined> {
    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, id));
    return message || undefined;
  }
}
