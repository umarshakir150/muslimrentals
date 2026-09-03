-- AlterTable
-- Adds a private unit/apartment-number column, deliberately separate from
-- `address` so the new address-geocoding flow (utils/geocode.ts) never has
-- to parse a unit out of a street address to get a usable geocoding query.
-- Nullable, no backfill needed or attempted -- every existing row simply
-- has no unit on file yet, same as `address` already does.
ALTER TABLE "Listing" ADD COLUMN "unit" TEXT;
