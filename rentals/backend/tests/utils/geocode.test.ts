import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocodeAddress } from '../../src/utils/geocode';

const originalFetch = globalThis.fetch;

function mockFetchOnce(impl: () => Promise<Partial<Response>> | Partial<Response>) {
  globalThis.fetch = vi.fn(async () => impl() as Response) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('geocodeAddress', () => {
  it('resolves lat/lng from the first Nominatim result', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => [{ lat: '43.6532', lon: '-79.3832' }],
    }));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON');
    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
  });

  it('sends a real identifying User-Agent header (Nominatim usage-policy requirement)', async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedHeaders = (init as RequestInit)?.headers;
      return { ok: true, status: 200, json: async () => [{ lat: '43.6', lon: '-79.4' }] } as Response;
    }) as unknown as typeof fetch;

    await geocodeAddress('1 Yonge Street', 'Toronto', 'ON');

    expect((capturedHeaders as Record<string, string>)['User-Agent']).toMatch(/MuslimRentals/i);
  });

  it('never includes a unit/apartment number in the geocoding query -- only address/city/province/country', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [{ lat: '43.6', lon: '-79.4' }] } as Response;
    }) as unknown as typeof fetch;

    // geocodeAddress's signature itself has no unit parameter -- this proves
    // the call site can't accidentally leak one into the query even if it tried.
    await geocodeAddress('123 Main Street', 'Toronto', 'ON');

    expect(new URL(capturedUrl).searchParams.get('q')).toContain('123 Main Street');
    expect(capturedUrl).not.toContain('Unit');
  });

  it('returns null when no results are found for the address', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => [] }));

    const result = await geocodeAddress('Nonexistent Fake Street 99999', 'Nowhere', 'ON');
    expect(result).toBeNull();
  });

  it('returns null when the geocoding API responds with a non-OK status', async () => {
    mockFetchOnce(() => ({ ok: false, status: 503, json: async () => [] }));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON');
    expect(result).toBeNull();
  });

  it('returns null when the network request itself fails', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network error'); }) as unknown as typeof fetch;

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON');
    expect(result).toBeNull();
  });

  it('returns null when the response is not valid JSON', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON');
    expect(result).toBeNull();
  });

  it('returns null when the top result has a non-numeric coordinate', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => [{ lat: 'not-a-number', lon: '-79.4' }] }));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON');
    expect(result).toBeNull();
  });

  it('works without a province (optional)', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => [{ lat: '43.6', lon: '-79.4' }] }));

    const result = await geocodeAddress('123 Main Street', 'Toronto');
    expect(result).toEqual({ lat: 43.6, lng: -79.4 });
  });
});

// The listing address pipeline's precision gate -- POST/PATCH /listings pass
// { requirePreciseMatch: true } (see routes/listings.ts); the renter-facing
// free-text location search (routes/geocode.ts) never does, and is fully
// covered by the tests above with the option omitted (defaulting to false),
// which must keep behaving exactly as before.
describe('geocodeAddress with { requirePreciseMatch: true }', () => {
  function preciseResult(overrides: Record<string, any> = {}) {
    return { lat: '43.6532', lon: '-79.3832', address: { house_number: '123', road: 'Main Street' }, ...overrides };
  }

  it('accepts a result whose address breakdown includes a house_number', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => [preciseResult()] }));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
  });

  it('rejects (returns null) a result with no house_number -- a street/area-level match, not the actual address', async () => {
    mockFetchOnce(() => ({
      ok: true, status: 200,
      // Nominatim resolved *a* result -- just not down to a specific
      // building. This is exactly the "silently produces a different
      // location" case the precision gate exists to catch.
      json: async () => [{ lat: '43.6532', lon: '-79.3832', address: { road: 'Main Street' } }],
    }));

    const result = await geocodeAddress('99999 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('rejects (returns null) a result with no address breakdown at all', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => [{ lat: '43.6532', lon: '-79.3832' }] }));

    const result = await geocodeAddress('Somewhere vague', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('does NOT apply the house_number gate when requirePreciseMatch is left off (default false) -- the renter free-text search path', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => [{ lat: '43.6532', lon: '-79.3832' }] }));

    // Same coarse, house_number-less result as the rejection test above,
    // but WITHOUT the option -- must resolve normally, exactly as
    // GET /geocode (routes/geocode.ts) relies on for area-level searches.
    const result = await geocodeAddress('Scarborough', '');
    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
  });

  it('builds a STRUCTURED query (street/city/state/country) instead of one free-text string', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [preciseResult()] } as Response;
    }) as unknown as typeof fetch;

    await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    const params = new URL(capturedUrl).searchParams;
    expect(params.get('street')).toBe('123 Main Street');
    expect(params.get('city')).toBe('Toronto');
    expect(params.get('country')).toBe('Canada');
    expect(params.get('addressdetails')).toBe('1');
    expect(params.has('q')).toBe(false); // structured mode, not a joined free-text string
  });

  it('converts a 2-letter province code to its full name for the structured "state" field (Nominatim matches full names more reliably)', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [preciseResult()] } as Response;
    }) as unknown as typeof fetch;

    await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(new URL(capturedUrl).searchParams.get('state')).toBe('Ontario');
  });

  it('still works without a province in structured mode (state simply omitted)', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [preciseResult()] } as Response;
    }) as unknown as typeof fetch;

    const result = await geocodeAddress('123 Main Street', 'Toronto', undefined, { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
    expect(new URL(capturedUrl).searchParams.has('state')).toBe(false);
  });
});
