-- messageSnapshot retention policy (founder-approved, 2026-09-02): purely
-- additive extension of the existing Report model. No existing column is
-- altered, nothing is made NOT NULL, no data is backfilled or destroyed.
--
-- retentionHold defaults to false so every existing row is immediately
-- eligible for the retention schedule once automated cleanup is built;
-- a moderator sets it to true to pause the clock for an active
-- investigation, dispute, or legal-preservation need.
--
-- snapshotRedactedAt is nullable and starts unset for every row -- it only
-- gets a value once a MESSAGE report's snapshot has actually been cleared
-- by the (not-yet-scheduled, run-on-demand for now) redaction script.
--
-- NOTE: hand-authored, following this repo's own established precedent
-- (see 20260901235000_add_user_message_reports/migration.sql) for writing
-- migration SQL without a live database connection in this worktree. Must
-- be confirmed with `prisma migrate diff` (or an actual `prisma migrate
-- dev`) against a real database before this branch is deployed.

-- AlterTable
ALTER TABLE "Report" ADD COLUMN "retentionHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Report" ADD COLUMN "retentionHoldReason" TEXT;
ALTER TABLE "Report" ADD COLUMN "snapshotRedactedAt" TIMESTAMP(3);
