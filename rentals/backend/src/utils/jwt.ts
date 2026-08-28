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
import jwt, { SignOptions } from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  email:  string;
  role:   string;
}

type MinimalUser = { id: string; email: string; role: string };

// jsonwebtoken v9's SignOptions.expiresIn rejects a bare `string` (it wants
// its own branded StringValue/number union) -- env vars are always plain
// strings, so the value needs an explicit cast to the option's own type
// rather than a functional change to what's accepted.
const ACCESS_TOKEN_EXPIRY = (process.env.JWT_EXPIRES_IN || '15m') as SignOptions['expiresIn'];
const REFRESH_TOKEN_EXPIRY = (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as SignOptions['expiresIn'];

export function signAccessToken(user: MinimalUser): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');

  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    secret,
    { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' }
  );
}

export function signRefreshToken(user: MinimalUser): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is not set');

  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    secret,
    { expiresIn: REFRESH_TOKEN_EXPIRY, algorithm: 'HS256' }
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
