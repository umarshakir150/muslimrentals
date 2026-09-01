-- Settings feature: purely additive, nullable columns on "User" -- safe to
-- apply against a live, in-use table with no backfill and no effect on any
-- existing row or the currently-deployed (older) frontend/backend, which
-- simply never reads or writes these columns.
--
-- avatarKey: S3/R2 object key for avatarUrl, set only when the avatar was
-- uploaded through our own /uploads/avatar endpoint (never for a
-- Google-provided avatarUrl). Lets avatar removal / account deletion know
-- definitively whether, and what, to delete from R2.
--
-- pendingEmail / pendingEmailToken / pendingEmailTokenExpiry: email-change
-- verification state, deliberately separate from the existing
-- resetToken/resetTokenExpiry columns (which stay password-reset-only) so
-- one flow's token can never be used to complete the other.
ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;
ALTER TABLE "User" ADD COLUMN "pendingEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "pendingEmailToken" TEXT;
ALTER TABLE "User" ADD COLUMN "pendingEmailTokenExpiry" TIMESTAMP(3);
