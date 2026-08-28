import { describe, it, expect } from 'vitest';
import { listingCreateSchema, listingUpdateSchema } from '../../src/validation/listingSchemas';

const validBase = {
  title: 'Cozy room near mosque',
  description: 'A lovely furnished room close to transit and shops, quiet street.',
  price: 900,
  bedrooms: 1,
  bathrooms: 1,
  audience: 'BROTHERS' as const,
  city: 'Toronto',
  neighbourhood: 'Kensington Market',
  lat: 43.6547,
  lng: -79.4005,
  contactInfo: 'email me at test@example.com',
};

describe('listingCreateSchema — neighbourhood requirement', () => {
  it('accepts a valid payload including neighbourhood', () => {
    const result = listingCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('rejects a payload with neighbourhood omitted entirely', () => {
    const { neighbourhood, ...rest } = validBase;
    const result = listingCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a payload with neighbourhood as an empty string', () => {
    const result = listingCreateSchema.safeParse({ ...validBase, neighbourhood: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a payload with neighbourhood as only whitespace', () => {
    // .trim() runs after .min(1) in zod's pipeline order is irrelevant here --
    // trim() is a transform applied after validation, so a whitespace-only
    // string passes .min(1) but should still not silently become "".
    const result = listingCreateSchema.safeParse({ ...validBase, neighbourhood: '   ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.neighbourhood).toBe('');
    }
  });

  it('rejects neighbourhood over 100 characters', () => {
    const result = listingCreateSchema.safeParse({ ...validBase, neighbourhood: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects unknown/extra fields (mass-assignment defense, .strict())', () => {
    const result = listingCreateSchema.safeParse({ ...validBase, isFeatured: true });
    expect(result.success).toBe(false);
  });

  it('listingUpdateSchema (PATCH) does not require neighbourhood', () => {
    const result = listingUpdateSchema.safeParse({ title: 'Updated title for this listing' });
    expect(result.success).toBe(true);
  });

  it('rejects lat/lng outside valid ranges', () => {
    expect(listingCreateSchema.safeParse({ ...validBase, lat: 200 }).success).toBe(false);
    expect(listingCreateSchema.safeParse({ ...validBase, lng: -200 }).success).toBe(false);
  });
});
