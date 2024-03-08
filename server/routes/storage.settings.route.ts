import express from "express";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import {
  getStorageSettings,
  getActiveStorage,
  updateStorageSetting,
  deleteStorageSetting,
  testStorageConnection,
} from "../controllers/storage.settings.controller";
import type { Express } from "express";

export function registerStorageSettingsRoutes(app: Express) {
  app.get("/api/storage-settings", getStorageSettings);
  app.get("/api/storage-settings/active", getActiveStorage);
  app.post("/api/storage-settings/update", updateStorageSetting);
  app.post("/api/storage-settings/test", testStorageConnection);
  app.delete("/api/storage-settings/:id", deleteStorageSetting);
}
