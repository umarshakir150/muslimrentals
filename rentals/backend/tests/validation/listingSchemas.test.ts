import { describe, it, expect } from 'vitest';
import { listingCreateSchema, listingQuerySchema } from '../../src/validation/listingSchemas';

const validListing = {
  title: 'Bright basement unit near mosque',
  description: 'A lovely and spacious basement unit close to the Islamic centre and transit.',
  price: 1200,
  bedrooms: 2,
  bathrooms: 1,
  audience: 'FAMILIES',
  city: 'Toronto',
  lat: 43.6532,
  lng: -79.3832,
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

  it('rejects latitude out of the -90..90 range', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, lat: 91 });
    expect(result.success).toBe(false);
  });

  it('rejects longitude out of the -180..180 range', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, lng: -181 });
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

  it('rejects a non-URL image entry', () => {
    const result = listingCreateSchema.safeParse({ ...validListing, imageUrls: ['not-a-url'] });
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
});
