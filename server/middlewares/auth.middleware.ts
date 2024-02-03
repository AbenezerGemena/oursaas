import { Request, Response, NextFunction } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { Permission } from "@shared/schema";
import { storage } from '../storage';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email: string;
        firstName: string;
        lastName?: string;
        role: string;
        permissions: Permission[];
        avatar?: string;
      };
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).session?.user;

  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  req.user = user;
  next();
};

export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
};

export const requirePermission = (...permissions: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (user.role === "admin" || user.role === "user" || user.role === "superadmin") {
      return next();
    }

    try {
      const getUserPermissions = await storage.getPermissions(user.id);

      const userPermissions = (getUserPermissions ?? []).reduce(
        (acc, perm) => {
          acc[perm] = true;
          return acc;
        },
        {} as Record<string, boolean>
      );

      const hasPermission = permissions.some(
        (perm) => userPermissions[perm]
      );

      if (!hasPermission) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      next();
    } catch (error) {
      console.error("Error checking permissions:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
};

export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).session?.user;
  if (user) {
    req.user = user;
  }
  next();
};
