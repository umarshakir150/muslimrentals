/**
 * Environment variable validation
 * OWASP A05 – Security Misconfiguration
 *
 * Called once at startup. Throws immediately if any required secret is missing
 * or obviously insecure (e.g. placeholder value), so the server never starts
 * in a silently broken or insecure state.
 */
import { logger } from './logger';

interface EnvCheck {
  key: string;
  /** If true, the value must also not match any of the known placeholder strings */
  requiresStrong?: boolean;
  minLength?: number;
}

const REQUIRED: EnvCheck[] = [
  // Secrets — must be present and not use default/placeholder values in production
  { key: 'JWT_SECRET',          requiresStrong: true, minLength: 32 },
  { key: 'JWT_REFRESH_SECRET',  requiresStrong: true, minLength: 32 },
  { key: 'DATABASE_URL' },
  { key: 'FRONTEND_URL' },
];

// Placeholders that developers sometimes accidentally leave in .env
const PLACEHOLDER_PATTERNS = [
  'your_',
  'changeme',
  'change_this',
  'replace_me',
  'example',
  'secret_key',
  'XXXXXXXXX',
];

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

export function validateEnv(): void {
  const errors: string[] = [];

  for (const check of REQUIRED) {
    const value = process.env[check.key];

    if (!value) {
      errors.push(`Missing required env variable: ${check.key}`);
      continue;
    }

    if (check.minLength && value.length < check.minLength) {
      errors.push(`Env variable ${check.key} must be at least ${check.minLength} characters long.`);
    }

    if (check.requiresStrong && process.env.NODE_ENV === 'production' && isPlaceholder(value)) {
      errors.push(`Env variable ${check.key} appears to use a placeholder value. Set a real secret before deploying to production.`);
    }
  }

  // Warn (don't fail) about optional-but-recommended variables
  const RECOMMENDED = ['AWS_S3_BUCKET', 'RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'COOKIE_SECRET', 'ALLOWED_ORIGINS'];
  for (const key of RECOMMENDED) {
    if (!process.env[key]) {
      logger.warn(`Optional env variable ${key} is not set. Some features may be disabled.`);
    }
  }

  if (errors.length > 0) {
    for (const err of errors) logger.error(`[ENV] ${err}`);
    // Hard-fail in production; warn in development so local setup stays easy
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Server startup aborted: ${errors.length} environment variable error(s). See logs above.`);
    } else {
      logger.warn('[ENV] The errors above would prevent startup in production.');
    }
  }
}
