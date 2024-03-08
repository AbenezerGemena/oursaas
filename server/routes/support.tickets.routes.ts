import { requireAuth, requireRole } from "server/middlewares/auth.middleware";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "server/db";
import { supportTickets, ticketMessages, users } from "@shared/schema";
import { triggerNotification, NOTIFICATION_EVENTS } from "server/services/notification.service";

export function registerTicketsRoutes(app: Express) {
  
  
  

  
  app.get("/api/tickets", requireAuth, async (req: Request, res: Response) => {
    try {
      const { status, priority, search, page = "1", limit = "25" } = req.query;
      const userId = (req as any).user.id;
      const userType = (req as any).user.role; 

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      let conditions: any[] = [];

      
      if (userType !== "superadmin") {
        conditions.push(
          and(
            eq(supportTickets.creatorId, userId),
            eq(supportTickets.creatorType, userType as any)
          )
        );
      }

      if (status) {
        conditions.push(eq(supportTickets.status, status as any));
      }

      if (priority) {
        conditions.push(eq(supportTickets.priority, priority as any));
      }

      if (search) {
        conditions.push(
          or(
            ilike(supportTickets.title, `%${search}%`),
            ilike(supportTickets.description, `%${search}%`),
            ilike(supportTickets.creatorName, `%${search}%`)
          )
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [ticketList, countResult] = await Promise.all([
        db
          .select({
            id: supportTickets.id,
            title: supportTickets.title,
            description: supportTickets.description,
            status: supportTickets.status,
            priority: supportTickets.priority,
            creatorId: supportTickets.creatorId,
            creatorType: supportTickets.creatorType,
            creatorName: supportTickets.creatorName,
            creatorEmail: supportTickets.creatorEmail,
            assignedToId: supportTickets.assignedToId,
            assignedToName: supportTickets.assignedToName,
            createdAt: supportTickets.createdAt,
            updatedAt: supportTickets.updatedAt,
            resolvedAt: supportTickets.resolvedAt,
            closedAt: supportTickets.closedAt,
            freshEmail: users.email,
            freshName: users.username,
          })
          .from(supportTickets)
          .leftJoin(users, eq(supportTickets.creatorId, users.id))
          .where(whereClause)
          .orderBy(desc(supportTickets.createdAt))
          .limit(limitNum)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(supportTickets)
          .where(whereClause),
      ]);

      const ticketsWithFreshData = ticketList.map((t: any) => ({
        ...t,
        creatorEmail: t.freshEmail || t.creatorEmail,
        creatorName: t.freshName || t.creatorName,
        freshEmail: undefined,
        freshName: undefined,
      }));

      res.json({
        tickets: ticketsWithFreshData,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: Number(countResult[0]?.count || 0),
        },
      });
    } catch (error) {
      console.error("Error fetching tickets:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  
  app.get(
    "/api/tickets/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const userId = (req as any).user.id;
        const userType = (req as any).user.role;

        const ticket = await db.query.supportTickets.findFirst({
          where: eq(supportTickets.id, id),
        });

        if (!ticket) {
          return res.status(404).json({ error: "Ticket not found" });
        }

        if (userType !== 'admin' && userType !== 'superadmin' && ticket.creatorId !== userId) {
          return res.status(403).json({ error: 'Access denied' });
        }

        let freshEmail = ticket.creatorEmail;
        let freshName = ticket.creatorName;

        if (ticket.creatorId) {
          const creatorUser = await db.query.users.findFirst({
            where: eq(users.id, ticket.creatorId),
            columns: { email: true, username: true },
          });
          if (creatorUser) {
            freshEmail = creatorUser.email || ticket.creatorEmail;
            freshName = creatorUser.username || ticket.creatorName;
          }
        }

        const ticketWithFreshData = {
          ...ticket,
          creatorEmail: freshEmail,
          creatorName: freshName,
        };

        const messages = await db.query.ticketMessages.findMany({
          where: eq(ticketMessages.ticketId, id),
          orderBy: [asc(ticketMessages.createdAt)],
        });

        const filteredMessages = messages.filter((msg: any) => {
          if (!msg.isInternal) return true;
          if (userType === "superadmin" && msg.senderType === "superadmin") return true;
          if (userType === "admin" && msg.senderType === "admin") return true;
          return false;
        });

        res.json({
          ticket: ticketWithFreshData,
          messages: filteredMessages,
        });
      } catch (error) {
        console.error("Error fetching ticket:", error);
        res.status(500).json({ error: "Failed to fetch ticket" });
      }
    }
  );

  
  app.post("/api/tickets", requireAuth, async (req: Request, res: Response) => {
    try {
      const { title, description, priority = "medium" } = req.body;
      const user = (req as any).user;

      if (!title || !description) {
        return res
          .status(400)
          .json({ error: "Title and description are required" });
      }

      

      const [newTicket] = await db
        .insert(supportTickets)
        .values({
          title,
          description,
          priority,
          creatorId: user.id,
          creatorType: user.role,
          creatorName: user.name || user.username,
          creatorEmail: user.email,
        })
        .returning();

      res.status(201).json(newTicket);
    } catch (error) {
      console.error("Error creating ticket:", error);
      res.status(500).json({ error: "Failed to create ticket" });
    }
  });

  
  app.put(
    "/api/tickets/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { status, priority, assignedToId, assignedToName } = req.body;

        const updateData: any = { updatedAt: new Date() };

        if (status) {
          updateData.status = status;
          if (status === "resolved") {
            updateData.resolvedAt = new Date();
          } else if (status === "closed") {
            updateData.closedAt = new Date();
          }
        }

        if (priority) updateData.priority = priority;

        if (assignedToId !== undefined) {
          updateData.assignedToId = assignedToId || null;
          updateData.assignedToName = assignedToName || null;
        }

        const [updatedTicket] = await db
          .update(supportTickets)
          .set(updateData)
          .where(eq(supportTickets.id, id))
          .returning();

        if (!updatedTicket) {
          return res.status(404).json({ error: "Ticket not found" });
        }

        res.json(updatedTicket);
      } catch (error) {
        console.error("Error updating ticket:", error);
        res.status(500).json({ error: "Failed to update ticket" });
      }
    }
  );

  
  app.post(
    "/api/tickets/:id/messages",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { message, isInternal = false } = req.body;
        const user = (req as any).user;

        if (!message || message.trim().length === 0) {
          return res.status(400).json({ error: "Message is required" });
        }

        
        const ticket = await db.query.supportTickets.findFirst({
          where: eq(supportTickets.id, id),
        });

        if (!ticket) {
          return res.status(404).json({ error: "Ticket not found" });
        }

        if (user.role !== "admin" && user.role !== "superadmin" && ticket.creatorId !== user.id) {
          return res.status(403).json({ error: "Access denied" });
        }

        const messageIsInternal = (user.role === "admin" || user.role === "superadmin") && isInternal;

        const [newMessage] = await db
          .insert(ticketMessages)
          .values({
            ticketId: id,
            senderId: user.id,
            senderType: user.role,
            senderName: user.name || user.username,
            message: message.trim(),
            isInternal: messageIsInternal,
          })
          .returning();

        await db
          .update(supportTickets)
          .set({ updatedAt: new Date() })
          .where(eq(supportTickets.id, id));

        if (!messageIsInternal && (user.role === "superadmin" || user.role === "admin") && ticket.creatorId && ticket.creatorId !== user.id) {
          try {
            const messagePreview = message.trim().length > 100 ? message.trim().substring(0, 100) + "..." : message.trim();
            await triggerNotification(
              NOTIFICATION_EVENTS.TICKET_REPLY,
              {
                ticketTitle: ticket.title,
                replierName: user.name || user.username || "Support",
                messagePreview,
                ticketUrl: "/support",
                companyName: "Support Team",
              },
              [ticket.creatorId]
            );
          } catch (notifErr) {
            console.error("[Ticket] Failed to send reply notification:", notifErr);
          }
        }

        res.status(201).json(newMessage);
      } catch (error) {
        console.error("Error adding message:", error);
        res.status(500).json({ error: "Failed to add message" });
      }
    }
  );

  
  app.delete(
    "/api/tickets/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        const deleted = await db
          .delete(supportTickets)
          .where(eq(supportTickets.id, id))
          .returning();

        if (deleted.length === 0) {
          return res.status(404).json({ error: "Ticket not found" });
        }

        res.json({ message: "Ticket deleted successfully" });
      } catch (error) {
        console.error("Error deleting ticket:", error);
        res.status(500).json({ error: "Failed to delete ticket" });
      }
    }
  );

  
  app.get(
    "/api/tickets/admin/stats",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const statusStats = await db
          .select({
            status: supportTickets.status,
            count: sql<number>`count(*)`,
          })
          .from(supportTickets)
          .groupBy(supportTickets.status);

        const priorityStats = await db
          .select({
            priority: supportTickets.priority,
            count: sql<number>`count(*)`,
          })
          .from(supportTickets)
          .groupBy(supportTickets.priority);

        const typeStats = await db
          .select({
            creatorType: supportTickets.creatorType,
            count: sql<number>`count(*)`,
          })
          .from(supportTickets)
          .groupBy(supportTickets.creatorType);

        res.json({
          byStatus: statusStats,
          byPriority: priorityStats,
          byCreatorType: typeStats,
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch statistics" });
      }
    }
  );
}
