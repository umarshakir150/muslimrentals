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

// The listing address pipeline's match-quality gate -- POST/PATCH /listings
// pass { requirePreciseMatch: true } (see routes/listings.ts); the
// renter-facing free-text location search (routes/geocode.ts) never does,
// and is fully covered by the tests above with the option omitted
// (defaulting to false), which must keep behaving exactly as before.
//
// This gate compares the REQUESTED street/city/province against Nominatim's
// address breakdown for the result -- not Nominatim's own precision
// metadata (class/type/place_rank), which penalizes a real address purely
// for OSM not having house-number-level data for it. A result is accepted
// whenever it resolves to the right street, in the right city, in the right
// province, whether or not it also carries a house_number; rejected only
// for a wrong street, wrong city, wrong province, or no street at all.
describe('geocodeAddress with { requirePreciseMatch: true }', () => {
  function preciseResult(overrides: Record<string, any> = {}) {
    return {
      lat: '43.6532', lon: '-79.3832',
      class: 'building', type: 'house', place_rank: 30, importance: 0.31,
      display_name: '123 Main Street, Toronto, Ontario, Canada',
      address: { house_number: '123', road: 'Main Street', city: 'Toronto', state: 'Ontario' },
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

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832, confidence: 'precise' });
    expect(callCount()).toBe(1); // right street/city/province on the first (structured) try -- no fallback needed
  });

  // The real address (732 Mill St, Windsor, ON N9C 2S2) that originally
  // motivated the street/city/province match gate: Nominatim's only result
  // never carries a house_number -- OSM simply doesn't have that building
  // mapped -- but it clearly resolves to the correct street, city, and
  // province. Fixture is the ACTUAL response captured from the live
  // backend's own diagnostic logs while investigating this address; not a
  // hypothetical. Since it later turned out this class of match can sit a
  // few hundred meters from the real building, it's returned with
  // `confidence: 'street'` -- purely informational at this layer now:
  // routes/listings.ts requires landlord pin-confirmation for every
  // address-based listing regardless of confidence, using this coordinate
  // only as the starting pin (see MAX_PIN_CORRECTION_METERS).
  it('returns a street-level (confidence: "street") result when no house_number exists in OSM, but does not reject it (732 Mill St, Windsor, ON regression)', async () => {
    const { callCount } = mockFetchSequence(jsonResponse([{
      lat: '42.3023085', lon: '-83.0764497',
      type: 'residential', place_rank: 26, importance: 0.0534,
      address: { road: 'Mill Street', suburb: 'Sandwich', city: 'Windsor', state: 'Ontario', postcode: 'N9C 1A6', country: 'Canada' },
      display_name: 'Mill Street, Sandwich, Windsor, Southwestern Ontario, Ontario, N9C 1A6, Canada',
    }]));

    const result = await geocodeAddress('732 Mill St, N9C 2S2', 'Windsor', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 42.3023085, lng: -83.0764497, confidence: 'street' });
    expect(callCount()).toBe(1); // a valid (if street-level) match on the structured attempt -- no need to fall back
  });

  it('accepts a street match using a Canadian street-type abbreviation on either side ("St" vs "Street"), tagged confidence: "street"', async () => {
    mockFetchSequence(jsonResponse([
      preciseResult({ address: { road: 'Main Street', city: 'Toronto', state: 'Ontario' } }), // no house_number
    ]));

    // Requested with the abbreviation -- result has the spelled-out form.
    const result = await geocodeAddress('123 Main St', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toEqual({ lat: 43.6532, lng: -79.3832, confidence: 'street' });
  });

  // The "candidate improvement": a query returning several candidates
  // (limit=5) must not settle for candidate #1 just because it came first
  // -- if a later candidate on the same street/city/province carries a
  // house_number, it should win over an earlier street-level-only one.
  it('prefers a precise (house_number) candidate over an earlier street-level candidate from the same query', async () => {
    const { capturedUrls } = mockFetchSequence(jsonResponse([
      { lat: '42.30', lon: '-83.07', address: { road: 'Mill Street', city: 'Windsor', state: 'Ontario' } }, // street-level, listed first
      preciseResult({ lat: '42.3025', lon: '-83.0766', address: { house_number: '732', road: 'Mill Street', city: 'Windsor', state: 'Ontario' } }), // precise, listed second
    ]));

    const result = await geocodeAddress('732 Mill Street', 'Windsor', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 42.3025, lng: -83.0766, confidence: 'precise' });
    expect(new URL(capturedUrls[0]).searchParams.get('limit')).toBe('5');
  });

  // Never trade a correct-location candidate for a wrong-location one just
  // because the wrong-location one has higher raw precision (a house_number
  // on the wrong street/city is not a better answer than a valid street-level
  // match on the right one).
  it('never prefers a higher-precision candidate from the wrong street/city/province over a valid match on the requested one', async () => {
    mockFetchSequence(jsonResponse([
      preciseResult({ lat: '43.7', lon: '-79.4', address: { house_number: '123', road: 'Yonge Street', city: 'Toronto', state: 'Ontario' } }), // precise, but WRONG street
      { lat: '43.6532', lon: '-79.3832', address: { road: 'Main Street', city: 'Toronto', state: 'Ontario' } }, // street-level, but the RIGHT street
    ]));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832, confidence: 'street' });
  });

  it('rejects a result on a completely unrelated street', async () => {
    const { callCount } = mockFetchSequence(
      jsonResponse([{ lat: '43.7', lon: '-79.4', address: { road: 'Yonge Street', city: 'Toronto', state: 'Ontario' } }]),
      jsonResponse([{ lat: '43.7', lon: '-79.4', address: { road: 'Yonge Street', city: 'Toronto', state: 'Ontario' } }]),
    );

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toBeNull();
    expect(callCount()).toBe(2); // structured rejected (wrong street) -> free-text fallback tried -> also wrong street
  });

  it('rejects a result in the wrong city, even though the street name matches', async () => {
    mockFetchSequence(
      jsonResponse([{ lat: '45.4', lon: '-75.7', address: { road: 'Main Street', city: 'Ottawa', state: 'Ontario' } }]),
      jsonResponse([{ lat: '45.4', lon: '-75.7', address: { road: 'Main Street', city: 'Ottawa', state: 'Ontario' } }]),
    );

    // A same-named "Main Street" exists in many Ontario cities -- must not
    // accept Ottawa's when Toronto was requested.
    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('rejects a result in the wrong province, even though the street and city names match', async () => {
    mockFetchSequence(
      jsonResponse([{ lat: '49.9', lon: '-97.1', address: { road: 'Main Street', city: 'Winnipeg', state: 'Ontario' } }]),
      jsonResponse([{ lat: '49.9', lon: '-97.1', address: { road: 'Main Street', city: 'Winnipeg', state: 'Ontario' } }]),
    );

    // Requesting Winnipeg, Manitoba but the result resolved to a
    // (fictitious, for this test) "Winnipeg, Ontario" -- province mismatch.
    const result = await geocodeAddress('123 Main Street', 'Winnipeg', 'MB', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('rejects a bare city-level result (no street in the address breakdown at all)', async () => {
    const { callCount } = mockFetchSequence(
      jsonResponse([{ lat: '43.6532', lon: '-79.3832', class: 'place', type: 'city', place_rank: 16, address: { city: 'Toronto', state: 'Ontario' } }]),
      jsonResponse([]),
    );

    const result = await geocodeAddress('Nonexistent Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toBeNull();
    expect(callCount()).toBe(2);
  });

  it('rejects a bare neighbourhood/suburb-level result (no street in the address breakdown)', async () => {
    mockFetchSequence(
      jsonResponse([{ lat: '43.6547', lon: '-79.4005', class: 'place', type: 'neighbourhood', place_rank: 22, address: { neighbourhood: 'Kensington Market', city: 'Toronto', state: 'Ontario' } }]),
      jsonResponse([]),
    );

    const result = await geocodeAddress('Some Vague Street', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('rejects a bare province/state-level result (no street, no city)', async () => {
    mockFetchSequence(
      jsonResponse([{ lat: '51.2538', lon: '-85.3232', class: 'boundary', type: 'administrative', place_rank: 8, address: { state: 'Ontario' } }]),
      jsonResponse([]),
    );

    const result = await geocodeAddress('Not A Real Street', 'NowhereVille', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('falls back to a free-text query when the structured query resolves to the wrong street, and accepts a correct free-text result', async () => {
    const { callCount, capturedUrls } = mockFetchSequence(
      // Structured attempt: wrong street entirely.
      jsonResponse([{ lat: '43.7', lon: '-79.4', address: { road: 'Yonge Street', city: 'Toronto', state: 'Ontario' } }]),
      // Free-text fallback: correct street/city/province.
      jsonResponse([preciseResult({ lat: '43.65321', lon: '-79.38322' })]),
    );

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.65321, lng: -79.38322, confidence: 'precise' });
    expect(callCount()).toBe(2);
    // Second request was genuinely a free-text query (q=...), not another
    // structured attempt.
    expect(new URL(capturedUrls[1]).searchParams.has('q')).toBe(true);
    expect(new URL(capturedUrls[1]).searchParams.get('q')).toContain('123 Main Street');
  });

  it('falls back to free-text when the structured query finds nothing at all (not just something on the wrong street)', async () => {
    const { callCount } = mockFetchSequence(
      jsonResponse([]), // structured: no match
      jsonResponse([preciseResult()]),
    );

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832, confidence: 'precise' });
    expect(callCount()).toBe(2);
  });

  it('rejects when neither the structured nor the free-text fallback resolves to the requested street', async () => {
    mockFetchSequence(
      jsonResponse([{ lat: '43.6532', lon: '-79.3832', class: 'place', type: 'suburb', place_rank: 20, address: { neighbourhood: 'Some Suburb', city: 'Toronto', state: 'Ontario' } }]),
      jsonResponse([{ lat: '43.6532', lon: '-79.3832', class: 'place', type: 'suburb', place_rank: 20, address: { neighbourhood: 'Some Suburb', city: 'Toronto', state: 'Ontario' } }]),
    );

    const result = await geocodeAddress('Nonexistent Street 99999', 'Toronto', 'ON', { requirePreciseMatch: true });
    expect(result).toBeNull();
  });

  it('does NOT apply the street/city/province match gate when requirePreciseMatch is left off (default false) -- the renter free-text search path', async () => {
    mockFetchOnce(() => ({
      ok: true, status: 200,
      // A city-level, road-less result -- would be rejected under
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
    const { capturedUrls } = mockFetchSequence(jsonResponse([preciseResult({ address: { house_number: '123', road: 'Main Street', city: 'Toronto' } })]));

    const result = await geocodeAddress('123 Main Street', 'Toronto', undefined, { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832, confidence: 'precise' });
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

  // The real case that motivated this fallback: a landlord types "1031
  // Askin" (a genuine Windsor, ON address) instead of "1031 Askin Ave", and
  // Nominatim -- which doesn't guess missing suffixes on its own -- finds
  // nothing at all for either the structured or free-text query as typed.
  describe('missing street-suffix fallback ("1031 Askin" resolves like "1031 Askin Ave")', () => {
    function preciseAvenueResult(overrides: Record<string, any> = {}) {
      return {
        lat: '42.3100', lon: '-83.0500',
        class: 'building', type: 'house', place_rank: 30, importance: 0.31,
        display_name: '1031 Askin Avenue, Windsor, Ontario, Canada',
        address: { house_number: '1031', road: 'Askin Avenue', city: 'Windsor', state: 'Ontario' },
        ...overrides,
      };
    }

    it('resolves "1031 Askin" to the same address/location as "1031 Askin Ave" once the address-as-typed finds nothing', async () => {
      const { callCount, capturedUrls } = mockFetchSequence(
        jsonResponse([]), // structured, "1031 Askin" as typed -- nothing
        jsonResponse([]), // free-text, "1031 Askin" as typed -- nothing
        jsonResponse([]), // suffix-expansion attempt #1: "1031 Askin Street" -- nothing
        jsonResponse([preciseAvenueResult()]), // suffix-expansion attempt #2: "1031 Askin Avenue" -- match
        // Every subsequent suffix attempt (Road, Drive, Boulevard, ...)
        // repeats this same fixture (a fixed mock array), but each is
        // evaluated against a DIFFERENT expected street name (e.g. "1031
        // Askin Road") -- so despite the mock "succeeding" again, the
        // street-name check correctly rejects all of them; only the
        // genuine "Avenue" attempt above is ever accepted.
      );

      const result = await geocodeAddress('1031 Askin', 'Windsor', 'ON', { requirePreciseMatch: true });

      expect(result).toEqual({ lat: 42.31, lng: -83.05, confidence: 'precise' });
      // 2 initial attempts (structured + free-text, as typed) + all 10
      // suffix candidates tried (never stops at the first success -- see
      // the ambiguity test below for why).
      expect(callCount()).toBe(12);
      expect(new URL(capturedUrls[3]).searchParams.get('street')).toBe('1031 Askin Avenue');
    });

    it('never attempts suffix expansion when the address already ends in a recognized street suffix', async () => {
      const { callCount } = mockFetchSequence(
        jsonResponse([]), // structured, "732 Mill St" -- nothing
        jsonResponse([]), // free-text, "732 Mill St" -- nothing
      );

      const result = await geocodeAddress('732 Mill St', 'Windsor', 'ON', { requirePreciseMatch: true });

      expect(result).toBeNull();
      // "St" normalizes to a recognized suffix ("street") -- appending
      // another one would be actively wrong, so this never happens.
      expect(callCount()).toBe(2);
    });

    it('accepts a street-level-only suffix-expansion match (no house_number) and tags it confidence: "street", same as any other street-level match', async () => {
      mockFetchSequence(
        jsonResponse([]),
        jsonResponse([]),
        jsonResponse([]), // "1031 Askin Street" -- nothing
        jsonResponse([{
          lat: '42.3100', lon: '-83.0500',
          address: { road: 'Askin Avenue', city: 'Windsor', state: 'Ontario' }, // no house_number
        }]),
      );

      const result = await geocodeAddress('1031 Askin', 'Windsor', 'ON', { requirePreciseMatch: true });

      expect(result).toEqual({ lat: 42.31, lng: -83.05, confidence: 'street' });
    });

    it('still rejects a suffix-expansion candidate in the wrong city -- the fallback never weakens the existing wrong-city protection', async () => {
      const { callCount } = mockFetchSequence(
        jsonResponse([]),
        jsonResponse([]),
        // Every suffix attempt "succeeds" at finding *a* result, but every
        // one of them is in Toronto, not the requested Windsor.
        jsonResponse([preciseAvenueResult({ address: { house_number: '1031', road: 'Askin Street', city: 'Toronto', state: 'Ontario' } })]),
      );

      const result = await geocodeAddress('1031 Askin', 'Windsor', 'ON', { requirePreciseMatch: true });

      expect(result).toBeNull();
      expect(callCount()).toBe(12); // every suffix candidate tried and rejected -- none silently accepted
    });

    it('still rejects a suffix-expansion candidate on an unrelated street -- the fallback never weakens the existing wrong-street protection', async () => {
      mockFetchSequence(
        jsonResponse([]),
        jsonResponse([]),
        // "succeeds" at finding a result, but it's a completely different
        // street than the one actually being expanded/requested.
        jsonResponse([preciseAvenueResult({ address: { house_number: '1031', road: 'Completely Different Road', city: 'Windsor', state: 'Ontario' } })]),
      );

      const result = await geocodeAddress('1031 Askin', 'Windsor', 'ON', { requirePreciseMatch: true });

      expect(result).toBeNull();
    });

    it('refuses to guess and returns null when more than one distinct suffix expansion resolves to a plausible address', async () => {
      const { callCount } = mockFetchSequence(
        jsonResponse([]), // structured, as typed
        jsonResponse([]), // free-text, as typed
        jsonResponse([{ // suffix attempt #1 ("King Street") -- a real, precise match
          lat: '43.10', lon: '-81.20',
          address: { house_number: '500', road: 'King Street', city: 'Windsor', state: 'Ontario' },
        }]),
        jsonResponse([{ // suffix attempt #2 ("King Avenue") -- ALSO a real, precise, but DIFFERENT match
          lat: '43.20', lon: '-81.30',
          address: { house_number: '500', road: 'King Avenue', city: 'Windsor', state: 'Ontario' },
        }]),
        // Every remaining suffix attempt (Road, Drive, ...) repeats the
        // "King Avenue" fixture but is evaluated against a different
        // expected street each time, so none of them add a third match.
      );

      const result = await geocodeAddress('500 King', 'Windsor', 'ON', { requirePreciseMatch: true });

      expect(result).toBeNull();
      expect(callCount()).toBe(12); // still checks every candidate rather than stopping at the first success
    });
  });
});
