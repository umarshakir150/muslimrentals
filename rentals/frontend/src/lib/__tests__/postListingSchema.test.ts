import { describe, it, expect } from 'vitest';
import { postListingSchema } from '@/lib/postListingSchema';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Bright 2BR near the mosque',
    description: 'A lovely two-bedroom apartment close to transit and shops.',
    price: 1500,
    bedrooms: 2,
    bathrooms: 1,
    audience: 'ALL',
    city: 'Toronto',
    address: '123 Main Street',
    contactInfo: 'email@example.com',
    ...overrides,
  };
}

describe('postListingSchema (client-side mirror of the backend listing-create schema)', () => {
  it('accepts a valid payload including an address', () => {
    const result = postListingSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it('rejects a payload with no address field at all', () => {
    const { address, ...rest } = validPayload();
    const result = postListingSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string address', () => {
    const result = postListingSchema.safeParse(validPayload({ address: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only address', () => {
    const result = postListingSchema.safeParse(validPayload({ address: '   ' }));
    expect(result.success).toBe(false);
  });

  it('rejects an address shorter than 3 characters', () => {
    const result = postListingSchema.safeParse(validPayload({ address: 'ab' }));
    expect(result.success).toBe(false);
  });

  it('still requires city as before', () => {
    const result = postListingSchema.safeParse(validPayload({ city: '' }));
    expect(result.success).toBe(false);
  });

  it('accepts an optional unit number', () => {
    const result = postListingSchema.safeParse(validPayload({ unit: 'Unit 4B' }));
    expect(result.success).toBe(true);
  });

  it('accepts no unit at all (optional)', () => {
    const { address, ...rest } = validPayload();
    const result = postListingSchema.safeParse({ address, ...rest });
    expect(result.success).toBe(true);
  });

  it('has no neighbourhood, lat, or lng fields any more', () => {
    expect(postListingSchema.shape).not.toHaveProperty('neighbourhood');
    expect(postListingSchema.shape).not.toHaveProperty('lat');
    expect(postListingSchema.shape).not.toHaveProperty('lng');
  });
});
