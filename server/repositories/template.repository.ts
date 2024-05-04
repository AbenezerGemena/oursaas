import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { 
  templates, 
  users,
  channels,
  type Template, 
  type InsertTemplate 
} from "@shared/schema";

export class TemplateRepository {
  async getAllold(): Promise<Template[]> {
    return await db.select().from(templates).orderBy(desc(templates.createdAt));
  }

 async getAllOLD() {
  return await db
    .select({
      id: templates.id,
      channelId: templates.channelId,
      name: templates.name,
      category: templates.category,
      language: templates.language,
      header: templates.header,
      body: templates.body,
      footer: templates.footer,
      buttons: templates.buttons,
      variables: templates.variables,
      status: templates.status,
      rejectionReason: templates.rejectionReason,
      mediaType: templates.mediaType,
      mediaUrl: templates.mediaUrl,
      mediaHandle: templates.mediaHandle,
      carouselCards: templates.carouselCards,
      whatsappTemplateId: templates.whatsappTemplateId,
      usage_count: templates.usage_count,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
      createdBy: templates.createdBy,

      
      createdByName: sql<string>`
        CONCAT(
          COALESCE(${users.firstName}, ''), 
          ' ', 
          COALESCE(${users.lastName}, '')
        )
      `.as("createdByName"),
    })
    .from(templates)
    .leftJoin(users, eq(users.id, templates.createdBy))
    .orderBy(desc(templates.createdAt));
}

async getAll(page: number = 1, limit: number = 10) {
  const offset = (page - 1) * limit;

  
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(templates);

  const total = Number(count);
  const totalPages = Math.ceil(total / limit);

  
  const rows = await db
    .select({
      id: templates.id,
      channelId: templates.channelId,
      channelName: channels.name, 
      name: templates.name,
      category: templates.category,
      language: templates.language,
      header: templates.header,
      body: templates.body,
      footer: templates.footer,
      buttons: templates.buttons,
      variables: templates.variables,
      status: templates.status,
      rejectionReason: templates.rejectionReason,
      mediaType: templates.mediaType,
      mediaUrl: templates.mediaUrl,
      mediaHandle: templates.mediaHandle,
      carouselCards: templates.carouselCards,
      whatsappTemplateId: templates.whatsappTemplateId,
      usage_count: templates.usage_count,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
      createdBy: templates.createdBy,

      createdByName: sql<string>`
        CONCAT(
          COALESCE(${users.firstName}, ''), 
          ' ', 
          COALESCE(${users.lastName}, '')
        )
      `.as("createdByName"),
    })
    .from(templates)
    .leftJoin(users, eq(users.id, templates.createdBy))
    .leftJoin(channels, eq(channels.id, templates.channelId)) 
    .orderBy(desc(templates.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    success: true,
    data: rows,
    pagination: {
      total,
      totalPages,
      page,
      limit,
    },
  };
}

async getTemplateByUserID(
  userId: string,
  page: number = 1,
  limit: number = 10
) {
  const offset = (page - 1) * limit;

  
  const templatesData = await db
    .select({
      template: templates, 
    })
    .from(templates)
    .leftJoin(channels, eq(templates.channelId, channels.id))
    .where(eq(channels.createdBy, userId))
    .orderBy(desc(templates.createdAt))
    .limit(limit)
    .offset(offset);

  
  const totalResult = await db
    .select({
      total: sql<number>`COUNT(*)`,
    })
    .from(templates)
    .leftJoin(channels, eq(templates.channelId, channels.id))
    .where(eq(channels.createdBy, userId));

  const total = Number(totalResult[0]?.total ?? 0);

  return {
    data:  templatesData.map((t) => t.template), 
    total,
    page,
    limit,
  };

  
  
  
  
  
  
  
  
  
  
}

  async getByChannelOld(channelId: string): Promise<Template[]> {
    return await db
      .select()
      .from(templates)
      .where(eq(templates.channelId, channelId))
      .orderBy(desc(templates.createdAt));
  }

async getByChannel(
  channelId: string,
  page: number = 1,
  limit: number = 10
): Promise<{ data: Template[]; total: number }> {
  const offset = (page - 1) * limit;

  
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(templates)
    .where(eq(templates.channelId, channelId));

  const total = Number(count);

  
  const data = await db
    .select()
    .from(templates)
    .where(eq(templates.channelId, channelId))
    .orderBy(desc(templates.createdAt))
    .limit(limit)
    .offset(offset);

  return { data, total };
}

  async getById(id: string): Promise<Template | undefined> {
    const [template] = await db.select().from(templates).where(eq(templates.id, id));
    return template || undefined;
  }

  async getByName(name: string): Promise<Template | undefined> {
    const [template] = await db.select().from(templates).where(eq(templates.name, name));
    return template || undefined;
  }

  async getByNameAndChannel(name: string, channelId: string): Promise<Template | undefined> {
    const [template] = await db.select().from(templates).where(
      and(eq(templates.name, name), eq(templates.channelId, channelId))
    );
    return template || undefined;
  }

  async create(insertTemplate: InsertTemplate  & { createdBy: string }): Promise<Template> {
    const [template] = await db
      .insert(templates)
      .values(insertTemplate)
      .returning();
    return template;
  }

  async update(id: string, template: Partial<Template>): Promise<Template | undefined> {
    const [updated] = await db
      .update(templates)
      .set(template)
      .where(eq(templates.id, id))
      .returning();
    return updated || undefined;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(templates).where(eq(templates.id, id)).returning();
    return result.length > 0;
  }
}
