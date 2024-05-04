import { db } from "../db";
import { eq, desc, and, gte, sql, lt } from "drizzle-orm";
import { contacts, users, type Contact, type InsertContact } from "@shared/schema";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function subWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - (weeks * 7));
  return d;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export class ContactRepository {
  async getAll(): Promise<Contact[]> {
    return await db.select().from(contacts).orderBy(desc(contacts.createdAt));
  }

  async getAllwithUsername(): Promise<(Contact & { createdByName: string })[]> {
  return await db
    .select({
      id: contacts.id,
      channelId: contacts.channelId,
      name: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      groups: contacts.groups,
      tags: contacts.tags,
      status: contacts.status,
      source: contacts.source,
      lastContact: contacts.lastContact,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
      createdBy: contacts.createdBy,

      
      createdByName: sql<string>`
        CONCAT(
          COALESCE(${users.firstName}, ''), ' ', COALESCE(${users.lastName}, '')
        )
      `.as("createdByName"),
    })
    .from(contacts)
    .leftJoin(users, eq(users.id, contacts.createdBy))
    .orderBy(desc(contacts.createdAt));
}

  async getByChannel(channelId: string): Promise<Contact[]> {
    return await db
      .select()
      .from(contacts)
      .where(eq(contacts.channelId, channelId))
      .orderBy(desc(contacts.createdAt));
  }

  async getContactsByUserId(
  userId: string,
  page: number = 1,
  limit: number = 10
): Promise<{ data: Contact[]; total: number; totalPages: number; page: number; limit: number }> {
  const offset = (page - 1) * limit;

  
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts)
    .where(eq(contacts.createdBy, userId));
  const total = totalResult[0]?.count ?? 0;

  
  const data = await db
    .select()
    .from(contacts)
    .where(eq(contacts.createdBy, userId))
    .orderBy(desc(contacts.createdAt))
    .limit(limit)
    .offset(offset);

  const totalPages = Math.ceil(total / limit);

  return {
    data,
    total,
    totalPages,
    page,
    limit,
  };
}

    
  async getContactsByTenant(tenantId: string): Promise<Contact[]> {
    return await db
      .select()
      .from(contacts)
      .where(eq(contacts.tenantId, tenantId))
      .orderBy(desc(contacts.createdAt));
  }
  async getContactByEmail(email: string): Promise<Contact[]> {
    return await db
      .select()
      .from(contacts)
      .where(eq(contacts.email, email))
      .orderBy(desc(contacts.createdAt));
  }
  async getContactByPhone(phone: string): Promise<Contact[]> {
    return await db
      .select()
      .from(contacts)
      .where(eq(contacts.phone, phone))
      .orderBy(desc(contacts.createdAt));
  }

  async getContactStats(channelId?: string) {
    const todayStart = startOfDay(new Date());
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); 
    const lastWeekStart = subWeeks(weekStart, 1);
    const lastWeekEnd = weekStart;
    
    const channelFilter = channelId
      ? eq(contacts.channelId, channelId)
      : undefined;

    
    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(channelFilter ?? sql`true`);

    
    const today = await db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(
        and(channelFilter ?? sql`true`, gte(contacts.createdAt, todayStart))
      );

    
    const week = await db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(
        and(channelFilter ?? sql`true`, gte(contacts.createdAt, weekStart))
      );

    
    const lastWeek = await db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(
        and(
          channelFilter,
          gte(contacts.createdAt, lastWeekStart),
          lt(contacts.createdAt, lastWeekEnd)
        )
      );

    return {
      totalCount: total[0]?.count ?? 0,
      todayCount: today[0]?.count ?? 0,
      weekCount: week[0]?.count ?? 0,
      lastWeekCount: lastWeek[0]?.count ?? 0,
    };
  }

  async getById(id: string): Promise<Contact | undefined> {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id));
    return contact || undefined;
  }

  async getByPhone(phone: string): Promise<Contact | undefined> {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.phone, phone));
    return contact || undefined;
  }

  async getByPhoneAndChannel(phone: string, channelId: string): Promise<Contact | undefined> {
    const normalizedPhone = normalizePhone(phone);
    const results = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.channelId, channelId),
          sql`REPLACE(REPLACE(REPLACE(${contacts.phone}, '+', ''), ' ', ''), '-', '') = ${normalizedPhone}`
        )
      );
    return results[0] || undefined;
  }

  
  
  
  
  
  
  

  async create(insertContact: InsertContact & { channelId?: string }): Promise<Contact> {
  
  if (!insertContact.channelId) {
    throw new Error("Cannot create contact without a channel. Please create a channel first.");
  }

  const [contact] = await db
    .insert(contacts)
    .values(insertContact)
    .returning();
  return contact;
}

  async update(
    id: string,
    contact: Partial<Contact>
  ): Promise<Contact | undefined> {
    const [updated] = await db
      .update(contacts)
      .set(contact)
      .where(eq(contacts.id, id))
      .returning();
    return updated || undefined;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(contacts)
      .where(eq(contacts.id, id))
      .returning();
    return result.length > 0;
  }

  async search(query: string): Promise<Contact[]> {
    const searchPattern = `%${query}%`;
    return await db
      .select()
      .from(contacts)
      .where(
        sql`${contacts.name} ILIKE ${searchPattern} OR ${contacts.phone} ILIKE ${searchPattern} OR ${contacts.email} ILIKE ${searchPattern}`
      );
  }

  async createBulk(insertContacts: InsertContact[]): Promise<Contact[]> {
    if (insertContacts.length === 0) return [];
    return await db.insert(contacts).values(insertContacts).returning();
  }

  async checkExistingPhones(
    phones: string[],
    channelId: string
  ): Promise<string[]> {
    const existingContacts = await db
      .select({ phone: contacts.phone })
      .from(contacts)
      .where(
        sql`${contacts.phone} = ANY(${phones}) AND ${contacts.channelId} = ${channelId}`
      );
    return existingContacts.map((c) => c.phone);
  }

  async getTotalCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(contacts);
    return result[0]?.count || 0;
  }
}
