/**
 * Authentication & authorisation middleware
 * OWASP A01 – Broken Access Control / A07 – Identification and Authentication Failures
 *
 * authenticate    – requires a valid Bearer JWT; rejects banned/inactive accounts
 * optionalAuth    – attaches user if JWT is present and valid; continues otherwise
 * requireRole     – gate that enforces one or more UserRole values
 *
 * Security decisions:
 *  - Tokens are verified with the full JWT library (algorithm + expiry check).
 *  - Every request re-reads the user from the DB to catch bans that happened
 *    after the token was issued.
 *  - Authorization header is the only accepted token carrier (no query params).
 */
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../prisma/client';
import { AppError } from './errorHandler';
import { UserRole } from '@prisma/client';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    name: string;
  };
}

export async function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    // OWASP: only accept the standard Bearer scheme — reject anything else
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Authentication required.', 401);
    }

    const token = authHeader.split(' ')[1];

    // Throws JsonWebTokenError / TokenExpiredError on invalid/expired tokens
    const payload = verifyAccessToken(token);

    // Re-query the DB so revocations (bans) take effect immediately
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, name: true, isActive: true, isBanned: true },
    });

    if (!user || !user.isActive) {
      throw new AppError('Account not found or inactive.', 401, 'ACCOUNT_INACTIVE');
    }
    if (user.isBanned) {
      throw new AppError('Your account has been suspended. Contact support@muslimrentals.ca', 403, 'ACCOUNT_SUSPENDED');
    }

    req.user = { id: user.id, email: user.email, role: user.role, name: user.name };
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, name: true, isActive: true, isBanned: true },
    });

    if (user && user.isActive && !user.isBanned) {
      req.user = { id: user.id, email: user.email, role: user.role, name: user.name };
    }
    next();
  } catch {
    // Invalid token on optional routes → just proceed unauthenticated
    next();
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required.', 401));
    if (!roles.includes(req.user.role)) return next(new AppError('Insufficient permissions.', 403));
    next();
  };
}
