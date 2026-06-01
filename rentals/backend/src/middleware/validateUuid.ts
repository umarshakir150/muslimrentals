/**
 * UUID route-parameter validator
 * OWASP A03 – Injection
 *
 * Rejects requests where a :id route param is not a valid UUID v4 before the
 * query even reaches Prisma. Prevents injection via crafted IDs like
 * "' OR 1=1 --" and keeps error messages consistent.
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateUuidParam(paramName = 'id') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    if (value && !UUID_REGEX.test(value)) {
      return next(new AppError(`Invalid ${paramName} format.`, 400));
    }
    next();
  };
}
