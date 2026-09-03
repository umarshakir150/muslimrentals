-- AlterTable
-- Additive only: six new nullable columns on the existing Listing table.
-- No existing column is altered, no default changes existing rows'
-- meaning, no backfill required -- every current row simply has all six
-- as NULL, meaning "never touched by a moderator Remove/Restore action".
ALTER TABLE "Listing" ADD COLUMN     "moderationRemovedAt" TIMESTAMP(3),
ADD COLUMN     "moderationRemovedById" TEXT,
ADD COLUMN     "moderationRemovalReason" TEXT,
ADD COLUMN     "moderationRestoredAt" TIMESTAMP(3),
ADD COLUMN     "moderationRestoredById" TEXT;

-- AddForeignKey
-- SetNull, not Cascade: if the moderator who removed/restored a listing
-- later has their own account deleted, that must never take the listing
-- (or its moderation history) down with it.
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_moderationRemovedById_fkey" FOREIGN KEY ("moderationRemovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_moderationRestoredById_fkey" FOREIGN KEY ("moderationRestoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
