import { groups, contacts } from "@shared/schema";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { eq, and, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "server/db";

export const createGroup = async (req: Request, res: Response) => {
  try {
    const user = (req as any).session?.user;
    const { name, description, channelId } = req.body;

    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

    const [group] = await db
      .insert(groups)
      .values({ name, description, createdBy: user?.id, channelId })
      .returning();

    res.json({ success: true, group });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "Something went wrong";
    res.status(500).json({ error: errorMsg });
  }
};

export const getGroups = async (req: Request, res: Response) => {
  try {
    const user = (req as any).session?.user;
    const { channelId } = req.query;

    if (!channelId) {
      if (user?.role === "superadmin") {
        const allData = await db.select().from(groups);
        return res.json({ success: true, groups: allData });
      }
      return res.status(400).json({ success: false, error: "channelId is required" });
    }

    const data = await db
      .select()
      .from(groups)
      .where(eq(groups.channelId, String(channelId)));

    return res.json({ success: true, groups: data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
};

export const getGroupById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.id, id));

    if (!group) return res.status(404).json({ error: "Group not found" });

    res.json({ success: true, group });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "Something went wrong";
    res.status(500).json({ error: errorMsg });
  }
};

export const updateGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const [updated] = await db
      .update(groups)
      .set({ name, description })
      .where(eq(groups.id, id))
      .returning();

    res.json({ success: true, updated });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "Something went wrong";
    res.status(500).json({ error: errorMsg });
  }
};

export const deleteGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [deleted] = await db
      .delete(groups)
      .where(eq(groups.id, id))
      .returning();

    if (deleted) {
      const allContacts = await db
        .select()
        .from(contacts)
        .where(sql`${contacts.groups}::jsonb @> ${JSON.stringify([deleted.name])}::jsonb`);

      for (const contact of allContacts) {
        const updatedGroups = (contact.groups || []).filter((g: string) => g !== deleted.name);
        await db
          .update(contacts)
          .set({ groups: updatedGroups })
          .where(eq(contacts.id, contact.id));
      }
    }

    res.json({ success: true, deleted });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "Something went wrong";
    res.status(500).json({ error: errorMsg });
  }
};

export const addContactsToGroup = async (req: Request, res: Response) => {
  try {
    const { contactIds, groupName, channelId } = req.body;

    if (!contactIds?.length || !groupName || !channelId) {
      return res.status(400).json({ error: "contactIds, groupName, and channelId are required" });
    }

    const [group] = await db
      .select()
      .from(groups)
      .where(and(eq(groups.name, groupName), eq(groups.channelId, channelId)));

    if (!group) {
      return res.status(404).json({ error: "Group not found in this channel" });
    }

    let updatedCount = 0;
    for (const contactId of contactIds) {
      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.channelId, channelId)));

      if (contact) {
        const currentGroups = contact.groups || [];
        if (!currentGroups.includes(groupName)) {
          await db
            .update(contacts)
            .set({ groups: [...currentGroups, groupName] })
            .where(eq(contacts.id, contactId));
          updatedCount++;
        }
      }
    }

    res.json({ success: true, updatedCount });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "Something went wrong";
    res.status(500).json({ error: errorMsg });
  }
};

export const removeContactsFromGroup = async (req: Request, res: Response) => {
  try {
    const { contactIds, groupName, channelId } = req.body;

    if (!contactIds?.length || !groupName || !channelId) {
      return res.status(400).json({ error: "contactIds, groupName, and channelId are required" });
    }

    let updatedCount = 0;
    for (const contactId of contactIds) {
      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.channelId, channelId)));

      if (contact) {
        const currentGroups = contact.groups || [];
        if (currentGroups.includes(groupName)) {
          await db
            .update(contacts)
            .set({ groups: currentGroups.filter((g: string) => g !== groupName) })
            .where(eq(contacts.id, contactId));
          updatedCount++;
        }
      }
    }

    res.json({ success: true, updatedCount });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "Something went wrong";
    res.status(500).json({ error: errorMsg });
  }
};

export const getGroupContactCount = async (req: Request, res: Response) => {
  try {
    const { channelId } = req.query;

    if (!channelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

    const channelGroups = await db
      .select()
      .from(groups)
      .where(eq(groups.channelId, String(channelId)));

    const counts: Record<string, number> = {};
    for (const group of channelGroups) {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(
          and(
            eq(contacts.channelId, String(channelId)),
            sql`${contacts.groups}::jsonb @> ${JSON.stringify([group.name])}::jsonb`
          )
        );
      counts[group.name] = Number(result[0]?.count || 0);
    }

    res.json({ success: true, counts });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "Something went wrong";
    res.status(500).json({ error: errorMsg });
  }
};
