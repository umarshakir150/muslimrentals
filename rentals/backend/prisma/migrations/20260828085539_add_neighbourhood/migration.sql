-- Additive-only migration: new reference table, no existing table/column
-- touched. Curated neighbourhood/district coordinates per city (mirrors
-- the City table's read-only reference-data pattern) used to resolve a
-- listing's coordinates more precisely than the city's single center point.
-- Listing.neighbourhood itself is intentionally left nullable at the DB
-- level (existing production rows already have it null); "required" is
-- enforced at the API/Zod layer for new listings only -- see
-- src/validation/listingSchemas.ts.

-- CreateTable
CREATE TABLE "Neighbourhood" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Neighbourhood_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Neighbourhood_city_province_idx" ON "Neighbourhood"("city", "province");

-- CreateIndex
CREATE UNIQUE INDEX "Neighbourhood_city_province_name_key" ON "Neighbourhood"("city", "province", "name");

-- Bring the new table under the same least-privilege RLS posture as every
-- other table (see 20260828011000_enable_rls_least_privilege) -- the
-- Express backend's `postgres` role has BYPASSRLS=true and is unaffected;
-- anon/authenticated get no access, consistent with City.
ALTER TABLE public."Neighbourhood" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Neighbourhood" FROM PUBLIC, anon, authenticated;
