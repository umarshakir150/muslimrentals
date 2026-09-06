-- CreateEnum
-- Records which prior-interaction path (POST /users/:id/report's mandatory
-- gate) actually qualified a USER report, as evidence for moderators
-- reviewing it in GET /admin/reports (Trust & Safety design-review follow-up).
CREATE TYPE "ReportQualifyingInteraction" AS ENUM ('SHARED_CONVERSATION', 'LISTING_MESSAGED', 'LISTING_SAVED');

-- AlterTable
-- Nullable, no backfill: every pre-existing report (LISTING/MESSAGE reports,
-- and any USER reports filed before this column existed) simply has none on
-- file, which is the correct meaning for them.
ALTER TABLE "Report" ADD COLUMN "qualifyingInteraction" "ReportQualifyingInteraction";
