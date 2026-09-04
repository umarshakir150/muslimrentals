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

// ─── Location model — TRANSITIONAL dual-shape support ──────────────────────
// Two mutually exclusive request shapes are accepted right now, deliberately
// never mixed or blended:
//
//   NEW shape (the actual architecture going forward): a real `address`
//   (+ optional private `unit`). The route geocodes the address itself
//   server-side (see utils/geocode.ts) -- `lat`/`lng` are never accepted
//   from the client in this shape at all, since a landlord could otherwise
//   submit any coordinates alongside any address with nothing tying the
//   two together.
//
//   LEGACY shape (transitional ONLY): `neighbourhood` + client-supplied
//   `lat`/`lng`, the pre-existing pre-geocoding contract. This exists
//   solely because the production Netlify frontend has not yet been
//   redeployed past this point (see CLAUDE.md's standing status flag /
//   ai/current-state.md) and still submits this exact shape -- deploying
//   this backend to the shared production Render service would otherwise
//   break live listing creation. Delete this branch entirely, and the
//   Listing.neighbourhood-as-input concept along with it, once that
//   redeploy ships and every client submits the new shape.
//
// Each shape is its own `.strict()` object; listingCreateSchema is their
// union. A payload satisfying neither exactly -- most importantly one
// that mixes the two (e.g. `address` alongside `neighbourhood`/`lat`/`lng`)
// -- is rejected outright by BOTH branches' `.strict()`, never silently
// merged or partially applied.
const listingCommonFields = {
  title:       z.string().min(5).max(200).trim(),
  description: z.string().min(20).max(5000).trim(),
  price:       z.number().positive().max(50000),
  bedrooms:    z.number().min(0).max(20),
  bathrooms:   z.number().int().min(0).max(20),
  audience:    z.nativeEnum(ListingAudience),
  city:        z.string().min(1).max(100).trim(),
  town:        z.string().max(100).trim().optional(),
  province:    z.string().max(50).trim().optional(),
  contactInfo: z.string().min(5).max(300).trim(),
  // Amenities must be from the allowed set only
  amenities:   z.array(z.enum(ALLOWED_AMENITIES)).max(20).optional(),
  // Image URLs must be real URLs and are bounded
  imageUrls:   z.array(z.string().url().max(2048)).max(10).optional(),
};

export const newListingCreateSchema = z.object({
  ...listingCommonFields,
  // .trim() before .min(1) (not after) so a whitespace-only value is
  // actually rejected rather than passing the length check pre-trim and
  // silently becoming "" -- required must mean required.
  address: z.string().trim().min(3).max(200),
  unit:    z.string().trim().max(50).optional(),
}).strict();

export const legacyListingCreateSchema = z.object({
  ...listingCommonFields,
  neighbourhood: z.string().trim().min(1).max(100),
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
}).strict();

export const listingCreateSchema = z.union([newListingCreateSchema, legacyListingCreateSchema]);

// PATCH may send any subset of fields (a partial edit) in either shape
// (never mixed, same as create); the route itself decides whether an
// `address`/`city`/`province` change requires re-geocoding, since that's
// request-time behavior, not something a static schema can express.
export const listingUpdateSchema = z.union([newListingCreateSchema.partial(), legacyListingCreateSchema.partial()]);

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
  // 1-10km matches the renter-facing "search a location + radius" feature's
  // slider exactly (see LocationRadiusSearch.tsx) -- deliberately no wider,
  // now that the privacy-approximate location model (~200m jitter) makes a
  // very large radius meaningless for neighbourhood-level search anyway.
  radiusKm:  z.coerce.number().min(1).max(10).optional(),
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
