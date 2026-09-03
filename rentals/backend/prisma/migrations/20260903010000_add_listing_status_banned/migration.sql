-- AlterEnum
-- Additive only: adds one new value to the existing ListingStatus enum.
-- No existing row uses it, no existing value is changed or removed, and
-- Postgres enum additions cannot be rolled back within the same
-- transaction, so this is intentionally its own standalone statement.
ALTER TYPE "ListingStatus" ADD VALUE 'BANNED';
