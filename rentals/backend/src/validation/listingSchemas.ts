import { z } from 'zod';
import { ListingAudience } from '@prisma/client';

// Allowed amenity values (whitelist prevents injection via amenity names)
export const ALLOWED_AMENITIES = [
  'Furnished', 'Parking', 'Utilities included', 'Laundry in-unit', 'Laundry shared',
  'Internet included', 'Air conditioning', 'Dishwasher', 'Pet-friendly',
  'Private entrance', 'Basement unit', 'Balcony', 'Backyard access',
] as const;

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
  neighbourhood: z.string().max(100).trim().optional(),
  address:       z.string().max(200).trim().optional(),
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
  contactInfo:   z.string().min(5).max(300).trim(),
  // Amenities must be from the allowed set only
  amenities:     z.array(z.enum(ALLOWED_AMENITIES)).max(20).optional(),
  // Image URLs must be real URLs and are bounded
  imageUrls:     z.array(z.string().url().max(2048)).max(10).optional(),
}).strict();

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
