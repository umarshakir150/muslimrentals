import { describe, expect, it } from 'vitest';
import { bedroomsSchema, bathroomsSchema } from './listingValidation';

describe('bedroomsSchema', () => {
  it('accepts 0 (studio)', () => {
    expect(bedroomsSchema.safeParse(0).success).toBe(true);
  });

  it('accepts a typical value', () => {
    expect(bedroomsSchema.safeParse(3).success).toBe(true);
  });

  it('accepts the max allowed value', () => {
    expect(bedroomsSchema.safeParse(20).success).toBe(true);
  });

  it('rejects negative values', () => {
    const result = bedroomsSchema.safeParse(-1);
    expect(result.success).toBe(false);
  });

  it('rejects absurdly large values', () => {
    const result = bedroomsSchema.safeParse(500);
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(bedroomsSchema.safeParse('abc').success).toBe(false);
  });
});

describe('bathroomsSchema', () => {
  it('accepts 0', () => {
    expect(bathroomsSchema.safeParse(0).success).toBe(true);
  });

  it('accepts a typical whole number', () => {
    expect(bathroomsSchema.safeParse(2).success).toBe(true);
  });

  it('accepts the max allowed value', () => {
    expect(bathroomsSchema.safeParse(20).success).toBe(true);
  });

  it('rejects negative values', () => {
    expect(bathroomsSchema.safeParse(-1).success).toBe(false);
  });

  it('rejects absurdly large values', () => {
    expect(bathroomsSchema.safeParse(500).success).toBe(false);
  });

  it('rejects fractional values (Int column)', () => {
    expect(bathroomsSchema.safeParse(1.5).success).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(bathroomsSchema.safeParse('abc').success).toBe(false);
  });
});
