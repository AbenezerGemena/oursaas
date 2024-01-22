import { HTTP_STATUS } from "./constants";

export class OurSaasError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: string;

  constructor(
    statusCode: number,
    message: string,
    isOperational = true,
    code = "OURSAAS_ERROR"
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    Object.setPrototypeOf(this, OurSaasError.prototype);
  }
}

export class BadRequestError extends OurSaasError {
  constructor(message = "Bad request") {
    super(HTTP_STATUS.BAD_REQUEST, message, true, "BAD_REQUEST");
  }
}

export class UnauthorizedError extends OurSaasError {
  constructor(message = "Unauthorized") {
    super(HTTP_STATUS.UNAUTHORIZED, message, true, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends OurSaasError {
  constructor(message = "Forbidden") {
    super(HTTP_STATUS.FORBIDDEN, message, true, "FORBIDDEN");
  }
}

export class NotFoundError extends OurSaasError {
  constructor(message = "Resource not found") {
    super(HTTP_STATUS.NOT_FOUND, message, true, "NOT_FOUND");
  }
}

export class ConflictError extends OurSaasError {
  constructor(message = "Resource conflict") {
    super(HTTP_STATUS.CONFLICT, message, true, "CONFLICT");
  }
}

export class ValidationError extends OurSaasError {
  public readonly errors: Record<string, string[]>;

  constructor(message = "Validation failed", errors: Record<string, string[]> = {}) {
    super(HTTP_STATUS.UNPROCESSABLE, message, true, "VALIDATION_ERROR");
    this.errors = errors;
  }
}

export class RateLimitError extends OurSaasError {
  constructor(message = "Too many requests") {
    super(HTTP_STATUS.TOO_MANY_REQUESTS, message, true, "RATE_LIMIT");
  }
}

export class InternalError extends OurSaasError {
  constructor(message = "Internal server error") {
    super(HTTP_STATUS.INTERNAL_ERROR, message, false, "INTERNAL_ERROR");
  }
}
