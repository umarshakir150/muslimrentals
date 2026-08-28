-- Change Conversation.listingId from a required, Cascade-on-delete
-- relation to a nullable, SetNull-on-delete relation, mirroring the
-- existing Report.listingId pattern.
--
-- Why: the new owner-initiated permanent-delete feature
-- (DELETE /listings/:id/permanent) lets a listing's owner hard-delete it.
-- Under the previous Cascade behavior, that single-sided action silently
-- and irreversibly destroyed the *other* conversation participant's
-- message history too -- someone with no say in the listing's deletion
-- losing their own data as a side effect. Found in security review before
-- this feature shipped (see ai/decisions.md). SetNull instead detaches
-- the conversation from the (now-gone) listing while preserving the
-- conversation and every message in it, exactly like Report already does.
--
-- Safe/reversible: existing rows keep their current listingId value
-- (nothing is nulled by this migration itself) -- only the *future*
-- delete behavior and the nullability of the column change.

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_listingId_fkey";

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "listingId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
