import { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import {
  createGroup,
  getGroups,
  getGroupById,
  updateGroup,
  deleteGroup,
  addContactsToGroup,
  removeContactsFromGroup,
  getGroupContactCount,
} from "../controllers/group.controller";
import { requireAuth } from "server/middlewares/auth.middleware";

export function registerGroupRoutes(app: Express) {
  app.post("/api/groups", requireAuth, createGroup);
  app.get("/api/groups", requireAuth, getGroups);
  app.get("/api/groups/contact-counts", requireAuth, getGroupContactCount);
  app.get("/api/groups/:id", requireAuth, getGroupById);
  app.put("/api/groups/:id", requireAuth, updateGroup);
  app.delete("/api/groups/:id", requireAuth, deleteGroup);
  app.post("/api/groups/add-contacts", requireAuth, addContactsToGroup);
  app.post("/api/groups/remove-contacts", requireAuth, removeContactsFromGroup);
}
