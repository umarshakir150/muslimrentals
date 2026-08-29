/**
 * Centralised error handler
 * OWASP A09 – Security Logging and Monitoring Failures
 *
 * Rules:
 *  - Never leak stack traces or internal error details to the client in production.
 *  - Always log the full error server-side for incident response.
 *  - Map well-known error types to appropriate HTTP status codes.
 *  - Return consistent { success, message } JSON bodies.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // AWS SDK v3 errors carry their own diagnostic shape ($metadata, a Code /
  // name identifying the specific failure e.g. InvalidAccessKeyId,
  // AccessDenied, NoSuchBucket) that is distinct from -- and more useful
  // than -- err.message alone for telling apart credential, permission,
  // endpoint, and bucket-config failures. None of this is secret (it never
  // includes the credential values themselves), so it's safe to log even
  // in production, where the *client* still only ever sees the generic
  // message below.
  const awsMeta = (err as any).$metadata
    ? {
        awsErrorName: err.name,
        awsErrorCode: (err as any).Code,
        awsHttpStatus: (err as any).$metadata?.httpStatusCode,
        awsRequestId: (err as any).$metadata?.requestId,
      }
    : undefined;

  // Always log with context for security monitoring
  logger.error({
    message: err.message,
    path: req.path,
    method: req.method,
    ip: req.ip,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    ...awsMeta,
  });

  // ── Prisma known errors ────────────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'A record with this value already exists.' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }
    // Do NOT expose the raw Prisma error code to clients in production
    return res.status(400).json({ success: false, message: 'Database operation failed.' });
  }

  // ── Zod validation errors ─────────────────────────────────────────────────
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  // ── Operational errors (AppError) ─────────────────────────────────────────
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }

  // ── JWT errors ────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired.' });
  }

  // ── Multer errors ─────────────────────────────────────────────────────────
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, message: err.message });
  }

  // ── Unknown / unhandled ───────────────────────────────────────────────────
  const status = res.statusCode !== 200 ? res.statusCode : 500;
  return res.status(status).json({
    success: false,
    // Never expose internal details in production
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred. Please try again.'
      : err.message,
  });
}
