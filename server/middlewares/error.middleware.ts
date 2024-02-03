import type { Request, Response, NextFunction } from 'express';
import {
  OurSaasError,
  asyncHandler as oursaasAsyncHandler,
  oursaasLogger,
  OURSAAS_HEADER_KEY,
  OURSAAS_HEADER_VALUE,
} from "@oursaas/core";

export const AppError = OurSaasError;

export function errorHandler(
  err: Error | OurSaasError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  res.setHeader(OURSAAS_HEADER_KEY, OURSAAS_HEADER_VALUE);

  if (err instanceof OurSaasError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      ...(err.code && { code: err.code }),
    });
  }

  oursaasLogger.error('Unexpected error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
}

export const asyncHandler = oursaasAsyncHandler;
