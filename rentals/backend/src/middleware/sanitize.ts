/**
 * Input sanitization middleware
 * OWASP A03 – Injection / A07 – XSS
 *
 * Applied globally in index.ts before any route handlers.
 *
 * Responsibilities:
 *   1. Strip HTML/script tags from all string values in req.body, req.query,
 *      and req.params to prevent stored/reflected XSS.
 *   2. Prevent HTTP Parameter Pollution (hpp) — only the last value of a
 *      duplicate query parameter is kept.
 *   3. Trim leading/trailing whitespace from all string inputs so validation
 *      length limits are meaningful.
 *
 * Note: Zod schemas on each route still enforce type, length, and format
 * constraints. This layer is a defence-in-depth pre-filter only.
 */
import { Request, Response, NextFunction } from 'express';

// Lightweight HTML tag stripper — avoids a heavy dependency.
// Removes <script>, <iframe>, event-handler attributes, and all other tags.
function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // onclick="...", onerror='...' etc.
    .replace(/on\w+\s*=\s*[^\s>]*/gi, '')         // unquoted event handlers
    .replace(/<[^>]+>/g, '');                       // remaining tags
}

function sanitizeValue(val: unknown): unknown {
  if (typeof val === 'string') return stripHtml(val.trim());
  if (Array.isArray(val))       return val.map(sanitizeValue);
  if (val !== null && typeof val === 'object') return sanitizeObject(val as Record<string, unknown>);
  return val;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    // OWASP: reject keys that look like prototype-pollution attempts
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = sanitizeValue(obj[key]);
  }
  return out;
}

/**
 * Sanitize req.body, req.query, and req.params.
 * Safe to apply before JSON body parsing because express.json() runs first.
 */
export function sanitizeInputs(req: Request, _res: Response, next: NextFunction): void {
  if (req.body   && typeof req.body   === 'object') req.body   = sanitizeObject(req.body);
  if (req.query  && typeof req.query  === 'object') req.query  = sanitizeObject(req.query) as typeof req.query;
  if (req.params && typeof req.params === 'object') req.params = sanitizeObject(req.params) as typeof req.params;
  next();
}

/**
 * Prevent HTTP Parameter Pollution.
 * If a query parameter appears multiple times, keep only the last value.
 * e.g. ?sort=asc&sort=desc → sort = 'desc'
 */
export function preventHpp(req: Request, _res: Response, next: NextFunction): void {
  for (const key of Object.keys(req.query)) {
    if (Array.isArray(req.query[key])) {
      const arr = req.query[key] as string[];
      req.query[key] = arr[arr.length - 1];
    }
  }
  next();
}
