/**
 * JWT utilities
 * OWASP A02 – Cryptographic Failures / A07 – Authentication Failures
 *
 * Security decisions:
 *  - Secrets read exclusively from environment variables — never hardcoded
 *  - Access tokens are short-lived (15 min default) to limit exposure
 *  - Refresh tokens use a separate secret so compromise of one doesn't affect the other
 *  - Algorithm is implicitly HS256 (symmetric); for higher-assurance deployments
 *    swap to RS256 with a key pair stored in a secrets manager
 *  - Payload contains only userId/email/role — no sensitive PII
 */
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  email:  string;
  role:   string;
}

type MinimalUser = { id: string; email: string; role: string };

export function signAccessToken(user: MinimalUser): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');

  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m', algorithm: 'HS256' }
  );
}

export function signRefreshToken(user: MinimalUser): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is not set');

  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    secret,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d', algorithm: 'HS256' }
  );
}

export function verifyAccessToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');

  // jwt.verify throws JsonWebTokenError or TokenExpiredError on failure —
  // the errorHandler in middleware/errorHandler.ts maps these to 401 responses.
  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is not set');

  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
}
