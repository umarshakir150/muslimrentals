/**
 * Auth request-validation schemas, extracted from routes/auth.ts so they can
 * be unit-tested without booting Prisma/Google OAuth/rate limiters.
 * .strict() rejects any extra fields not listed — prevents mass-assignment attacks.
 */
import { z } from 'zod';

export const registerSchema = z.object({
  name:     z.string().min(2).max(80).trim(),
  email:    z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(8).max(128),
}).strict();

export const loginSchema = z.object({
  email:    z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(1).max(128),
}).strict();

export const googleSchema = z.object({
  credential: z.string().min(1).max(4096),
}).strict();

export const forgotSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
}).strict();

export const resetSchema = z.object({
  token:    z.string().length(64),   // 32 bytes = 64 hex chars
  password: z.string().min(8).max(128),
}).strict();
