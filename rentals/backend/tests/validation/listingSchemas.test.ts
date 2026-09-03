import { describe, it, expect } from 'vitest';
import { ListingAudience } from '@prisma/client';
import {
  listingCreateSchema,
  listingUpdateSchema,
  listingQuerySchema,
  applyRangeFilters,
} from '../../src/validation/listingSchemas';

const validListing = {
  title: 'Bright basement unit near mosque',
  description: 'A lovely and spacious basement unit close to the Islamic centre and transit.',
  price: 1200,
  bedrooms: 2,
  bathrooms: 1,
  audience: 'FAMILIES',
  city: 'Toronto',
  address: '123 Main Street',
  contactInfo: 'call 555-555-5555',
};

describe('listingCreateSchema', () => {
  it('accepts a minimal valid listing', () => {
    const result = listingCreateSchema.safeParse(validListing);
    expect(result.success).toBe(true);
  });

  it('rejects a title shorter than 5 characters', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, title: 'Hi' });
    expect(result.success).toBe(false);
  });

  it('rejects a price above the 50000 cap', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, price: 50001 });
    expect(result.success).toBe(false);
  });

  it('accepts a price at exactly the 50000 cap', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, price: 50000 });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive price', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, price: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects an amenity not in the whitelist', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, amenities: ['Free WiFi and a Pool'] });
    expect(result.success).toBe(false);
  });

  it('accepts amenities from the whitelist', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, amenities: ['Furnished', 'Parking'] });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid audience enum value', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, audience: 'EVERYONE' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (mass-assignment defense)', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, status: 'ACTIVE' });
    expect(result.success).toBe(false);
  });

  // lat/lng are no longer part of this schema at all -- the route resolves
  // them itself via server-side geocoding (utils/geocode.ts) and would
  // reject them outright as unknown fields under .strict(), same as any
  // other unexpected field. A client can no longer submit a coordinate
  // detached from the address it claims to be for.
  it('rejects a client-supplied lat/lng as unknown fields', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, lat: 43.6532, lng: -79.3832 });
    expect(result.success).toBe(false);
  });

  // Likewise, neighbourhood is no longer collected at listing creation --
  // the dropdown and its centroid-based positioning were removed. The
  // Listing.neighbourhood DB column and its display uses elsewhere are
  // unaffected; it's just not part of this schema/the create flow now.
  it('rejects a client-supplied neighbourhood as an unknown field', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, neighbourhood: 'Downtown' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL image entry', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, imageUrls: ['not-a-url'] });
    expect(result.success).toBe(false);
  });
});

const baseListing = {
  title: 'Cozy room near campus',
  description: 'A lovely furnished room close to transit and the mosque.',
  price: 1200,
  bedrooms: 1,
  bathrooms: 1,
  audience: ListingAudience.BROTHERS,
  city: 'Toronto',
  address: '456 Spadina Avenue',
  contactInfo: 'email me at test@example.com',
};

describe('listingCreateSchema — bedrooms (Float, min 0, max 20)', () => {
  it('accepts 0 bedrooms (studio convention)', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bedrooms: 0 });
    expect(result.success).toBe(true);
  });

  it('accepts the upper bound (20)', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bedrooms: 20 });
    expect(result.success).toBe(true);
  });

  it('accepts a whole number in the middle of the range', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bedrooms: 4 });
    expect(result.success).toBe(true);
  });

  it('rejects negative bedrooms', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bedrooms: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects bedrooms above the 20 ceiling (e.g. 500)', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bedrooms: 500 });
    expect(result.success).toBe(false);
  });

  it('rejects bedrooms just above the ceiling (20.01)', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bedrooms: 20.01 });
    expect(result.success).toBe(false);
  });

  it('is a Float column, so the schema itself does not reject a decimal value (e.g. 2.5)', () => {
    // The Prisma column is Float and the schema places no .int() constraint on
    // bedrooms, so decimals are technically valid server-side even though the
    // product's UI restricts the input to whole numbers. This test documents
    // that contract so a future UI change doesn't accidentally assume the
    // server would reject a decimal.
    const result = listingCreateSchema.safeParse({ ...baseListing, bedrooms: 2.5 });
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric bedrooms', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bedrooms: 'two' });
    expect(result.success).toBe(false);
  });

  it('rejects missing bedrooms', () => {
    const { bedrooms, ...rest } = baseListing;
    const result = listingCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('listingCreateSchema — bathrooms (Int, min 0, max 20)', () => {
  it('accepts 0 bathrooms (matches existing backend bound, even though unrealistic)', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bathrooms: 0 });
    expect(result.success).toBe(true);
  });

  it('accepts the upper bound (20)', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bathrooms: 20 });
    expect(result.success).toBe(true);
  });

  it('rejects negative bathrooms', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bathrooms: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects bathrooms above the 20 ceiling (e.g. 500)', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bathrooms: 500 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer bathrooms (half-baths are not supported — column is Int)', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bathrooms: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric bathrooms', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, bathrooms: 'one' });
    expect(result.success).toBe(false);
  });
});

describe('listingCreateSchema — address requirement (geocoding source)', () => {
  it('accepts a valid payload including address', () => {
    const result = listingCreateSchema.safeParse(baseListing);
    expect(result.success).toBe(true);
  });

  it('rejects a payload with address omitted entirely', () => {
    const { address, ...rest } = baseListing;
    const result = listingCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a payload with address as an empty string', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, address: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a payload with address as only whitespace', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, address: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects an address shorter than 3 characters', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, address: 'ab' });
    expect(result.success).toBe(false);
  });

  it('rejects address over 200 characters', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, address: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('listingUpdateSchema (PATCH) does not require address', () => {
    const result = listingUpdateSchema.safeParse({ title: 'Updated title for this listing' });
    expect(result.success).toBe(true);
  });
});

describe('listingCreateSchema — unit (private, optional, never used for geocoding)', () => {
  it('accepts a listing with no unit at all', () => {
    const result = listingCreateSchema.safeParse(baseListing);
    expect(result.success).toBe(true);
  });

  it('accepts a listing with a unit number', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, unit: 'Unit 4B' });
    expect(result.success).toBe(true);
  });

  it('rejects a unit over 50 characters', () => {
    const result = listingCreateSchema.safeParse({ ...baseListing, unit: 'a'.repeat(51) });
    expect(result.success).toBe(false);
  });
});

describe('listingUpdateSchema (partial) — bedrooms/bathrooms bounds still enforced when present', () => {
  it('allows omitting bedrooms/bathrooms entirely on update', () => {
    const result = listingUpdateSchema.safeParse({ title: 'Updated title here' });
    expect(result.success).toBe(true);
  });

  it('still rejects an out-of-range bedrooms value when provided', () => {
    const result = listingUpdateSchema.safeParse({ bedrooms: -5 });
    expect(result.success).toBe(false);
  });

  it('still rejects a non-integer bathrooms value when provided', () => {
    const result = listingUpdateSchema.safeParse({ bathrooms: 2.5 });
    expect(result.success).toBe(false);
  });
});

describe('listingQuerySchema', () => {
  it('applies defaults for page/limit/sort when omitted', () => {
    const result = listingQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
      expect(result.data.sort).toBe('newest');
    }
  });

  it('coerces string query values into numbers', () => {
    const result = listingQuerySchema.safeParse({ minPrice: '500', maxPrice: '1500', page: '2' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minPrice).toBe(500);
      expect(result.data.maxPrice).toBe(1500);
      expect(result.data.page).toBe(2);
    }
  });

  it('rejects a limit above the 200 cap (map view boundary)', () => {
    const result = listingQuerySchema.safeParse({ limit: '201' });
    expect(result.success).toBe(false);
  });

  it('accepts a limit at exactly the 200 cap', () => {
    const result = listingQuerySchema.safeParse({ limit: '200' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid sort value', () => {
    const result = listingQuerySchema.safeParse({ sort: 'random' });
    expect(result.success).toBe(false);
  });

  it('rejects a radiusKm below the 1km minimum', () => {
    const result = listingQuerySchema.safeParse({ radiusKm: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects latitude out of the -90..90 range', () => {
    const result = listingQuerySchema.safeParse({ lat: '200' });
    expect(result.success).toBe(false);
  });

  it('rejects longitude out of the -180..180 range', () => {
    const result = listingQuerySchema.safeParse({ lng: '-200' });
    expect(result.success).toBe(false);
  });
});

describe('listingQuerySchema — minBeds/maxBeds/minBaths/maxBaths (filter contract)', () => {
  it('coerces string query values to numbers within bounds', () => {
    const result = listingQuerySchema.safeParse({ minBeds: '2', maxBeds: '4', minBaths: '1', maxBaths: '2' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minBeds).toBe(2);
      expect(result.data.maxBeds).toBe(4);
      expect(result.data.minBaths).toBe(1);
      expect(result.data.maxBaths).toBe(2);
    }
  });

  it('rejects negative filter values', () => {
    const result = listingQuerySchema.safeParse({ minBeds: '-1' });
    expect(result.success).toBe(false);
  });

  it('rejects filter values above the 20 ceiling', () => {
    const result = listingQuerySchema.safeParse({ maxBaths: '500' });
    expect(result.success).toBe(false);
  });

  it('allows all bed/bath filters to be absent (no filtering)', () => {
    const result = listingQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('applyRangeFilters — Prisma where-clause construction (filter correctness)', () => {
  it('adds no bedrooms/bathrooms/price filter when none are provided', () => {
    const where = applyRangeFilters({ status: 'ACTIVE' }, {});
    expect(where).toEqual({ status: 'ACTIVE' });
  });

  it('builds a gte filter for minBeds only', () => {
    const where = applyRangeFilters({}, { minBeds: 2 });
    expect(where.bedrooms).toEqual({ gte: 2 });
  });

  it('builds a combined gte/lte range filter for minBeds+maxBeds', () => {
    const where = applyRangeFilters({}, { minBeds: 1, maxBeds: 3 });
    expect(where.bedrooms).toEqual({ gte: 1, lte: 3 });
  });

  it('builds independent range filters for bedrooms and bathrooms simultaneously', () => {
    const where = applyRangeFilters({}, { minBeds: 2, maxBaths: 2 });
    expect(where.bedrooms).toEqual({ gte: 2 });
    expect(where.bathrooms).toEqual({ lte: 2 });
  });

  it('includes 0 as a valid bound (studio / minimum bath count), not treated as "unset"', () => {
    // Regression guard: `!= null` (not truthiness) must be used so that a
    // literal 0 filter value (e.g. "0 bedrooms / studio") is still applied.
    const where = applyRangeFilters({}, { minBeds: 0, maxBeds: 0 });
    expect(where.bedrooms).toEqual({ gte: 0, lte: 0 });
  });

  it('does not mutate the input where object', () => {
    const original = { status: 'ACTIVE' };
    applyRangeFilters(original, { minBeds: 2 });
    expect(original).toEqual({ status: 'ACTIVE' });
  });

  it('preserves unrelated existing where-clause fields', () => {
    const where = applyRangeFilters({ status: 'ACTIVE', city: { contains: 'Toronto' } }, { minBaths: 1 });
    expect(where.status).toBe('ACTIVE');
    expect(where.city).toEqual({ contains: 'Toronto' });
    expect(where.bathrooms).toEqual({ gte: 1 });
  });
});
