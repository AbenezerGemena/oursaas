import type { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { storage } from "../storage";
import { contacts, users, insertContactSchema } from "@shared/schema";
import { AppError, asyncHandler } from "../middlewares/error.middleware";
import { db, dbRead } from "server/db";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";

interface RequestWithChannel extends Request {
  query: {
    search?: string;
    channelId?: string;
    page?: string;
    limit?: string;
    group?: string;
    status?: string;
    createdBy?: string;
  };
}

export const getContacts = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const { search, channelId } = req.query;
    const user = (req.session as any)?.user;

    let contacts;
    if (channelId && typeof channelId === "string") {
      if (user && user.role !== 'superadmin') {
        const ownerId = user.role === 'team' ? user.createdBy : user.id;
        const channels = await storage.getChannelsByUserId(ownerId);
        const channelIds = channels.map((ch: any) => ch.id);
        if (!channelIds.includes(channelId)) {
          return res.status(403).json({ error: 'Access denied to this channel' });
        }
      }
      contacts = await storage.getContactsByChannel(channelId);
    } else if (user && user.role === 'superadmin') {
      contacts = await storage.getContacts();
    } else {
      const ownerId = user?.role === 'team' ? user.createdBy : user?.id;
      if (!ownerId) {
        contacts = [];
      } else {
        const channels = await storage.getChannelsByUserId(ownerId);
        const channelIds = channels.map((ch: any) => ch.id);
        if (channelIds.length === 0) {
          contacts = [];
        } else {
          let allContacts: any[] = [];
          for (const chId of channelIds) {
            const chContacts = await storage.getContactsByChannel(chId);
            allContacts = allContacts.concat(chContacts);
          }
          contacts = allContacts;
        }
      }
    }

    if (search && typeof search === "string") {
      const searchLower = search.toLowerCase();
      contacts = contacts.filter(
        (contact: any) =>
          contact.name?.toLowerCase().includes(searchLower) ||
          contact.phone?.includes(search) ||
          contact.email?.toLowerCase().includes(searchLower)
      );
    }

    res.json(contacts);
  }
);

export const getContactsByUser = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const user = (req.session as any)?.user;

  if (!userId) {
    throw new AppError(400, "User ID is required");
  }

  if (user && user.role !== 'superadmin') {
    const ownerId = user.role === 'team' ? user.createdBy : user.id;
    if (userId !== ownerId && userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  const result = await storage.getContactsByUser(userId, page, limit);

  res.json({
    status: "success",
    data: result.data,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    },
  });
});

    

    
    
    

export const getContactsWithPagination = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const { search, channelId, page = "1", limit = "10", group, status, createdBy } = req.query;
    const user = (req.session as any)?.user;

    const currentPage = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const offset = (currentPage - 1) * pageSize;

    const conditions = [];

    if (channelId && typeof channelId === "string") {
      if (user && user.role !== 'superadmin') {
        const ownerId = user.role === 'team' ? user.createdBy : user.id;
        const userChannels = await storage.getChannelsByUserId(ownerId);
        const userChannelIds = userChannels.map((ch: any) => ch.id);
        if (!userChannelIds.includes(channelId)) {
          return res.status(403).json({ error: 'Access denied to this channel' });
        }
      }
      conditions.push(eq(contacts.channelId, channelId));
    } else if (user && user.role !== 'superadmin') {
      const ownerId = user?.role === 'team' ? user.createdBy : user?.id;
      if (ownerId) {
        const userChannels = await storage.getChannelsByUserId(ownerId);
        const userChannelIds = userChannels.map((ch: any) => ch.id);
        if (userChannelIds.length > 0) {
          conditions.push(inArray(contacts.channelId, userChannelIds));
        } else {
          return res.json({ data: [], pagination: { page: currentPage, limit: pageSize, count: 0, total: 0, totalPages: 0 } });
        }
      }
    }

    
    if (search && typeof search === "string") {
      const searchTerm = `%${search.toLowerCase()}%`;
      conditions.push(
        or(
          ilike(contacts.name, searchTerm),
          ilike(contacts.email, searchTerm),
          ilike(contacts.phone, `%${search}%`)
        )
      );
    }

    
    if (group && typeof group === "string") {
      const groupList = group.split(',').map(g => g.trim());
      if (groupList.length > 0) {
        const jsonArray = JSON.stringify(groupList);
        conditions.push(
          sql`${contacts.groups} @> ${sql.raw(`'${jsonArray}'::jsonb`)}`
        );
      }
    }

    
    if (status && typeof status === "string") {
      conditions.push(eq(contacts.status, status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const isSuperadmin = user && user.role === 'superadmin';

    
    const totalQuery = dbRead
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(whereClause);
    const totalResult = await totalQuery;
    const total = totalResult[0]?.count ?? 0;

    
    let stats: any = undefined;
    if (isSuperadmin) {
      const statsResult = await dbRead
        .select({
          uniquePhones: sql<number>`count(DISTINCT ${contacts.phone})`,
          activeCount: sql<number>`count(*) FILTER (WHERE ${contacts.status} = 'active')`,
          blockedCount: sql<number>`count(*) FILTER (WHERE ${contacts.status} = 'blocked')`,
        })
        .from(contacts)
        .where(whereClause);
      stats = {
        total: Number(total),
        uniquePhones: Number(statsResult[0]?.uniquePhones ?? 0),
        activeCount: Number(statsResult[0]?.activeCount ?? 0),
        blockedCount: Number(statsResult[0]?.blockedCount ?? 0),
      };
    }

    let data: any[];

    const dataQuery = dbRead
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
        createdByName: sql<string>`COALESCE(${users.username}, '')`.as("createdByName"),
      })
      .from(contacts)
      .leftJoin(users, eq(users.id, sql`${contacts.createdBy}::text`))
      .where(whereClause)
      .orderBy(sql`${contacts.createdAt} DESC`)
      .limit(pageSize)
      .offset(offset);

    data = await dataQuery;

    if (isSuperadmin && data.length > 0) {
      const phoneMap = new Map<string, any>();
      for (const row of data) {
        const key = row.phone;
        if (phoneMap.has(key)) {
          const existing = phoneMap.get(key);
          const existingNames = (existing.createdByName || '').split(', ').filter(Boolean);
          const newName = (row.createdByName || '').trim();
          if (newName && !existingNames.includes(newName)) {
            existing.createdByName = [...existingNames, newName].join(', ');
          }
        } else {
          phoneMap.set(key, { ...row });
        }
      }
      data = Array.from(phoneMap.values());
    }

    res.json({
      data,
      ...(stats ? { stats } : {}),
      pagination: {
        page: currentPage,
        limit: pageSize,
        count: data.length,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  }
);

 const getContactsWithPaginationOld = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const { search, channelId, page = "1", limit = "10", group, status, createdBy } = req.query;

    const currentPage = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const offset = (currentPage - 1) * pageSize;

    const conditions = [];

    
    if (channelId && typeof channelId === "string") {
      conditions.push(eq(contacts.channelId, channelId));
    }

    
    if (createdBy && typeof createdBy === "string") {
      conditions.push(eq(contacts.createdBy, createdBy));
    }

    
    if (search && typeof search === "string") {
      const searchTerm = `%${search.toLowerCase()}%`;
      conditions.push(
        or(
          ilike(contacts.name, searchTerm),
          ilike(contacts.email, searchTerm),
          ilike(contacts.phone, `%${search}%`)
        )
      );
    }

    
    if (group && typeof group === "string") {
      const groupList = group.split(',').map(g => g.trim());
      if (groupList.length > 0) {
        const jsonArray = JSON.stringify(groupList);
        conditions.push(
          sql`${contacts.groups} @> ${sql.raw(`'${jsonArray}'::jsonb`)}`
        );
      }
    }

    
    if (status && typeof status === "string") {
      conditions.push(eq(contacts.status, status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    
    const totalQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(whereClause);
    const totalResult = await totalQuery;
    const total = totalResult[0]?.count ?? 0;

    
    const dataQuery = db
      .select()
      .from(contacts)
      .where(whereClause)
      .limit(pageSize)
      .offset(offset);

    const data = await dataQuery;

    res.json({
      data,
      pagination: {
        page: currentPage,
        limit: pageSize,
        count: data.length,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  }
);

export const getContact = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const contact = await storage.getContact(id);
  if (!contact) {
    throw new AppError(404, "Contact not found");
  }
  res.json(contact);
});

export const createContact = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const validatedContact = insertContactSchema.parse(req.body);
    const createdBy =(req.session as any).user.id;

    
    
    let channelId = (req.body.channelId as string) || undefined;
    
    if (!channelId) {
      const activeChannel = await storage.getActiveChannel();
      if (activeChannel) {
        channelId = activeChannel.id;
      }
    }

    
    if (!channelId) {
      return res
        .status(400)
        .json({ error: "You must create a channel before adding a contact." });
    }

    
    const existingContacts = channelId
      ? await storage.getContactsByChannel(channelId)
      : await storage.getContacts();

    const duplicate = existingContacts.find(
      (c) => c.phone === validatedContact.phone
    );
    if (duplicate) {
      throw new AppError(409, "This phone number is already exists.");
    }

    const contact = await storage.createContact({
      ...validatedContact,
      channelId,
      createdBy,
    });

    res.json(contact);
  }
);

export const updateContact = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const contact = await storage.updateContact(id, req.body);
    if (!contact) {
      throw new AppError(404, "Contact not found");
    }

    if (req.body.name && contact.phone && contact.channelId) {
      const conversation = await storage.getConversationByPhoneAndChannel(contact.phone, contact.channelId);
      if (conversation) {
        await storage.updateConversation(conversation.id, {
          contactName: req.body.name,
        });
      }
    }

    res.json(contact);
  }
);

export const deleteContact = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const success = await storage.deleteContact(id);
    if (!success) {
      throw new AppError(404, "Contact not found");
    }
    res.status(204).send();
  }
);

export const deleteBulkContacts = asyncHandler(
  async (req: Request, res: Response) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, "No contact IDs provided");
    }

    const result = await db
      .delete(contacts)
      .where(inArray(contacts.id, ids));

    
    if (result.rowCount === 0) {
      throw new AppError(404, "No contacts found to delete");
    }

    res.status(204).send();
  }
);

export const importContacts = asyncHandler(
  async (req: RequestWithChannel, res: Response) => {
    const { contacts, channelId: bodyChannelId } = req.body;

    if (!Array.isArray(contacts)) {
      throw new AppError(400, "Contacts must be an array");
    }

    
    let channelId =
      bodyChannelId || (req.query.channelId as string | undefined);
    if (!channelId) {
      const activeChannel = await storage.getActiveChannel();
      if (activeChannel) {
        channelId = activeChannel.id;
      }
    }

    
    const existingContacts = channelId
      ? await storage.getContactsByChannel(channelId)
      : await storage.getContacts();

    const existingPhones = new Set(existingContacts.map((c) => c.phone));

    const createdContacts = [];
    const duplicates = [];
    const errors = [];

    for (const contact of contacts) {
      try {
        
        if (existingPhones.has(contact.phone)) {
          duplicates.push({
            contact,
            reason: "Phone number already exists",
          });
          continue;
        }

        const validatedContact = insertContactSchema.parse({
          ...contact,
          channelId,
          createdBy: (req.session as any).user.id,
        });
        const created = await storage.createContact(validatedContact);
        createdContacts.push(created);
        existingPhones.add(created.phone); 
      } catch (error) {
        errors.push({
          contact,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    res.json({
      created: createdContacts.length,
      duplicates: duplicates.length,
      failed: errors.length,
      total: contacts.length,
      details: {
        created: createdContacts.length,
        duplicates: duplicates.slice(0, 10), 
        errors: errors.slice(0, 10), 
      },
    });
  }
);
