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
    return {
      lat: '43.6532', lon: '-79.3832',
      class: 'building', type: 'house', place_rank: 30, importance: 0.31,
      display_name: '123 Main Street, Toronto, Ontario, Canada',
      address: { house_number: '123', road: 'Main Street' },
      ...overrides,
    };
  }

  // Fetch mock that returns a DIFFERENT response per call, in order -- lets
  // a test express "the structured attempt returns X, then the free-text
  // fallback returns Y" without a shared, hard-to-follow counter variable.
  function mockFetchSequence(...responses: Array<Partial<Response>>) {
    let callCount = 0;
    const capturedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      capturedUrls.push(String(url));
      const r = responses[Math.min(callCount, responses.length - 1)];
      callCount++;
      return r as Response;
    }) as unknown as typeof fetch;
    return { capturedUrls, callCount: () => callCount };
  }

  function jsonResponse(body: unknown): Partial<Response> {
    return { ok: true, status: 200, json: async () => body };
  }

  it('accepts a result whose address breakdown includes a house_number, without needing a fallback query', async () => {
    const { callCount } = mockFetchSequence(jsonResponse([preciseResult()]));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
    expect(callCount()).toBe(1); // precise on the first (structured) try -- no fallback needed
  });

  it('accepts a legitimate building/address result that has NO house_number, based on class=building', async () => {
    const { callCount } = mockFetchSequence(jsonResponse([
      preciseResult({ address: { road: 'Main Street' } }), // class=building, but no house_number field
    ]));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
    expect(callCount()).toBe(1);
  });

  it('accepts a legitimate address/POI result with no house_number and class != building, based on a high place_rank alone', async () => {
    const { callCount } = mockFetchSequence(jsonResponse([
      preciseResult({ class: 'amenity', type: 'restaurant', place_rank: 30, address: { road: 'Main Street' } }),
    ]));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
    expect(callCount()).toBe(1);
  });

  it('rejects a street-only broad match (class=highway, place_rank below the precision threshold), even though Nominatim returned a result', async () => {
    const { callCount } = mockFetchSequence(
      jsonResponse([{ lat: '43.6532', lon: '-79.3832', class: 'highway', type: 'residential', place_rank: 26, importance: 0.2, display_name: 'Main Street, Toronto, Ontario, Canada' }]),
      jsonResponse([]), // free-text fallback also finds nothing precise
    );

    const result = await geocodeAddress('99999 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toBeNull();
    expect(callCount()).toBe(2); // structured rejected -> free-text fallback attempted -> also rejected
  });

  it('rejects a city/place-level match (class=place, low place_rank)', async () => {
    const { callCount } = mockFetchSequence(
      jsonResponse([{ lat: '43.6532', lon: '-79.3832', class: 'place', type: 'city', place_rank: 16, importance: 0.9, display_name: 'Toronto, Ontario, Canada' }]),
      jsonResponse([]),
    );

    const result = await geocodeAddress('Nonexistent Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toBeNull();
    expect(callCount()).toBe(2);
  });

  it('rejects a neighbourhood/suburb-level match (class=place, mid place_rank)', async () => {
    mockFetchSequence(
      jsonResponse([{ lat: '43.6547', lon: '-79.4005', class: 'place', type: 'neighbourhood', place_rank: 22, importance: 0.4, display_name: 'Kensington Market, Toronto, Ontario, Canada' }]),
      jsonResponse([]),
    );

    const result = await geocodeAddress('Some Vague Street', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('rejects a province/state-level match (class=boundary, very low place_rank)', async () => {
    mockFetchSequence(
      jsonResponse([{ lat: '51.2538', lon: '-85.3232', class: 'boundary', type: 'administrative', place_rank: 8, importance: 0.7, display_name: 'Ontario, Canada' }]),
      jsonResponse([]),
    );

    const result = await geocodeAddress('Not A Real Street', 'NowhereVille', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('falls back to a free-text query when the structured query is too broad, and accepts a precise free-text result', async () => {
    const { callCount, capturedUrls } = mockFetchSequence(
      // Structured attempt: only resolves to the street.
      jsonResponse([{ lat: '43.6532', lon: '-79.3832', class: 'highway', type: 'residential', place_rank: 26, display_name: 'Main Street, Toronto, Ontario, Canada' }]),
      // Free-text fallback: resolves precisely.
      jsonResponse([preciseResult({ lat: '43.65321', lon: '-79.38322' })]),
    );

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.65321, lng: -79.38322 });
    expect(callCount()).toBe(2);
    // Second request was genuinely a free-text query (q=...), not another
    // structured attempt.
    expect(new URL(capturedUrls[1]).searchParams.has('q')).toBe(true);
    expect(new URL(capturedUrls[1]).searchParams.get('q')).toContain('123 Main Street');
  });

  it('falls back to free-text when the structured query finds nothing at all (not just something too broad)', async () => {
    const { callCount } = mockFetchSequence(
      jsonResponse([]), // structured: no match
      jsonResponse([preciseResult()]),
    );

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
    expect(callCount()).toBe(2);
  });

  it('rejects when neither the structured nor the free-text fallback resolves precisely', async () => {
    mockFetchSequence(
      jsonResponse([{ lat: '43.6532', lon: '-79.3832', class: 'place', type: 'suburb', place_rank: 20 }]),
      jsonResponse([{ lat: '43.6532', lon: '-79.3832', class: 'place', type: 'suburb', place_rank: 20 }]),
    );

    const result = await geocodeAddress('Nonexistent Street 99999', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('does NOT apply the precision gate when requirePreciseMatch is left off (default false) -- the renter free-text search path', async () => {
    mockFetchOnce(() => ({
      ok: true, status: 200,
      // A city-level, house_number-less result -- would be rejected under
      // requirePreciseMatch, but the renter location search legitimately
      // wants exactly this kind of area-level result.
      json: async () => [{ lat: '43.6532', lon: '-79.3832', class: 'place', type: 'city' }],
    }));

    const result = await geocodeAddress('Scarborough', '');
    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
  });

  it('builds a STRUCTURED query (street/city/state/country) instead of one free-text string', async () => {
    const { capturedUrls } = mockFetchSequence(jsonResponse([preciseResult()]));

    await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    const params = new URL(capturedUrls[0]).searchParams;
    expect(params.get('street')).toBe('123 Main Street');
    expect(params.get('city')).toBe('Toronto');
    expect(params.get('country')).toBe('Canada');
    expect(params.get('addressdetails')).toBe('1');
    expect(params.has('q')).toBe(false); // structured mode, not a joined free-text string
  });

  it('converts a 2-letter province code to its full name for the structured "state" field (Nominatim matches full names more reliably)', async () => {
    const { capturedUrls } = mockFetchSequence(jsonResponse([preciseResult()]));

    await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(new URL(capturedUrls[0]).searchParams.get('state')).toBe('Ontario');
  });

  it('still works without a province in structured mode (state simply omitted)', async () => {
    const { capturedUrls } = mockFetchSequence(jsonResponse([preciseResult()]));

    const result = await geocodeAddress('123 Main Street', 'Toronto', undefined, { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
    expect(new URL(capturedUrls[0]).searchParams.has('state')).toBe(false);
  });

  it('never logs the resolved lat/lon in the acceptance/rejection diagnostic messages (sanitized-metadata logging only)', async () => {
    const infoSpy = vi.spyOn((await import('../../src/utils/logger')).logger, 'info');
    mockFetchSequence(jsonResponse([preciseResult({ lat: '43.999999', lon: '-79.888888' })]));

    await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    for (const call of infoSpy.mock.calls) {
      const line = call.join(' ');
      expect(line).not.toContain('43.999999');
      expect(line).not.toContain('-79.888888');
    }
  });
});
