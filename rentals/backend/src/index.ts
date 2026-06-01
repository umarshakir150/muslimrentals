/**
 * Muslim Rentals API – main server entry point
 *
 * Security layers applied (OWASP top-10 references inline):
 *  A01 Broken Access Control      → JWT auth middleware on all protected routes
 *  A02 Cryptographic Failures     → HTTPS enforced in prod via HSTS (helmet)
 *  A03 Injection                  → sanitizeInputs + Zod schemas on every route
 *  A04 Insecure Design            → tiered rate limiting per endpoint category
 *  A05 Security Misconfiguration  → helmet with strict CSP; CORS allowlist only
 *  A06 Vulnerable Components      → package.json pinned; see .env.example notes
 *  A07 Auth Failures              → bcrypt(12) + short-lived JWTs + refresh rotation
 *  A08 Software/Data Integrity    → request size limits; file-type validation on upload
 *  A09 Logging/Monitoring         → winston structured logs on every request + errors
 *  A10 SSRF                       → no server-side URL fetching from user input
 */
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { Server as SocketServer } from 'socket.io';

import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { sanitizeInputs, preventHpp } from './middleware/sanitize';
import { logger } from './utils/logger';
import { setupSocketIO } from './socket/socketServer';
import { validateEnv } from './utils/validateEnv';

// Routes
import authRoutes    from './routes/auth';
import listingRoutes from './routes/listings';
import messageRoutes from './routes/messages';
import cityRoutes    from './routes/cities';
import userRoutes    from './routes/users';
import adminRoutes   from './routes/admin';
import uploadRoutes  from './routes/uploads';

// ─── Validate required env variables at startup ───────────────────────────────
// Fails fast if critical secrets are missing, preventing silent misconfigurations.
validateEnv();

const app    = express();
const server = http.createServer(app);

// ─── Trust proxy (for real IP behind load balancers / Nginx / Railway etc.) ───
// Only enable when behind a trusted reverse proxy.
// OWASP: ensures rate limiting uses the real client IP, not the proxy IP.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new SocketServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // OWASP A08: restrict max payload size on socket messages
  maxHttpBufferSize: 1e5, // 100 kB
});
setupSocketIO(io);
app.set('io', io);

// ─── Security headers (OWASP A05) ─────────────────────────────────────────────
app.use(helmet({
  // Content-Security-Policy prevents XSS by restricting script/style sources
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],   // unsafe-inline needed for inline styles only
      imgSrc:         ["'self'", 'data:', 'https:'],
      connectSrc:     ["'self'"],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],                       // clickjacking prevention
    },
  },
  // HSTS: force HTTPS for 1 year in production
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Hide the X-Powered-By header so attackers cannot fingerprint the stack
  hidePoweredBy: true,
}));

// ─── CORS (OWASP A05) ─────────────────────────────────────────────────────────
// Only allow the configured frontend origin — never wildcard in production.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server calls (no Origin header) and configured origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin '${origin}' not allowed.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// ─── Request body limits (OWASP A08) ─────────────────────────────────────────
// 1 MB for JSON/URL-encoded bodies; multipart is handled per-route via multer.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(compression());

// ─── Global sanitization (OWASP A03) ─────────────────────────────────────────
// Strip HTML/XSS payloads from all inputs before they reach route handlers.
app.use(sanitizeInputs);
// Prevent HTTP Parameter Pollution — deduplicates repeated query params.
app.use(preventHpp);

// ─── Request logging ──────────────────────────────────────────────────────────
// In production, use 'combined' format for full NCSA log lines (useful for SIEM).
// In development, use 'dev' for coloured compact output.
app.use(morgan(
  process.env.NODE_ENV === 'production' ? 'combined' : 'dev',
  { stream: { write: (msg) => logger.info(msg.trim()) } }
));

// ─── Global rate limiter (OWASP A04) ─────────────────────────────────────────
// Catches all routes that do not have a more specific limiter.
app.use(rateLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
// Returns 200 with no sensitive data — used by load balancers.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'muslim-rentals-api' });
});

// ─── API routes ───────────────────────────────────────────────────────────────
const v1 = '/api/v1';
app.use(`${v1}/auth`,     authRoutes);
app.use(`${v1}/listings`, listingRoutes);
app.use(`${v1}/messages`, messageRoutes);
app.use(`${v1}/cities`,   cityRoutes);
app.use(`${v1}/users`,    userRoutes);
app.use(`${v1}/admin`,    adminRoutes);
app.use(`${v1}/uploads`,  uploadRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ─── Centralised error handler ────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000', 10);
server.listen(PORT, () => {
  logger.info(`🚀 Muslim Rentals API running on port ${PORT}`);
  logger.info(`🌐 Environment: ${process.env.NODE_ENV}`);
  logger.info(`🔗 Allowed origins: ${allowedOrigins.join(', ')}`);
});

export default app;
