import type { Express } from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import * as contactsController from "../controllers/contacts.controller";
import { validateRequest } from "../middlewares/validation.middleware";
import { insertContactSchema , PERMISSIONS } from "@shared/schema";
import { extractChannelId } from "../middlewares/channel.middleware";
import { requireAuth, requirePermission } from "../middlewares/auth.middleware";
import { requireSubscription } from "server/middlewares/requireSubscription";

export function registerContactRoutes(app: Express) {
  
  app.get("/api/contacts-all", 
  requireAuth,
  requirePermission(PERMISSIONS.CONTACTS_VIEW),
    extractChannelId,
    contactsController.getContacts
  );

  app.get("/api/contacts", 
  requireAuth,
  requirePermission(PERMISSIONS.CONTACTS_VIEW),
    extractChannelId,
    contactsController.getContactsWithPagination
  );

  
  app.get("/api/contacts/:id", requireAuth,
  requirePermission(PERMISSIONS.CONTACTS_VIEW), contactsController.getContact);

  
  app.post("/api/contacts",
    extractChannelId, requireAuth,
    requirePermission(PERMISSIONS.CONTACTS_CREATE),requireSubscription('contacts'),
    validateRequest(insertContactSchema), 
    contactsController.createContact
  );

  app.get("/api/user/contacts/:userId", contactsController.getContactsByUser);

  
  app.put(
    "/api/contacts/:id",
    requireAuth,
    requirePermission(PERMISSIONS.CONTACTS_EDIT),
    contactsController.updateContact
  );

  
  app.delete(
    "/api/contacts/:id",
    requireAuth,
    requirePermission(PERMISSIONS.CONTACTS_DELETE),
    contactsController.deleteContact
  );

  
  app.delete(
    "/api/contacts-bulk",
    requireAuth,
    requirePermission(PERMISSIONS.CONTACTS_DELETE),
    contactsController.deleteBulkContacts
  );

  
  app.post(
    "/api/contacts/import",
    requireAuth,
    requirePermission(PERMISSIONS.CONTACTS_EXPORT), 
    extractChannelId,requireSubscription('contacts'),
    contactsController.importContacts
  );
}
