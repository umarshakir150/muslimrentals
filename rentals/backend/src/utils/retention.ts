// messageSnapshot retention policy (founder-approved, 2026-09-02, see
// ai/decisions.md and the Privacy Policy's "Retention and deletion"
// section): a MESSAGE report's frozen message content is retained while
// the report is open; once the report reaches RESOLVED or DISMISSED, the
// snapshot is retained for a further SNAPSHOT_RETENTION_DAYS before being
// cleared -- unless retentionHold pauses the clock for an active
// investigation, dispute, or legal-preservation need.
//
// This is the eligibility check only. Automated scheduling was explicitly
// deferred by the founder ("staged for later while volume is low") -- see
// scripts/redactExpiredMessageSnapshots.ts for the on-demand job that uses
// this function, intended to be run manually (or wired to a scheduler
// later) rather than on a live cron today.

export const SNAPSHOT_RETENTION_DAYS = 90;

export interface RetentionCheckReport {
  status: string;
  resolvedAt: Date | null;
  retentionHold: boolean;
  snapshotRedactedAt: Date | null;
  messageSnapshot: string | null;
}

const TERMINAL_STATUSES = new Set(['RESOLVED', 'DISMISSED']);

export function isSnapshotEligibleForRedaction(report: RetentionCheckReport, now: Date = new Date()): boolean {
  if (!report.messageSnapshot) return false;
  if (report.snapshotRedactedAt) return false;
  if (report.retentionHold) return false;
  if (!TERMINAL_STATUSES.has(report.status)) return false;
  if (!report.resolvedAt) return false;

  const daysSinceResolved = (now.getTime() - report.resolvedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceResolved >= SNAPSHOT_RETENTION_DAYS;
}
