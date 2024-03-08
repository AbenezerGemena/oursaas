import { requireAuth, requireRole } from "server/middlewares/auth.middleware";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import {
  getActiveSubscriptionByUserId,
  getAllSubscriptions,
  getSubscriptionById,
  getSubscriptionsByUserId,
  createSubscription,
  AssignSubscription,
  updateSubscription,
  cancelSubscription,
  renewSubscription,
  toggleAutoRenew,
  checkExpiredSubscriptions,
} from "../controllers/subscriptions.controller";
import type { Express } from "express";

export function registerSubscriptionsRoutes(app: Express) {
  app.get("/api/subscriptions", requireAuth, requireRole("superadmin"), getAllSubscriptions);

  app.get("/api/admin/subscriptions/:id", requireAuth, requireRole("superadmin"), getSubscriptionById);

  app.get("/api/subscriptions/user/:userId", requireAuth, getSubscriptionsByUserId);

  app.get("/api/subscriptions/active/:userId", requireAuth, getActiveSubscriptionByUserId);

  app.post("/api/subscriptions", requireAuth, createSubscription);

  app.post("/api/assignSubscription", requireAuth, requireRole("superadmin"), AssignSubscription);

  app.put("/api/admin/subscriptions/:id", requireAuth, requireRole("superadmin"), updateSubscription);

  app.delete("/api/subscriptions/:id", requireAuth, cancelSubscription);

  app.put("/api/subscriptions/renew/:id", requireAuth, renewSubscription);

  app.put("/api/subscriptions/toggle-autorenew/:id", requireAuth, toggleAutoRenew);

  app.put("/api/admin/subscriptions/expire", requireAuth, requireRole("superadmin"), checkExpiredSubscriptions);
}
