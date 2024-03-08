import { z } from "zod";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import type { Express } from "express";

import { insertAutomationSchema, insertAutomationNodeSchema } from "@shared/schema";
import { requireAuth } from "../middlewares/auth.middleware";
import { extractChannelId } from "../middlewares/channel.middleware";

import {
  getAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  toggleAutomation,
  saveAutomationNodes,
  saveAutomationEdges,
  startAutomationExecution,
  logAutomationNodeExecution,
  testAutomation,
  getExecutionStatus,
  getAutomationExecutions,
  triggerNewConversation,
  triggerMessageReceived,
  seedAutomationTemplates
} from "../controllers/automation.controller";
import { cleanupExpiredExecutions, getAllPendingExecutions } from "server/controllers/webhooks.controller";
import { handleDigitalOceanUpload, upload } from "server/middlewares/upload.middleware";
import { requireSubscription } from "server/middlewares/requireSubscription";

const automationWithNodesSchema = z.object({
  automation: insertAutomationSchema,
  nodes: z.array(insertAutomationNodeSchema),
});

export function registerAutomationRoutes(app: Express) {
  
  
  

  
  app.get(
    "/api/automations",
    requireAuth,
    extractChannelId,
    getAutomations
  );

  
  app.get(
    "/api/automations/:id",
    requireAuth,
    extractChannelId,
    getAutomation
  );

  
  app.post(
    "/api/automations",
    requireAuth,
    extractChannelId,
    
    upload.any(),
    handleDigitalOceanUpload,
    createAutomation
  );

  
  app.put(
    "/api/automations/:id",
    requireAuth,
    extractChannelId,
    upload.any(),
    handleDigitalOceanUpload,
    updateAutomation
  );

  
  app.delete(
    "/api/automations/:id",
    requireAuth,
    extractChannelId,
    deleteAutomation
  );

  
  app.post(
    "/api/automations/:id/toggle",
    requireAuth,
    extractChannelId,
    toggleAutomation
  );

  
  
  

  
  app.post(
    "/api/automations/:automationId/nodes",
    requireAuth,
    extractChannelId,
    saveAutomationNodes
  );

    
  app.post(
    "/api/automations/:automationId/edges",
    requireAuth,
    extractChannelId,
    saveAutomationNodes
  );

  
  
  

  
  app.post(
    "/api/automations/:automationId/executions",
    requireAuth,
    extractChannelId,
    startAutomationExecution
  );

  
  app.post(
    "/api/automations/executions/:executionId/logs",
    requireAuth,
    extractChannelId,
    logAutomationNodeExecution
  );

app.post("/api/automations/:automationId/execute", startAutomationExecution);
app.post("/api/automations/:id/test", testAutomation); 
app.get("/api/automations/:id/executions", getAutomationExecutions); 
app.get("/api/automations/executions/:executionId/status", getExecutionStatus); 

app.post("/api/automations/executions/:executionId/logs", logAutomationNodeExecution);

app.post("/api/automations/triggers/new-conversation", triggerNewConversation);
app.post("/api/automations/triggers/message-received", triggerMessageReceived);

app.get('/api/automations/pending-executions', getAllPendingExecutions);
app.post('/api/automations/cleanup-expired', cleanupExpiredExecutions);

app.post('/api/automations/seed-templates', requireAuth, seedAutomationTemplates);

}
