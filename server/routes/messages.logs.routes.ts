import type { Express } from 'express';
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { getMessageLogs, updateMessageStatus } from '../controllers/messages.logs.controller';
import { requireAuth } from '../middlewares/auth.middleware';

export function registerMessageLogsRoutes(app: Express) {
  app.get('/api/messages/logs', requireAuth, getMessageLogs);

  app.put('/api/messages/:messageId/status', requireAuth, updateMessageStatus);
}
