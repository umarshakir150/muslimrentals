/**
 * OWASP A05 – Security Misconfiguration / A04 – Insecure Design
 *
 * Tiered rate limiting strategy:
 *   • Global limiter   – applied to every request (100 req / 15 min per IP)
 *   • Auth limiter     – tight window on login/register/forgot-password (10 req / 15 min per IP)
 *   • Write limiter    – create/update/delete operations (30 req / 15 min per IP)
 *   • Upload limiter   – file upload endpoints (20 req / hour per IP)
 *   • Admin limiter    – admin panel endpoints (60 req / 15 min per IP)
 *
 * All limiters:
 *   - Use `standardHeaders: true`  → sets RateLimit-* headers per RFC 6585
 *   - Use `legacyHeaders: false`   → suppress deprecated X-RateLimit-* headers
 *   - Return consistent JSON 429 bodies matching the rest of the API
 *   - Trust the proxy chain configured in index.ts (req.ip is the real IP)
 */
import rateLimit, { Options } from 'express-rate-limit';

// ─── Shared helper ────────────────────────────────────────────────────────────
function make429(message: string): Pick<Options, 'message' | 'standardHeaders' | 'legacyHeaders' | 'statusCode'> {
  return {
    statusCode: 429,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  };
}

// ─── Global limiter (all routes) ─────────────────────────────────────────────
// Reads RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX from env so values can be
// tuned per environment without a code deploy.
export const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  max:       parseInt(process.env.RATE_LIMIT_MAX       || '100',    10),
  ...make429('Too many requests. Please slow down and try again later.'),
  skip: (req) => req.path === '/health', // health check must never be throttled
});

// ─── Auth limiter (login / register / password reset) ────────────────────────
// Tight limit prevents brute-force and credential-stuffing attacks.
// OWASP A07 – Identification and Authentication Failures
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
  ...make429('Too many authentication attempts. Please wait 15 minutes and try again.'),
});

// ─── Write limiter (POST/PATCH/DELETE on resources) ──────────────────────────
export const writeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,
  ...make429('Too many write requests. Please wait before submitting again.'),
});

// ─── Upload limiter (multipart file uploads) ─────────────────────────────────
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || '20', 10),
  ...make429('Upload limit reached. Please wait an hour before uploading more files.'),
});

// ─── Admin limiter ────────────────────────────────────────────────────────────
export const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  ...make429('Too many admin requests. Please slow down.'),
});
