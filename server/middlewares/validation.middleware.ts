import type { Request, Response, NextFunction } from 'express';
import { oursaasLogger, HTTP_STATUS, OURSAAS_BRAND } from "@oursaas/core";
import { z } from 'zod';
import { AppError } from './error.middleware';

export function validateRequest(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(400, `Validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw error;
    }
  };
}

export function validateQuery(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(400, `Query validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw error;
    }
  };
}

export function validateParams(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(400, `Params validation error: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw error;
    }
  };
}
