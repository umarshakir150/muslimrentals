/**
 * Report request-validation schemas for the new user/message report targets
 * (POST /users/:id/report, POST /messages/:id/report).
 *
 * Unlike the pre-existing listing report (`reportSchema` in
 * listingSchemas.ts, free-text `reason` — left unchanged here to avoid
 * altering already-shipped behavior), these two new endpoints enforce a
 * per-targetType reason allowlist server-side via z.enum, not just in the
 * frontend's ReportModal, so the taxonomy is actually meaningful for admin
 * triage and future report-category filtering (Trust & Safety review,
 * 2026-09-01). "Scam or fraud attempt" is spelled identically across every
 * target type so a future priority-queue enhancement can filter on it
 * without a data migration.
 */
import { z } from 'zod';

export const USER_REPORT_REASONS = [
  'Harassment or abusive behavior',
  'Scam or fraud attempt',
  'Impersonation',
  'Inappropriate content',
  'Spam',
  'Other',
] as const;

export const MESSAGE_REPORT_REASONS = [
  'Harassment or abusive behavior',
  'Scam or fraud attempt',
  'Inappropriate content',
  'Spam',
  'Other',
] as const;

export const userReportSchema = z.object({
  reason:      z.enum(USER_REPORT_REASONS),
  description: z.string().max(1000).trim().optional(),
}).strict();

export const messageReportSchema = z.object({
  reason:      z.enum(MESSAGE_REPORT_REASONS),
  description: z.string().max(1000).trim().optional(),
}).strict();
