import { requireAuth, requireRole } from "server/middlewares/auth.middleware";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import type { Express } from "express";
import {
  adminCreateNotification,
  adminGetNotifications,
  adminSendNotification,
  userGetNotifications,
  userMarkAsRead,
  userUnreadCount,
  userMarkAllRead,
  getNotificationTemplates,
  updateNotificationTemplate,
  getUserPreferences,
  updateUserPreference,
  deleteNotification,
} from "../controllers/notification.controller";

export function registerNotificationsRoutes(app: Express) {
  app.post("/api/notifications", requireAuth, adminCreateNotification);

  
  app.post("/api/notifications/:id/send", requireAuth, adminSendNotification);

  
  app.get("/api/notifications/", requireAuth,  adminGetNotifications);

  
  app.get("/api/notifications/users/", requireAuth,  userGetNotifications);

  
  app.post("/api/notifications/:id/read", requireAuth, userMarkAsRead);
 
  
  app.post("/api/notifications/mark-all", requireAuth, userMarkAllRead);

  
  app.get("/api/notifications/unread-count", requireAuth, userUnreadCount);

  app.get("/api/notification-templates", requireAuth, getNotificationTemplates);
  app.put("/api/notification-templates/:id", requireAuth, requireRole("superadmin"), updateNotificationTemplate);

  
  app.get("/api/notification-preferences", requireAuth, getUserPreferences);
  app.put("/api/notification-preferences", requireAuth, updateUserPreference);

  
  app.delete("/api/notifications/:id", requireAuth, deleteNotification);
  
}
