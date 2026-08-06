import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCAD(amount: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(amount);
}

export function formatShortCAD(amount: number): string {
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return `$${amount}`;
}

export function formatTimeAgo(date: string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function audienceLabel(audience: string): string {
  const map: Record<string, string> = {
    BROTHERS: 'Brothers',
    SISTERS: 'Sisters',
    COUPLES: 'Couples',
    FAMILIES: 'Families',
    ALL: 'Everyone',
  };
  return map[audience] || audience;
}

export function audienceColor(audience: string): string {
  const map: Record<string, string> = {
    BROTHERS: 'bg-blue-100 text-blue-800',
    SISTERS: 'bg-pink-100 text-pink-800',
    COUPLES: 'bg-purple-100 text-purple-800',
    FAMILIES: 'bg-amber-100 text-amber-800',
    ALL: 'bg-brand-100 text-brand-800',
  };
  return map[audience] || 'bg-gray-100 text-gray-800';
}

export function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

// ─── API error formatting ───────────────────────────────────────────────────
// Turns a thrown ApiClient error into a short, user-safe message. Never surfaces
// raw backend/HTML/stack details - falls back to a generic message instead.
export function friendlyApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!(err instanceof Error)) return fallback;

  const status = (err as any).status as number | undefined;
  const fieldErrors = (err as any).errors as { field: string; message: string }[] | undefined;

  // No status = fetch itself threw (offline, DNS failure, CORS, backend down).
  if (status == null) {
    return err.message || 'Unable to reach the server. Please check your connection and try again.';
  }

  // Zod validation errors (422) - surface the first field-level message, which
  // is already a safe, human-readable string (e.g. "Password must contain at
  // least 8 character(s)"), rather than the generic "Validation failed."
  if (status === 422 && fieldErrors?.length) {
    return fieldErrors[0].message;
  }

  if (status === 409) return err.message || 'An account with this email already exists.';
  if (status === 401) return err.message || 'Incorrect email or password.';
  if (status === 429) return err.message || 'Too many attempts. Please wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on our end. Please try again in a moment.';

  // Anything else operational (400/403/404 etc.) - the backend already sends
  // safe, user-facing text for these (see errorHandler.ts), so pass it through.
  const looksRaw = /<!DOCTYPE|<html|Unexpected token|not valid JSON/i.test(err.message);
  return looksRaw ? fallback : (err.message || fallback);
}

// Fuzzy city search
export function fuzzySearch(query: string, options: string[]): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const scored = options.map(opt => {
    const ol = opt.toLowerCase();
    if (ol === q) return { opt, score: 100 };
    if (ol.startsWith(q)) return { opt, score: 80 };
    if (ol.includes(q)) return { opt, score: 60 };

    // Levenshtein-like tolerance for typos (check trigrams)
    let match = 0;
    for (let i = 0; i <= q.length - 2; i++) {
      if (ol.includes(q.slice(i, i + 2))) match++;
    }
    const score = (match / Math.max(q.length - 1, 1)) * 50;
    return { opt, score };
  })
  .filter(x => x.score > 20)
  .sort((a, b) => b.score - a.score)
  .slice(0, 8);

  return scored.map(x => x.opt);
}
