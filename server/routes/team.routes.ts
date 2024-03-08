import { Router } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { db } from "../db";
import {
  users,
  userActivityLogs,
  conversationAssignments,
  channels,
  DEFAULT_PERMISSIONS,
  Permission,
} from "@shared/schema";
import { eq, desc, and, sql, ne, or, ilike } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { validateRequest } from "../middlewares/validateRequest.middleware";
import { requireAuth, requirePermission } from "../middlewares/auth.middleware";
import { PERMISSIONS } from "@shared/schema";

const router = Router();

async function verifyMemberOwnership(reqUser: any, memberId: string) {
  if (reqUser.role === "superadmin") return { authorized: true, member: null };
  const [member] = await db.select().from(users).where(eq(users.id, memberId));
  if (!member) return { authorized: false, member: null, error: "Team member not found", status: 404 };
  const ownerId = reqUser.role === "team" ? reqUser.createdBy : reqUser.id;
  if (member.createdBy !== ownerId && member.id !== ownerId) {
    return { authorized: false, member, error: "Not authorized to access this member", status: 403 };
  }
  return { authorized: true, member };
}

const PERMISSION_KEY_MAP: Record<string, string[]> = {
  canManageContacts: [
    "contacts:view",
    "contacts:create",
    "contacts:edit",
    "contacts:import",
    "contacts:export",
  ],
  canManageCampaigns: [
    "campaigns:view",
    "campaigns:create",
    "campaigns:edit",
    "campaigns:send",
    "campaigns:schedule",
  ],
  canManageTemplates: [
    "templates:view",
    "templates:create",
    "templates:edit",
    "templates:sync",
  ],
  canManageTeam: ["team:view", "team:create", "team:edit", "team:delete"],
  canViewAnalytics: ["analytics:view", "analytics:export"],
  canExportData: ["dashboard:export", "contacts:export", "analytics:export"],
};

const createUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  role: z.enum(["team"]),
  channelId: z.string().optional(),
  permissions: z
    .union([z.array(z.string()), z.record(z.boolean())])
    .optional()
    .transform((val) => {
      if (Array.isArray(val)) {
        return val;
      }
      if (val && typeof val === "object") {
        return Object.keys(val).reduce((acc: string[], key) => {
          if (val[key] && PERMISSION_KEY_MAP[key]) {
            acc.push(...PERMISSION_KEY_MAP[key]);
          }
          return acc;
        }, []);
      }
      return [];
    }),
  avatar: z.string().optional(),
});

const updateUserSchema = createUserSchema.partial().omit({ password: true });

const updatePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

const updateStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

router.get(
  "/members",
  requireAuth,
  requirePermission(PERMISSIONS.TEAM_VIEW),
  async (req, res) => {
    try {
      const loggedInUser = req.user;

      if (!loggedInUser?.id) {
        return res.status(401).json({ error: "Unauthorized: User not found" });
      }

      const ownerUserId =
        loggedInUser.role === "team"
          ? loggedInUser.createdBy
          : loggedInUser.id;

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;

      const search = (req.query.search as string) || "";

      
      const searchFilter = search
        ? or(
            ilike(users.firstName, `%${search}%`),
            ilike(users.lastName, `%${search}%`),
            ilike(users.username, `%${search}%`),
            ilike(users.email, `%${search}%`)
          )
        : undefined;

      const channelId = req.query.channelId as string | undefined;

      const ownerFilter = loggedInUser.role === "superadmin"
        ? undefined
        : or(eq(users.id, ownerUserId!), eq(users.createdBy, ownerUserId!));

      const channelFilter = channelId ? eq(users.channelId, channelId) : undefined;

      const members = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
          status: users.status,
          permissions: users.permissions,
          avatar: users.avatar,
          lastLogin: users.lastLogin,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          createdBy: users.createdBy,
          channelId: users.channelId,
        })
        .from(users)
        .where(
          and(ownerFilter, channelFilter, searchFilter ?? undefined)
        )
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      const countResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(users)
        .where(
          and(ownerFilter, channelFilter, searchFilter ?? undefined)
        );

      const total = countResult[0]?.count ?? 0;

      res.json({
        data: members,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error("Error fetching team members:", error);
      res.status(500).json({ error: "Failed to fetch team members" });
    }
  }
);

router.post("/membersByUserId", requireAuth, requirePermission(PERMISSIONS.TEAM_VIEW), async (req, res) => {
  try {
    const { userId, page = 1, limit = 10 } = req.body;
    const loggedInUser = req.user as any;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: User not found" });
    }

    if (loggedInUser.role !== "superadmin") {
      const ownerId = loggedInUser.role === "team" ? loggedInUser.createdBy : loggedInUser.id;
      if (userId !== ownerId) {
        return res.status(403).json({ error: "Not authorized to view these members" });
      }
    }

    
    const offset = (page - 1) * limit;

    
    const totalCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.createdBy, userId))
      .execute();

    const total = totalCountResult[0]?.count || 0;
    const totalPages = Math.ceil(total / limit);

    
    const members = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        status: users.status,
        permissions: users.permissions,
        avatar: users.avatar,
        lastLogin: users.lastLogin,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        createdBy: users.createdBy,
      })
      .from(users)
      .where(eq(users.createdBy, userId))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      data: members,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching team members:", error);
    res.status(500).json({ error: "Failed to fetch team members" });
  }
});

router.get("/members/:id", requireAuth,
  requirePermission(PERMISSIONS.TEAM_VIEW), async (req, res) => {
  try {
    const check = await verifyMemberOwnership(req.user, req.params.id);
    if (!check.authorized) {
      return res.status(check.status || 403).json({ error: check.error });
    }

    const [member] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!member) {
      return res.status(404).json({ error: "Team member not found" });
    }

    const { password, ...memberData } = member;
    res.json(memberData);
  } catch (error) {
    console.error("Error fetching team member:", error);
    res.status(500).json({ error: "Failed to fetch team member" });
  }
});

router.post("/members",requireAuth,
requirePermission(PERMISSIONS.TEAM_CREATE), validateRequest(createUserSchema), async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      firstName,
      lastName,
      role,
      permissions,
      avatar,
      channelId,
    } = req.body;

    if (channelId) {
      const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
      if (!channel) {
        return res.status(404).json({ error: "Channel not found" });
      }
      const loggedInUser = req.user as any;
      if (loggedInUser.role !== "superadmin") {
        const ownerId = loggedInUser.role === "team" ? loggedInUser.createdBy : loggedInUser.id;
        if (channel.createdBy !== ownerId) {
          return res.status(403).json({ error: "Not authorized for this channel" });
        }
      }
    }

    const [existingUser] = await db
      .select()
      .from(users)
      .where(sql`${users.email} = ${email} OR ${users.username} = ${username}`);

    if (existingUser) {
      return res.status(400).json({ error: "Username or email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [newUser] = await db
      .insert(users)
      .values({
        username,
        password: hashedPassword,
        email,
        firstName,
        lastName,
        role:'team',
        permissions,
        avatar: avatar || null,
        status: "active",
        isEmailVerified: true,
        createdBy: (req.user as { id: string }).id,
        channelId: channelId || null,
      })
      .returning();

    await db.insert(userActivityLogs).values({
      userId: newUser.id,
      action: "user_created",
      entityType: "user",
      entityId: newUser.id,
      details: { createdBy: "admin" },
    });

    const { password: _, ...userData } = newUser;
    res.json(userData);
  } catch (error) {
    console.error("Error creating team member:", error);
    res.status(500).json({ error: error || "Failed to create team member" });
  }
});

router.put(
  "/members/:id",
  requireAuth,
  requirePermission(PERMISSIONS.TEAM_EDIT),
  validateRequest(updateUserSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { channelId, ...otherUpdates } = req.body;
      const loggedInUser = req.user as any;

      const [existingMember] = await db.select().from(users).where(eq(users.id, id));
      if (!existingMember) {
        return res.status(404).json({ error: "Team member not found" });
      }

      if (loggedInUser.role !== "superadmin") {
        const ownerId = loggedInUser.role === "team" ? loggedInUser.createdBy : loggedInUser.id;
        if (existingMember.createdBy !== ownerId) {
          return res.status(403).json({ error: "Not authorized to update this member" });
        }
      }

      if (channelId) {
        const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
        if (!channel) {
          return res.status(404).json({ error: "Channel not found" });
        }
        if (loggedInUser.role !== "superadmin") {
          const ownerId = loggedInUser.role === "team" ? loggedInUser.createdBy : loggedInUser.id;
          if (channel.createdBy !== ownerId) {
            return res.status(403).json({ error: "Not authorized for this channel" });
          }
        }
      }

      const [member] = await db
        .update(users)
        .set({
          ...otherUpdates,
          ...(channelId !== undefined ? { channelId: channelId || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      await db.insert(userActivityLogs).values({
        userId: id,
        action: "user_updated",
        entityType: "user",
        entityId: id,
        details: { updates: { ...otherUpdates, channelId } },
      });

      const { password, ...memberData } = member;
      res.json(memberData);
    } catch (error) {
      console.error("Error updating team member:", error);
      res.status(500).json({ error: "Failed to update team member" });
    }
  }
);

router.patch(
  "/members/:id/status",
  requireAuth,
  requirePermission(PERMISSIONS.TEAM_EDIT),
  validateRequest(updateStatusSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const check = await verifyMemberOwnership(req.user, id);
      if (!check.authorized) {
        return res.status(check.status || 403).json({ error: check.error });
      }

      const [member] = await db
        .update(users)
        .set({ status, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();

      if (!member) {
        return res.status(404).json({ error: "Team member not found" });
      }

      await db.insert(userActivityLogs).values({
        userId: id,
        action: "status_changed",
        entityType: "user",
        entityId: id,
        details: { newStatus: status },
      });

      const { password, ...memberData } = member;
      res.json(memberData);
    } catch (error) {
      console.error("Error updating team member status:", error);
      res.status(500).json({ error: "Failed to update status" });
    }
  }
);

router.patch(
  "/members/:id/password",
  requireAuth,
  validateRequest(updatePasswordSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const loggedInUser = req.user as any;

      if (loggedInUser.id !== id) {
        const check = await verifyMemberOwnership(req.user, id);
        if (!check.authorized) {
          return res.status(check.status || 403).json({ error: check.error });
        }
      }

      const { currentPassword, newPassword } = req.body;

      const [user] = await db.select().from(users).where(eq(users.id, id));
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await db
        .update(users)
        .set({ password: hashedPassword, updatedAt: new Date() })
        .where(eq(users.id, id));

      await db.insert(userActivityLogs).values({
        userId: id,
        action: "password_changed",
        entityType: "user",
        entityId: id,
        details: {},
      });

      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Error updating password:", error);
      res.status(500).json({ error: "Failed to update password" });
    }
  }
);

router.delete("/members/:id", requireAuth, requirePermission(PERMISSIONS.TEAM_DELETE), async (req, res) => {
  try {
    const { id } = req.params;

    const check = await verifyMemberOwnership(req.user, id);
    if (!check.authorized) {
      return res.status(check.status || 403).json({ error: check.error });
    }

    const [adminCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, "admin"), ne(users.id, id)));

    const [userToDelete] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id));

    if (userToDelete?.role === "admin" && adminCount.count === 0) {
      return res.status(400).json({ error: "Cannot delete the last admin user" });
    }

    const [hasAssignments] = await db
      .select({ count: sql<number>`count(*)` })
      .from(conversationAssignments)
      .where(
        and(
          eq(conversationAssignments.userId, id),
          eq(conversationAssignments.status, "active")
        )
      );

    if (hasAssignments && hasAssignments.count > 0) {
      return res.status(400).json({
        error: "Cannot delete user with active conversation assignments",
      });
    }

    const [deletedUser] = await db
      .delete(users)
      .where(eq(users.id, id))
      .returning();

    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

router.get("/activity-logs", async (req, res) => {
  try {
    const loggedInUserId = req?.session?.user?.id;
    const role = req?.session?.user?.role;   

    if (!loggedInUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    
    let query = db
      .select({
        id: userActivityLogs.id,
        userId: userActivityLogs.userId,
        userName: users.username,
        userEmail: users.email,
        action: userActivityLogs.action,
        entityType: userActivityLogs.entityType,
        entityId: userActivityLogs.entityId,
        details: userActivityLogs.details,
        ipAddress: userActivityLogs.ipAddress,
        userAgent: userActivityLogs.userAgent,
        createdAt: userActivityLogs.createdAt,
      })
      .from(userActivityLogs)
      .leftJoin(users, eq(userActivityLogs.userId, users.id))
      .orderBy(desc(userActivityLogs.createdAt))
      .limit(100);

    
    if (role !== "superadmin") {
      query = query.where(eq(users.createdBy, loggedInUserId));
    }

    const logs = await query;

    res.json(logs);
  } catch (error) {
    console.error("Error fetching activity logs:", error);
    res.status(500).json({ error: "Failed to fetch activity logs" });
  }
});

router.patch("/members/:id/permissions",requireAuth,
requirePermission(PERMISSIONS.TEAM_PERMISSIONS), async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    const [member] = await db
      .update(users)
      .set({
        permissions,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    if (!member) {
      return res.status(404).json({ error: "User not found" });
    }

    
    await db.insert(userActivityLogs).values({
      userId: id,
      action: "permissions_updated",
      entityType: "user",
      entityId: id,
      details: { permissions },
    });

    
    const { password, ...memberData } = member;
    res.json(memberData);
  } catch (error) {
    console.error("Error updating permissions:", error);
    res.status(500).json({ error: "Failed to update permissions" });
  }
});

export default router;
