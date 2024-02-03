import { Request, Response } from "express";
import { OurSaasError, asyncHandler as _dHandler, oursaasLogger, HTTP_STATUS } from "@oursaas/core";
import { db } from "../db";
import {users, channels} from "@shared/schema";
import { eq, or, like, sql, and, desc, gte, inArray, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { otpVerifications } from "@shared/schema";
import { sendOTPEmailVerify } from "../services/email.service";

    const defaultPermissions = [
      
      'contacts:view',
      'contacts:create',
      'contacts:edit',
      'contacts:delete',
      'contacts:export',

      
      'campaigns:view',
      'campaigns:create',
      'campaigns:edit',
      'campaigns:delete',

      
      'templates:view',
      'templates:create',
      'templates:edit',
      'templates:delete',

      
      'analytics:view',

      
      'team:view',
      'team:create',
      'team:edit',
      'team:delete',

      
      'settings:view',

      
      'inbox:view',
      'inbox:send',
      'inbox:assign',

      
      'automations:view',
      'automations:create',
      'automations:edit',
      'automations:delete',
    ];

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const role = (req.query.role as string) || "admin";
    const status = (req.query.status as string) || "";
    const hasChannels = (req.query.hasChannels as string) || "";
    const dateRange = (req.query.dateRange as string) || "";
    const offset = (page - 1) * limit;

    const conditions: any[] = [
      eq(users.role, role),
      search ? or(
        like(users.username, sql`${'%' + search + '%'}`),
        like(users.email, sql`${'%' + search + '%'}`)
      ) : undefined,
      status ? eq(users.status, status) : undefined,
    ].filter(Boolean);

    if (dateRange === "week") {
      conditions.push(gte(users.createdAt, sql`NOW() - INTERVAL '7 days'`));
    } else if (dateRange === "month") {
      conditions.push(gte(users.createdAt, sql`NOW() - INTERVAL '30 days'`));
    }

    const channelCountSql = sql<number>`(
      SELECT COUNT(*) FROM ${channels}
      WHERE ${channels.createdBy} = ${users.id}
         OR ${channels.id} = ${users.channelId}
    )`.as("channelCount");

    if (hasChannels === "yes") {
      conditions.push(gt(sql`(
        SELECT COUNT(*) FROM ${channels}
        WHERE ${channels.createdBy} = ${users.id}
           OR ${channels.id} = ${users.channelId}
      )`, sql`0`));
    } else if (hasChannels === "no") {
      conditions.push(eq(sql`(
        SELECT COUNT(*) FROM ${channels}
        WHERE ${channels.createdBy} = ${users.id}
           OR ${channels.id} = ${users.channelId}
      )`, sql`0`));
    }

    let baseQuery = db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        avatar: users.avatar,
        status: users.status,
        permissions: users.permissions,
        channelId: users.channelId,
        lastLogin: users.lastLogin,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        createdBy: users.createdBy,
        fcmToken: users.fcmToken,
        isEmailVerified: users.isEmailVerified,
        stripeCustomerId: users.stripeCustomerId,
        razorpayCustomerId: users.razorpayCustomerId,
        channelCount: channelCountSql,
      })
      .from(users)
      .where(and(...conditions))
      .orderBy(desc(users.createdAt));

    const allUsers = await (baseQuery as any).limit(limit).offset(offset);

    const countQuery = db
      .select({ total: sql<number>`COUNT(*)` })
      .from(users)
      .where(and(...conditions));

    const totalCountResult = await countQuery;
    const total = totalCountResult[0]?.total ?? 0;

    res.status(200).json({
      success: true,
      data: allUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ success: false, message: "Error fetching users", error });
  }
};

export const exportAllUsers = async (req: Request, res: Response) => {
  try {
    const role = (req.query.role as string) || "admin";
    const search = (req.query.search as string) || "";
    const statusFilter = (req.query.status as string) || "";
    const hasChannels = (req.query.hasChannels as string) || "";
    const dateRange = (req.query.dateRange as string) || "";

    const conditions: any[] = [
      eq(users.role, role),
      search ? or(
        like(users.username, sql`${'%' + search + '%'}`),
        like(users.email, sql`${'%' + search + '%'}`)
      ) : undefined,
      statusFilter ? eq(users.status, statusFilter) : undefined,
    ].filter(Boolean);

    if (dateRange === "week") {
      conditions.push(gte(users.createdAt, sql`NOW() - INTERVAL '7 days'`));
    } else if (dateRange === "month") {
      conditions.push(gte(users.createdAt, sql`NOW() - INTERVAL '30 days'`));
    }

    const exportChannelCountSql = sql<number>`(
      SELECT COUNT(*) FROM ${channels}
      WHERE ${channels.createdBy} = ${users.id}
         OR ${channels.id} = ${users.channelId}
    )`.as("channelCount");

    const exportChannelNamesSql = sql<string>`(
      SELECT COALESCE(STRING_AGG(COALESCE(c.name, c.phone_number, 'Unknown'), ', '), '')
      FROM ${channels} c
      WHERE c.created_by = ${users.id}
         OR c.id = ${users.channelId}
    )`.as("channelNames");

    if (hasChannels === "yes") {
      conditions.push(gt(sql`(
        SELECT COUNT(*) FROM ${channels}
        WHERE ${channels.createdBy} = ${users.id}
           OR ${channels.id} = ${users.channelId}
      )`, sql`0`));
    } else if (hasChannels === "no") {
      conditions.push(eq(sql`(
        SELECT COUNT(*) FROM ${channels}
        WHERE ${channels.createdBy} = ${users.id}
           OR ${channels.id} = ${users.channelId}
      )`, sql`0`));
    }

    let query = db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        status: users.status,
        lastLogin: users.lastLogin,
        createdAt: users.createdAt,
        channelCount: exportChannelCountSql,
        channelNames: exportChannelNamesSql,
      })
      .from(users)
      .where(and(...conditions))
      .orderBy(desc(users.createdAt));

    const allUsers = await query;

    res.status(200).json({ success: true, data: allUsers });
  } catch (error) {
    console.error("Error exporting users:", error);
    res.status(500).json({ success: false, message: "Error exporting users" });
  }
};

export const bulkUpdateUserStatus = async (req: Request, res: Response) => {
  try {
    const { userIds, status } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: "userIds array is required" });
    }

    const allowed = ["active", "inactive", "banned"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${allowed.join(", ")}` });
    }

    const updated = await db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(inArray(users.id, userIds))
      .returning({ id: users.id, status: users.status });

    res.status(200).json({
      success: true,
      message: `${updated.length} user(s) updated to ${status}`,
      data: updated,
    });
  } catch (error) {
    console.error("Error bulk updating user status:", error);
    res.status(500).json({ success: false, message: "Error updating users" });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await db.select().from(users).where(eq(users.id, id));
    if (!user.length) return res.status(404).json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, data: user[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching user", error });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const { username, password, email, firstName, lastName, role, avatar } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({
        success: false,
        message: "Username, password, and email are required.",
      });
    }

    
    const existingUserByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, email));

    if (existingUserByEmail.length > 0) {
      const user = existingUserByEmail[0];

      if (!user.isEmailVerified) {
        

        
        const usernameTaken = await db
          .select()
          .from(users)
          .where(and(
            eq(users.username, username),
            sql`${users.id} != ${user.id}` 
          ));

        if (usernameTaken.length > 0) {
          return res.status(409).json({
            success: false,
            message: "Username already exists.",
          });
        }

        
        const hashedPassword = await bcrypt.hash(password, 10);

        
        await db
          .update(users)
          .set({
            username,
            password: hashedPassword,
            firstName: firstName || user.firstName,
            lastName: lastName || user.lastName,
            avatar: avatar || user.avatar,
            role: role || user.role,
          })
          .where(eq(users.id, user.id));

        
        await db.delete(otpVerifications).where(eq(otpVerifications.userId, user.id));

        
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        console.log(`Resending OTP for ${email}: ${otpCode} (expires at ${expiresAt.toISOString()})`);

        await db.insert(otpVerifications).values({
          userId: user.id,
          otpCode,
          expiresAt,
          isUsed: false,
        });

        await sendOTPEmailVerify(email, otpCode, firstName || user.firstName);

        return res.status(200).json({
          success: true, 
          message: "Email already exists but not verified. OTP resent and account updated.",
        });
      } else {
        return res.status(409).json({
          success: false,
          message: "Email already exists.",
        });
      }
    }

    
    const existingUserByUsername = await db
      .select()
      .from(users)
      .where(eq(users.username, username));

    if (existingUserByUsername.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Username already exists.",
      });
    }

    
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await db
      .insert(users)
      .values({
        username,
        password: hashedPassword,
        email,
        firstName,
        lastName,
        role: role || "admin",
        avatar,
        permissions: defaultPermissions,
        isEmailVerified: false,
      })
      .returning();

    const user = newUser[0];

    
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    console.log(`Generated OTP for ${email}: ${otpCode} (expires at ${expiresAt.toISOString()})`);

    await db.insert(otpVerifications).values({
      userId: user.id,
      otpCode,
      expiresAt,
      isUsed: false,
    });

    await sendOTPEmailVerify(email, otpCode, firstName);

    return res.status(201).json({
      success: true,
      message: "User created. Verification OTP sent to email.",
    });

  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating user. Please try again.",
    });
  }
};

export const verifyEmailOTP = async (req: Request, res: Response) => {
  try {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required.",
      });
    }

    
    const user = await db.select().from(users).where(eq(users.email, email));
    if (!user.length) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const userData = user[0];

    
    const otpRecord = await db
      .select()
      .from(otpVerifications)
      .where(eq(otpVerifications.userId, userData.id))
      .orderBy(desc(otpVerifications.createdAt))
      .limit(1);

    if (!otpRecord.length) {
      return res.status(400).json({
        success: false,
        message: "No OTP found.",
      });
    }

    const otp = otpRecord[0];

    
    if (otp.isUsed) {
      return res.status(400).json({ success: false, message: "OTP already used." });
    }

    if (otp.otpCode !== otpCode) {
      return res.status(400).json({ success: false, message: "Invalid OTP." });
    }

    if (new Date() > otp.expiresAt) {
      return res.status(400).json({ success: false, message: "OTP expired." });
    }

    
    await db
      .update(otpVerifications)
      .set({ isUsed: true })
      .where(eq(otpVerifications.id, otp.id));

    
    await db
      .update(users)
      .set({ isEmailVerified: true })
      .where(eq(users.id, userData.id));

    return res.json({
      success: true,
      message: "Email verified successfully.",
    });

  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
      error,
    });
  }
};

export const createUserOld = async (req: Request, res: Response) => {
  try {
    const { username, password, email, firstName, lastName, role, avatar, permissions } = req.body;

    
    if (!username || !password || !email) {
      return res.status(400).json({
        success: false,
        message: "Username, password, and email are required.",
      });
    }

    
    const existingUser = await db.select().from(users).where(eq(users.username, username));
    if (existingUser.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Username already exists. Please choose another one.",
      });
    }

    
    const hashedPassword = await bcrypt.hash(password, 10);

    
    const newUser = await db
      .insert(users)
      .values({
        username,
        password: hashedPassword,
        email,
        firstName,
        lastName,
        role: role || "admin",
        avatar,
        permissions: defaultPermissions,
      })
      .returning();

    return res.status(201).json({
      success: true,
      data: newUser[0],
      message: "User created successfully",
    });
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating user",
      error,
    });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const updated = await db.update(users).set(updates).where(eq(users.id, id)).returning();

    res.status(200).json({ success: true, data: updated[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating user", error });
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    
    const allowed = ["active", "inactive"];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Allowed: active, inactive",
      });
    }

    
    const updated = await db
      .update(users)
      .set({ status })
      .where(eq(users.id, id))
      .returning();

    
    if (!updated.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Status updated successfully",
      data: updated[0],
    });

  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating status",
      error,
    });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await db.delete(users).where(eq(users.id, id));
    res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting user", error });
  }
};

export const createUserSuperadmin = async (req: Request, res: Response) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({
        success: false,
        message: "Username, password, and email are required.",
      });
    }

    
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.username, username));

    if (existingUser.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Username already exists.",
      });
    }

    
    const hashedPassword = await bcrypt.hash(password, 10);

    
    const newUser = await db
      .insert(users)
      .values({
        username,
        password: hashedPassword,
        email,
        firstName,
        lastName,
        role: "admin",
        permissions: defaultPermissions,
        isEmailVerified: true,
      })
      .returning();

    const user = newUser[0];

    return res.status(201).json({
      success: true,
      message: "User created.",
      data: { id: user.id, email },
    });

  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating user",
      error,
    });
  }
};
