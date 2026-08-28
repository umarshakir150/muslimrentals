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
    neighbourhood: 'Kensington Market',
    contactInfo: 'email@example.com',
    lat: 43.6532,
    lng: -79.3832,
    ...overrides,
  };
}

describe('postListingSchema (client-side mirror of the backend listing-create schema)', () => {
  it('accepts a valid payload including a neighbourhood', () => {
    const result = postListingSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it('rejects a payload with no neighbourhood field at all', () => {
    const { neighbourhood, ...rest } = validPayload();
    const result = postListingSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string neighbourhood', () => {
    const result = postListingSchema.safeParse(validPayload({ neighbourhood: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only neighbourhood', () => {
    const result = postListingSchema.safeParse(validPayload({ neighbourhood: '   ' }));
    expect(result.success).toBe(false);
  });

  it('still requires city as before', () => {
    const result = postListingSchema.safeParse(validPayload({ city: '' }));
    expect(result.success).toBe(false);
  });
});
