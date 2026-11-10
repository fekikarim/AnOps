/**
 * Shared application error model. Services throw AppError; transport layers
 * (server actions, route handlers) convert it into a safe, typed result.
 * Internal details are never copied into the public message.
 */

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NO_COMPANY"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "INSUFFICIENT_STOCK"
  | "RATE_LIMITED"
  | "TRANSACTIONS_UNAVAILABLE"
  | "PROVIDER_NOT_CONFIGURED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NO_COMPANY: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  INSUFFICIENT_STOCK: 409,
  RATE_LIMITED: 429,
  TRANSACTIONS_UNAVAILABLE: 503,
  PROVIDER_NOT_CONFIGURED: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string>;

  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export type ActionError = {
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: Record<string, string>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
