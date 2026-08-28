/**
 * Listing request-validation schemas, extracted from routes/listings.ts so
 * they can be unit-tested without booting Prisma/rate limiters.
 * .strict() rejects any extra fields not listed — prevents mass-assignment attacks.
 */
import { z } from 'zod';
import { ListingAudience } from '@prisma/client';

// Allowed amenity values (whitelist prevents injection via amenity names)
export const ALLOWED_AMENITIES = [
  'Furnished', 'Parking', 'Utilities included', 'Laundry in-unit', 'Laundry shared',
  'Internet included', 'Air conditioning', 'Dishwasher', 'Pet-friendly',
  'Private entrance', 'Basement unit', 'Balcony', 'Backyard access',
] as const;

// `neighbourhood` is required on NEW listings (the Listing.neighbourhood DB
// column itself stays nullable -- pre-existing production rows already have
// it null and there is no real data to backfill them with, so a hard
// NOT NULL migration would either crash on those rows or require fabricating
// data; enforcing "required" at this API layer instead affects only new
// writes, matching this codebase's usual DB-nullable/API-required pattern).
// This is safe to make unconditional (not per-city) because every city in
// prisma/seed.ts's CANADIAN_CITIES now has at least one seeded
// src/data/neighbourhoods.ts entry to select -- see that file's coverage
// comment. If a new city is ever added to CANADIAN_CITIES without a
// matching neighbourhood, posting from that city would hit a dead end;
// keep the two lists in sync.
export const listingCreateSchema = z.object({
  title:         z.string().min(5).max(200).trim(),
  description:   z.string().min(20).max(5000).trim(),
  price:         z.number().positive().max(50000),
  bedrooms:      z.number().min(0).max(20),
  bathrooms:     z.number().int().min(0).max(20),
  audience:      z.nativeEnum(ListingAudience),
  city:          z.string().min(1).max(100).trim(),
  town:          z.string().max(100).trim().optional(),
  province:      z.string().max(50).trim().optional(),
  // .trim() before .min(1) (not after) so a whitespace-only value is
  // actually rejected rather than passing the length check pre-trim and
  // silently becoming "" -- required must mean required.
  neighbourhood: z.string().trim().min(1).max(100),
  address:       z.string().max(200).trim().optional(),
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
  contactInfo:   z.string().min(5).max(300).trim(),
  // Amenities must be from the allowed set only
  amenities:     z.array(z.enum(ALLOWED_AMENITIES)).max(20).optional(),
  // Image URLs must be real URLs and are bounded
  imageUrls:     z.array(z.string().url().max(2048)).max(10).optional(),
}).strict();

// Updates may omit neighbourhood (partial edit of an existing listing that
// predates this requirement); PATCH does not re-require it.
export const listingUpdateSchema = listingCreateSchema.partial();

// Query param schema for GET /listings — typed, bounded, no injection surface
export const listingQuerySchema = z.object({
  city:      z.string().max(100).trim().optional(),
  audience:  z.nativeEnum(ListingAudience).optional(),
  minBeds:   z.coerce.number().min(0).max(20).optional(),
  maxBeds:   z.coerce.number().min(0).max(20).optional(),
  minBaths:  z.coerce.number().min(0).max(20).optional(),
  maxBaths:  z.coerce.number().min(0).max(20).optional(),
  minPrice:  z.coerce.number().min(0).max(50000).optional(),
  maxPrice:  z.coerce.number().min(0).max(50000).optional(),
  lat:       z.coerce.number().min(-90).max(90).optional(),
  lng:       z.coerce.number().min(-180).max(180).optional(),
  radiusKm:  z.coerce.number().min(1).max(500).optional(),
  page:      z.coerce.number().int().min(1).max(1000).default(1),
  // Capped at 200, not 50 -- the map view (frontend src/app/map/page.tsx)
  // legitimately requests limit=200 to plot every active listing at once.
  limit:     z.coerce.number().int().min(1).max(200).default(20),
  sort:      z.enum(['newest', 'priceLow', 'priceHigh', 'beds']).default('newest'),
  keyword:   z.string().max(200).trim().optional(),
  amenities: z.string().max(500).optional(),  // comma-separated
  furnished: z.enum(['true', 'false']).optional(),
  parking:   z.enum(['true', 'false']).optional(),
  utilities: z.enum(['true', 'false']).optional(),
});

export const reportSchema = z.object({
  reason:      z.string().min(5).max(300).trim(),
  description: z.string().max(1000).trim().optional(),
}).strict();

// Pure so filter correctness (min/max gte/lte on bedrooms Float / bathrooms Int)
// can be unit-tested without a live database.
export function applyRangeFilters(
  where: Record<string, any>,
  q: Pick<
    z.infer<typeof listingQuerySchema>,
    'minBeds' | 'maxBeds' | 'minBaths' | 'maxBaths' | 'minPrice' | 'maxPrice'
  >,
): Record<string, any> {
  const next = { ...where };
  if (q.minBeds  != null) next.bedrooms  = { ...next.bedrooms,  gte: q.minBeds  };
  if (q.maxBeds  != null) next.bedrooms  = { ...next.bedrooms,  lte: q.maxBeds  };
  if (q.minBaths != null) next.bathrooms = { ...next.bathrooms, gte: q.minBaths };
  if (q.maxBaths != null) next.bathrooms = { ...next.bathrooms, lte: q.maxBaths };
  if (q.minPrice != null) next.price     = { ...next.price,     gte: q.minPrice };
  if (q.maxPrice != null) next.price     = { ...next.price,     lte: q.maxPrice };
  return next;
}
