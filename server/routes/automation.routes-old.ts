import { storage } from "../storage";
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { z } from "zod";
import { insertAutomationSchema, insertAutomationNodeSchema } from "@shared/schema";
import { AutomationRepository } from "../repositories/automation.repository";
import type { Express } from "express";
import { requireAuth } from "../middlewares/auth.middleware";

const automationRepo = new AutomationRepository();

const automationWithNodesSchema = z.object({
  automation: insertAutomationSchema,
  nodes: z.array(insertAutomationNodeSchema)
});

export function registerAutomationRoutes(app: Express) {

app.get("/api/automations", requireAuth, async (req, res) => {
  try {
    const activeChannel = await storage.getActiveChannel();
    if (!activeChannel) {
      return res.status(400).json({ error: "No active channel selected" });
    }

    const automations = await storage.getAutomationsByChannel(activeChannel.id);
    res.json(automations);
  } catch (error) {
    console.error("Error fetching automations:", error);
    res.status(500).json({ error: "Failed to fetch automations" });
  }
});

app.get("/api/automations/:id", requireAuth, async (req, res) => {
  try {
    const automation = await storage.getAutomation(req.params.id);
    if (!automation) {
      return res.status(404).json({ error: "Automation not found" });
    }

    const nodes = await automationRepo.findNodesByAutomation(automation.id);
    res.json({ automation, nodes });
  } catch (error) {
    console.error("Error fetching automation:", error);
    res.status(500).json({ error: "Failed to fetch automation" });
  }
});

app.post("/api/automations", requireAuth, async (req, res) => {
  try {
    const activeChannel = await storage.getActiveChannel();
    if (!activeChannel) {
      return res.status(400).json({ error: "No active channel selected" });
    }
console.log('Request body:', req.body); 
    const parsed = automationWithNodesSchema.parse(req.body);
    
    
    const automation = await storage.createAutomation({
      ...parsed.automation,
      channelId: activeChannel.id,
      createdBy: req.user?.id
    });

    
    const nodesWithAutomationId = parsed.nodes.map(node => ({
      ...node,
      automationId: automation.id
    }));
    const nodes = await automationRepo.createNodes(nodesWithAutomationId);

    res.status(201).json({ automation, nodes });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    console.error("Error creating automation:", error);
    res.status(500).json({ error: "Failed to create automation" });
  }
});

app.put("/api/automations/:id", requireAuth, async (req, res) => {
  try {
    const parsed = automationWithNodesSchema.parse(req.body);
    
    
    const automation = await storage.updateAutomation(req.params.id, parsed.automation);
    if (!automation) {
      return res.status(404).json({ error: "Automation not found" });
    }

    
    await automationRepo.deleteNodesByAutomation(automation.id);
    
    
    const nodesWithAutomationId = parsed.nodes.map(node => ({
      ...node,
      automationId: automation.id
    }));
    const nodes = await automationRepo.createNodes(nodesWithAutomationId);

    res.json({ automation, nodes });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    console.error("Error updating automation:", error);
    res.status(500).json({ error: "Failed to update automation" });
  }
});

app.patch("/api/automations/:id/toggle", requireAuth, async (req, res) => {
  try {
    const automation = await storage.getAutomation(req.params.id);
    if (!automation) {
      return res.status(404).json({ error: "Automation not found" });
    }

    const newStatus = automation.status === 'active' ? 'inactive' : 'active';
    const updated = await storage.updateAutomation(req.params.id, { status: newStatus });

    res.json(updated);
  } catch (error) {
    console.error("Error toggling automation:", error);
    res.status(500).json({ error: "Failed to toggle automation" });
  }
});

app.delete("/api/automations/:id", requireAuth, async (req, res) => {
  try {
    const deleted = await storage.deleteAutomation(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Automation not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting automation:", error);
    res.status(500).json({ error: "Failed to delete automation" });
  }
});

app.get("/api/automations/:id/executions", requireAuth, async (req, res) => {
  try {
    const executions = await automationRepo.findExecutionsByAutomation(req.params.id);
    res.json(executions);
  } catch (error) {
    console.error("Error fetching executions:", error);
    res.status(500).json({ error: "Failed to fetch executions" });
  }
});

app.get("/api/execution/:id/logs", requireAuth, async (req, res) => {
  try {
    const logs = await automationRepo.findExecutionLogs(req.params.id);
    res.json(logs);
  } catch (error) {
    console.error("Error fetching execution logs:", error);
    res.status(500).json({ error: "Failed to fetch execution logs" });
  }
});

}
