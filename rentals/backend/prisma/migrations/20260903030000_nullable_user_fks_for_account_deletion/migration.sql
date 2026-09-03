-- DropForeignKey
-- Listing.userId, Message.senderId, and Report.reporterId all currently
-- CASCADE on User delete, which -- now that permanent ADMIN account
-- deletion (a real DELETE FROM "User", not the existing self-service
-- DELETE /users/me, which anonymizes in place) is being introduced -- would
-- silently destroy data that has nothing to do with the deleted account:
-- another user's message history in a shared conversation, a report filed
-- against a still-active third party, and the listing record itself. Each
-- becomes nullable + SET NULL instead, mirroring the pattern already used
-- by Report.listingId/reportedUserId/messageId. No existing row's meaning
-- changes -- every current row keeps its non-null value; only a future
-- account deletion will ever actually null one of these out.
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_userId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderId_fkey";
ALTER TABLE "Report" DROP CONSTRAINT "Report_reporterId_fkey";

-- AlterTable
ALTER TABLE "Listing" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "senderId" DROP NOT NULL;
ALTER TABLE "Report" ALTER COLUMN "reporterId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
