import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocodeAddress, verifyConfirmedPinLocation, searchPlaces, GeocodingUnavailableError } from '../../src/utils/geocode';

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

  it('returns null when the geocoding API responds with a genuine client-error status (not a rate-limit/outage)', async () => {
    mockFetchOnce(() => ({ ok: false, status: 400, json: async () => [] }));

    const result = await geocodeAddress('123 Main Street', 'Toronto', 'ON');
    expect(result).toBeNull();
  });

  // Regression coverage: a 429 used to be treated exactly like "no
  // results" (silently returning null), making a provider rate-limit
  // indistinguishable from a genuinely nonexistent address at every call
  // site -- this is the on-the-wire condition that caused real founder-
  // reported "couldn't find that location" / "couldn't verify that exact
  // address" failures that had nothing to do with the address itself.
  it('throws GeocodingUnavailableError (never returns null) when the API responds 429', async () => {
    mockFetchOnce(() => ({ ok: false, status: 429, json: async () => [] }));

    await expect(geocodeAddress('123 Main Street', 'Toronto', 'ON')).rejects.toThrow(GeocodingUnavailableError);
  });

  // Same classification as 429 -- a provider's own 5xx means the SERVICE is
  // having trouble, not that this particular address doesn't exist.
  it('throws GeocodingUnavailableError (never returns null) when the API responds with a 5xx server error', async () => {
    mockFetchOnce(() => ({ ok: false, status: 503, json: async () => [] }));

    await expect(geocodeAddress('123 Main Street', 'Toronto', 'ON')).rejects.toThrow(GeocodingUnavailableError);
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
  // only as the starting pin (see verifyConfirmedPinLocation).
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

  // Regression coverage: once the provider says 429, every further attempt
  // in the same call (free-text fallback, then up to 10 sequential
  // street-suffix-expansion requests) would also just 429 -- continuing to
  // fire them anyway only makes an already-rate-limited provider worse and
  // adds seconds of pointless latency. A 429 on the very first (structured)
  // attempt must abort immediately, not fall through to the free-text
  // fallback.
  it('stops immediately on a 429 from the structured query -- never attempts the free-text fallback', async () => {
    const { callCount } = mockFetchSequence(
      { ok: false, status: 429, json: async () => [] },
    );

    await expect(geocodeAddress('123 Main Street', 'Toronto', 'ON', { requirePreciseMatch: true }))
      .rejects.toThrow(GeocodingUnavailableError);
    expect(callCount()).toBe(1);
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

// The landlord-confirmed-pin geography check (routes/listings.ts's
// resolveGeocodedLocation): validates a confirmed pin by reverse-geocoding
// IT (never by measuring distance from geocodeAddress's own, possibly
// wrong, starting point) and checking its city/province against what was
// actually entered.
describe('verifyConfirmedPinLocation', () => {
  function reverseResponse(address: Record<string, any>): Partial<Response> {
    return { ok: true, status: 200, json: async () => ({ address }) };
  }

  it('accepts a pin that reverse-geocodes to the requested city and province', async () => {
    mockFetchOnce(() => reverseResponse({ city: 'Windsor', state: 'Ontario' }));

    const result = await verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON');

    expect(result.ok).toBe(true);
  });

  it('accepts a pin several kilometres from any earlier guess, as long as it is still in the requested city -- the whole point of this redesign', async () => {
    // Nothing here measures distance from a prior geocode result at all --
    // this function only ever looks at where the CONFIRMED pin itself
    // reverse-geocodes to. A pin 5-6km from a bad starting guess, but still
    // within Windsor, must be accepted.
    mockFetchOnce(() => reverseResponse({ city: 'Windsor', state: 'Ontario' }));

    const result = await verifyConfirmedPinLocation(42.35, -83.02, 'Windsor', 'ON');

    expect(result.ok).toBe(true);
  });

  it('rejects a pin that reverse-geocodes to a different city, even in the same province', async () => {
    mockFetchOnce(() => reverseResponse({ city: 'Toronto', state: 'Ontario' }));

    const result = await verifyConfirmedPinLocation(43.6532, -79.3832, 'Windsor', 'ON');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Toronto');
  });

  it('rejects a pin that reverse-geocodes to a different province, even if some city field happens to match', async () => {
    mockFetchOnce(() => reverseResponse({ city: 'Windsor', state: 'Nova Scotia' }));

    const result = await verifyConfirmedPinLocation(44.98, -64.35, 'Windsor', 'ON');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Nova Scotia');
  });

  it('rejects a pin whose reverse-geocode has no determinable city at all, rather than silently accepting it', async () => {
    mockFetchOnce(() => reverseResponse({ state: 'Ontario' })); // no city/town/village/municipality/hamlet

    const result = await verifyConfirmedPinLocation(46.5, -83.0, 'Windsor', 'ON');

    expect(result.ok).toBe(false);
  });

  it('accepts city matches through the town/village/municipality/hamlet fallback chain, same as forward geocoding', async () => {
    mockFetchOnce(() => reverseResponse({ hamlet: 'Windsor', state: 'Ontario' }));

    const result = await verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON');

    expect(result.ok).toBe(true);
  });

  it('works without a province (optional), checking city only', async () => {
    mockFetchOnce(() => reverseResponse({ city: 'Windsor' }));

    const result = await verifyConfirmedPinLocation(42.31, -83.05, 'Windsor');

    expect(result.ok).toBe(true);
  });

  it('fails closed (rejects) rather than accepting when the reverse-geocoding request itself fails', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network error'); }) as unknown as typeof fetch;

    const result = await verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON');

    expect(result.ok).toBe(false);
  });

  it('fails closed (rejects) when the reverse-geocoding API responds with a genuine client-error status', async () => {
    mockFetchOnce(() => ({ ok: false, status: 400, json: async () => ({}) }));

    const result = await verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON');

    expect(result.ok).toBe(false);
  });

  // Same classification as 429 -- a provider's own 5xx means the SERVICE is
  // having trouble, not that this pin is wrong.
  it('throws GeocodingUnavailableError when the reverse-geocoding API responds with a 5xx server error', async () => {
    mockFetchOnce(() => ({ ok: false, status: 503, json: async () => ({}) }));

    await expect(verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON')).rejects.toThrow(GeocodingUnavailableError);
  });

  // Regression coverage: same distinction as geocodeAddress -- a 429 here
  // used to collapse into the same generic "reverse geocoding service
  // error" rejection as any other failure, which routes/listings.ts then
  // surfaced as "that pin doesn't look right", spuriously rejecting an
  // already-correct, already-confirmed pin.
  it('throws GeocodingUnavailableError (never a plain rejection) when the API responds 429', async () => {
    mockFetchOnce(() => ({ ok: false, status: 429, json: async () => ({}) }));

    await expect(verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON')).rejects.toThrow(GeocodingUnavailableError);
  });

  it('never includes the actual coordinate in its rejection reason (sanitized, log-safe text only)', async () => {
    mockFetchOnce(() => reverseResponse({ city: 'Toronto', state: 'Ontario' }));

    const result = await verifyConfirmedPinLocation(43.999999, -79.888888, 'Windsor', 'ON');

    expect(result.reason).not.toContain('43.999999');
    expect(result.reason).not.toContain('-79.888888');
  });
});

// Coverage for the Browse place/POI-search autocomplete's backing function.
// The central architectural claim under test: Geocodio has no general
// place/POI search product (it's a structured address geocoder), so this
// function must ALWAYS resolve via Nominatim regardless of
// GEOCODING_PROVIDER -- these tests prove that by setting
// GEOCODING_PROVIDER=geocodio and asserting the actual request still hits
// Nominatim's own domain, never api.geocod.io.
describe('searchPlaces', () => {
  const originalProvider = process.env.GEOCODING_PROVIDER;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.GEOCODING_PROVIDER;
    else process.env.GEOCODING_PROVIDER = originalProvider;
  });

  it('resolves a named POI (Toldo Lancer Centre, University of Windsor) to a labeled suggestion -- mocked, no live network call', async () => {
    // A realistic Nominatim jsonv2 shape for a named campus building --
    // OSM tags this kind of POI with amenity=university/building=yes plus a
    // name, which Nominatim's general search (unlike Geocodio's address-only
    // geocoder) can match on directly.
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => [{
        lat: '42.30569', lon: '-83.06437',
        display_name: 'Toldo Lancer Centre, Sunset Avenue, Windsor, Ontario, N9B 3P4, Canada',
        address: { road: 'Sunset Avenue', city: 'Windsor', state: 'Ontario', postcode: 'N9B 3P4' },
      }],
    }));

    const results = await searchPlaces('Toldo Lancer Centre');

    // The label carries the POI's actual name (from display_name's most
    // specific segment), not just the street it happens to be on --
    // "Sunset Avenue, Windsor, Ontario" alone would be accurate but useless
    // for confirming this is the actual building that was searched for.
    expect(results).toEqual([
      { label: 'Toldo Lancer Centre, Windsor, Ontario', lat: 42.30569, lng: -83.06437 },
    ]);
  });

  it('labels a plain address search with the address itself, not a redundant duplicate of it', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => [{
        lat: '43.6532', lon: '-79.3832',
        display_name: '732 Mill Street, Windsor, Ontario, N9C 2S2, Canada',
        address: { house_number: '732', road: 'Mill Street', city: 'Windsor', state: 'Ontario', postcode: 'N9C 2S2' },
      }],
    }));

    const results = await searchPlaces('732 Mill Street, Windsor');

    expect(results).toEqual([
      { label: '732 Mill Street, Windsor, Ontario', lat: 43.6532, lng: -79.3832 },
    ]);
  });

  it('always queries Nominatim, never Geocodio, even when GEOCODING_PROVIDER=geocodio is set', async () => {
    process.env.GEOCODING_PROVIDER = 'geocodio';
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [{ lat: '42.3', lon: '-83.0', display_name: 'Somewhere, Ontario' }] } as Response;
    }) as unknown as typeof fetch;

    await searchPlaces('Toldo Lancer Centre');

    expect(capturedUrl).toContain('nominatim.openstreetmap.org');
    expect(capturedUrl).not.toContain('geocod.io');
    // No Geocodio API key ever appears in the outgoing request -- there is
    // no code path here that could read/attach one, but assert the actual
    // request anyway rather than trusting that by inspection alone.
    expect(capturedUrl).not.toContain('api_key');
  });

  it('returns multiple candidates (not just the top one) for a genuinely ambiguous query', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => [
        { lat: '42.3', lon: '-83.0', address: { road: 'Main Street', city: 'Windsor', state: 'Ontario' } },
        { lat: '43.6', lon: '-79.4', address: { road: 'Main Street', city: 'Toronto', state: 'Ontario' } },
      ],
    }));

    const results = await searchPlaces('Main Street');

    expect(results).toHaveLength(2);
    expect(results[0].label).toContain('Windsor');
    expect(results[1].label).toContain('Toronto');
  });

  it('returns an empty array (never throws) when nothing matches', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, json: async () => [] }));

    const results = await searchPlaces('Nonexistent Fake Place 99999');
    expect(results).toEqual([]);
  });

  it('falls back to display_name when the address breakdown has nothing usable', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => [{ lat: '42.3', lon: '-83.0', display_name: 'Some Bare Result' }],
    }));

    const results = await searchPlaces('Some Bare Result');
    expect(results).toEqual([{ label: 'Some Bare Result', lat: 42.3, lng: -83.0 }]);
  });

  it('drops a candidate with a non-numeric coordinate rather than returning a broken suggestion', async () => {
    mockFetchOnce(() => ({
      ok: true,
      status: 200,
      json: async () => [
        { lat: 'not-a-number', lon: '-83.0', display_name: 'Broken Result' },
        { lat: '42.3', lon: '-83.0', display_name: 'Good Result' },
      ],
    }));

    const results = await searchPlaces('Something');
    expect(results).toEqual([{ label: 'Good Result', lat: 42.3, lng: -83.0 }]);
  });

  it('throws GeocodingUnavailableError (never returns an empty array silently) when the provider is rate-limited', async () => {
    mockFetchOnce(() => ({ ok: false, status: 429, json: async () => ({}) }));

    await expect(searchPlaces('Toldo Lancer Centre')).rejects.toThrow(GeocodingUnavailableError);
  });

  it('scopes the primary search to Canada via countrycodes', async () => {
    const capturedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrls.push(String(url));
      return { ok: true, status: 200, json: async () => [] } as Response;
    }) as unknown as typeof fetch;

    await searchPlaces('Toldo Lancer Centre');

    expect(new URL(capturedUrls[0]).searchParams.get('countrycodes')).toBe('ca');
  });

  it('sends the query text as typed, with no manual ", Canada" appended', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [{ lat: '42.3', lon: '-83.0', display_name: 'Somewhere' }] } as Response;
    }) as unknown as typeof fetch;

    await searchPlaces('Toldo Lancer Centre');

    expect(new URL(capturedUrl).searchParams.get('q')).toBe('Toldo Lancer Centre');
  });

  it('explicitly requests both the address and poi layers, never relying on an undocumented default', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [{ lat: '42.3', lon: '-83.0', display_name: 'Somewhere' }] } as Response;
    }) as unknown as typeof fetch;

    await searchPlaces('Some Gym');

    expect(new URL(capturedUrl).searchParams.get('layer')).toBe('address,poi');
  });

  it('requests namedetails=1 so a matched alias name can be surfaced in the label', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [{ lat: '42.3', lon: '-83.0', display_name: 'Somewhere' }] } as Response;
    }) as unknown as typeof fetch;

    await searchPlaces('Some Place');

    expect(new URL(capturedUrl).searchParams.get('namedetails')).toBe('1');
  });

  // Nominatim's search already matches a query against ANY name tag an
  // element carries (not just its primary `name`) -- namedetails=1 is what
  // lets this app SEE which one matched, so a renamed/aliased place can be
  // labeled with the name the searcher actually typed rather than whichever
  // name happens to be primary on the map. This does NOT change which
  // candidates match (Nominatim's index decides that, unaffected by
  // namedetails) -- only how an already-returned match is labeled. Uses a
  // synthetic renamed-arena fixture, not "Toldo Lancer Centre" itself, to
  // prove the logic generalizes rather than being hardcoded to one place.
  describe('alias-aware labeling (alt_name/old_name/official_name/short_name)', () => {
    it('labels a match by its alt_name when the search matches the alias but not the primary name', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => [{
          lat: '43.1', lon: '-81.2',
          display_name: 'Riverside Community Arena, Sample Street, Anytown, Ontario, Canada',
          address: { road: 'Sample Street', city: 'Anytown', state: 'Ontario' },
          namedetails: { name: 'Riverside Community Arena', alt_name: 'Sunrise Sponsor Arena' },
        }],
      }));

      const results = await searchPlaces('Sunrise Sponsor Arena');

      expect(results).toEqual([{ label: 'Sunrise Sponsor Arena, Anytown, Ontario', lat: 43.1, lng: -81.2 }]);
    });

    it('labels a match by its old_name the same way (a straightforward rename, not just a sponsor alias)', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => [{
          lat: '43.1', lon: '-81.2',
          display_name: 'New Harbour Centre, Dock Road, Anytown, Ontario, Canada',
          address: { road: 'Dock Road', city: 'Anytown', state: 'Ontario' },
          namedetails: { name: 'New Harbour Centre', old_name: 'Old Harbour Centre' },
        }],
      }));

      const results = await searchPlaces('Old Harbour Centre');

      expect(results).toEqual([{ label: 'Old Harbour Centre, Anytown, Ontario', lat: 43.1, lng: -81.2 }]);
    });

    it('splits a semicolon-separated multi-value alt_name tag and matches any one of them', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => [{
          lat: '43.1', lon: '-81.2',
          display_name: 'Primary Name, Sample Street, Anytown, Ontario, Canada',
          address: { road: 'Sample Street', city: 'Anytown', state: 'Ontario' },
          namedetails: { name: 'Primary Name', alt_name: 'First Alias;Second Alias' },
        }],
      }));

      const results = await searchPlaces('Second Alias');

      expect(results[0].label).toContain('Second Alias');
    });

    it('does not substitute an alias when the primary name already matches the search', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => [{
          lat: '43.1', lon: '-81.2',
          display_name: 'Riverside Community Arena, Sample Street, Anytown, Ontario, Canada',
          address: { road: 'Sample Street', city: 'Anytown', state: 'Ontario' },
          namedetails: { name: 'Riverside Community Arena', alt_name: 'Sunrise Sponsor Arena' },
        }],
      }));

      const results = await searchPlaces('Riverside Community Arena');

      expect(results[0].label).toContain('Riverside Community Arena');
      expect(results[0].label).not.toContain('Sunrise Sponsor Arena');
    });

    it('leaves the label unchanged when namedetails is absent entirely (older/partial provider responses)', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => [{
          lat: '43.1', lon: '-81.2',
          display_name: 'Riverside Community Arena, Sample Street, Anytown, Ontario, Canada',
          address: { road: 'Sample Street', city: 'Anytown', state: 'Ontario' },
        }],
      }));

      const results = await searchPlaces('Riverside Community Arena');

      expect(results[0].label).toBe('Riverside Community Arena, Anytown, Ontario');
    });

    it('does not substitute an alias when none of the name tags match the search text at all', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => [{
          lat: '43.1', lon: '-81.2',
          display_name: 'Riverside Community Arena, Sample Street, Anytown, Ontario, Canada',
          address: { road: 'Sample Street', city: 'Anytown', state: 'Ontario' },
          namedetails: { name: 'Riverside Community Arena', alt_name: 'Sunrise Sponsor Arena' },
        }],
      }));

      // A query that matches neither the primary name nor the alias (e.g.
      // the renter typed a street name instead) -- the label must not
      // spuriously substitute an unrelated alias just because one exists.
      const results = await searchPlaces('Sample Street');

      expect(results[0].label).toContain('Riverside Community Arena');
    });
  });

  // Founder-reported real symptom: some places didn't appear as
  // suggestions until nearly the full name was typed. Traced to
  // PLACE_SUGGESTION_LIMIT (then a single, shared fetch+display cap)
  // truncating the REQUEST itself (limit=5) -- a not-yet-highly-ranked
  // candidate for a short partial query was simply never fetched,
  // regardless of debounce timing or minimum query length (both already
  // correct and unrelated to this). Now split into two constants: a wider
  // internal fetch pool (NOMINATIM_FETCH_LIMIT=15) so more of the
  // candidates that COULD be relevant are actually available to rank, and
  // a separate, smaller display cap (DISPLAY_SUGGESTION_LIMIT=8, still
  // within the founder's own "5-8 is fine" guidance) applied only after
  // local re-ranking.
  describe('candidate window (early partial-query suggestions + wider internal pool)', () => {
    it('requests up to 15 candidates per query (a wider internal pool than what is ever displayed)', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn(async (url) => {
        capturedUrl = String(url);
        return { ok: true, status: 200, json: async () => [] } as Response;
      }) as unknown as typeof fetch;

      await searchPlaces('Some Partial Query');

      expect(new URL(capturedUrl).searchParams.get('limit')).toBe('15');
    });

    it('never displays more than 8 suggestions even when Nominatim supplies more', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => Array.from({ length: 15 }, (_, i) => ({
          lat: String(43 + i * 0.01), lon: String(-79 - i * 0.01),
          display_name: `Place ${i}, Anytown, Ontario, Canada`,
          address: { road: `Street ${i}`, city: 'Anytown', state: 'Ontario' },
        })),
      }));

      const results = await searchPlaces('Pla');

      expect(results).toHaveLength(8);
    });

    it('returns all 8 candidates when Nominatim supplies that many for a genuinely broad partial query', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => Array.from({ length: 8 }, (_, i) => ({
          lat: String(43 + i * 0.01), lon: String(-79 - i * 0.01),
          display_name: `Place ${i}, Anytown, Ontario, Canada`,
          address: { road: `Street ${i}`, city: 'Anytown', state: 'Ontario' },
        })),
      }));

      const results = await searchPlaces('Pla');

      expect(results).toHaveLength(8);
    });
  });

  // Nominatim's own dedupe (on by default) runs before this app's labeling
  // -- two distinct raw candidates (e.g. a building point and a nearby
  // entrance/address point) can still collapse to an IDENTICAL computed
  // label, which reads as a confusing literal duplicate in the autocomplete
  // dropdown even though their coordinates differ slightly.
  describe('deduplication by computed label', () => {
    it('collapses two candidates that resolve to the exact same label, keeping the first (Nominatim-ranked) one', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => [
          { lat: '43.1000', lon: '-81.2000', display_name: 'Sample Place, Anytown, Ontario, Canada', address: { road: 'Main Street', house_number: '1', city: 'Anytown', state: 'Ontario' } },
          { lat: '43.1001', lon: '-81.2001', display_name: 'Sample Place, Anytown, Ontario, Canada', address: { road: 'Main Street', house_number: '1', city: 'Anytown', state: 'Ontario' } },
        ],
      }));

      const results = await searchPlaces('Sample Place');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ label: 'Sample Place, Anytown, Ontario', lat: 43.1, lng: -81.2 });
    });

    it('does not collapse genuinely different results that merely share a city/province suffix', async () => {
      mockFetchOnce(() => ({
        ok: true,
        status: 200,
        json: async () => [
          { lat: '43.1', lon: '-81.2', display_name: 'First Place, Anytown, Ontario, Canada', address: { road: 'First Street', city: 'Anytown', state: 'Ontario' } },
          { lat: '43.2', lon: '-81.3', display_name: 'Second Place, Anytown, Ontario, Canada', address: { road: 'Second Street', city: 'Anytown', state: 'Ontario' } },
        ],
      }));

      const results = await searchPlaces('Place');

      expect(results).toHaveLength(2);
    });
  });

  // The two-tier fallback strategy: countrycodes=ca first (hard filter,
  // correct for a Canada-only app), then -- ONLY when that finds literally
  // nothing -- one retry with that hard filter relaxed to a soft Canada-wide
  // viewbox bias, recovering the narrow case of a genuine Canadian POI whose
  // own OSM country tagging is wrong. This does NOT invent data: it cannot
  // and does not recover a POI that isn't named/tagged that way anywhere in
  // OpenStreetMap at all.
  describe('Canada-biased fallback when the primary query finds nothing', () => {
    function mockFetchSequence(...responses: Array<Partial<Response>>) {
      const capturedUrls: string[] = [];
      let callCount = 0;
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

    it('retries once with a Canada-wide viewbox bias (no countrycodes) when the primary query returns nothing', async () => {
      const { capturedUrls, callCount } = mockFetchSequence(
        jsonResponse([]),
        jsonResponse([{
          lat: '42.30569', lon: '-83.06437',
          display_name: 'Toldo Lancer Centre, Sunset Avenue, Windsor, Ontario, N9B 3P4, Canada',
          address: { road: 'Sunset Avenue', city: 'Windsor', state: 'Ontario', postcode: 'N9B 3P4' },
        }])
      );

      const results = await searchPlaces('Toldo Lancer Centre');

      expect(callCount()).toBe(2);
      expect(new URL(capturedUrls[0]).searchParams.get('countrycodes')).toBe('ca');
      expect(new URL(capturedUrls[1]).searchParams.has('countrycodes')).toBe(false);
      expect(new URL(capturedUrls[1]).searchParams.get('viewbox')).toBeTruthy();
      expect(new URL(capturedUrls[1]).searchParams.get('bounded')).toBe('0');
      expect(results).toEqual([{ label: 'Toldo Lancer Centre, Windsor, Ontario', lat: 42.30569, lng: -83.06437 }]);
    });

    it('does not retry when the primary countrycodes=ca query already found results', async () => {
      const { callCount } = mockFetchSequence(
        jsonResponse([{ lat: '42.3', lon: '-83.0', display_name: 'Found On First Try' }])
      );

      await searchPlaces('Some Place');

      expect(callCount()).toBe(1);
    });

    it('returns an empty array (never throws) when both the primary and fallback queries find nothing', async () => {
      const { callCount } = mockFetchSequence(jsonResponse([]), jsonResponse([]));

      const results = await searchPlaces('Nonexistent Fake Place 99999');

      expect(callCount()).toBe(2);
      expect(results).toEqual([]);
    });

    it('never retries when the primary query itself throws (rate-limited) -- does not hammer an already-unavailable provider', async () => {
      const { callCount } = mockFetchSequence({ ok: false, status: 429, json: async () => ({}) });

      await expect(searchPlaces('Toldo Lancer Centre')).rejects.toThrow(GeocodingUnavailableError);
      expect(callCount()).toBe(1);
    });
  });

  // Founder-reported real symptoms, addressed together with one general
  // relevance model rather than one-off fixes:
  //   1. multi-word queries were dominated by whichever word Nominatim's
  //      OWN ranking favoured (e.g. "Vincent Mass" staying dominated by
  //      unrelated "Vincent"-only results);
  //   2. a single early keystroke ("T") was artificially promoting a
  //      specific, unrelated-to-the-input-so-far candidate to the top.
  // Root cause for both: this app previously passed Nominatim's own
  // per-query relevance order straight through with no local re-ranking at
  // all. These tests exercise the local scoring/re-ranking layer directly
  // via searchPlaces (mocked fetch, deterministic candidate pools) -- using
  // "Toldo"/"Vincent Massey" only as the founder's own illustrative
  // examples, never as special-cased strings in the production code
  // (confirmed by the synthetic, differently-named fixtures interspersed
  // below, which behave identically).
  describe('local relevance ranking (general model, not place-specific)', () => {
    it('a single, low-signal character does NOT artificially promote any specific candidate -- Nominatim\'s own original order is preserved', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'Toronto Transit Stop, Anytown, Ontario, Canada', address: { road: 'Transit Way', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.2', lon: '-81.2', display_name: 'Trillium Park, Anytown, Ontario, Canada', address: { road: 'Park Lane', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.3', lon: '-81.3', display_name: 'Toldo Lancer Centre, Anytown, Ontario, Canada', address: { road: 'Sunset Avenue', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.4', lon: '-81.4', display_name: 'Tim Hortons, Anytown, Ontario, Canada', address: { road: 'Main Street', city: 'Anytown', state: 'Ontario' } },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      const results = await searchPlaces('T');

      // toPlaceSuggestionLabel drops the trailing country segment (see its
      // own doc comment) -- compare against that same "name, city, state"
      // shape, not the raw display_name, to assert order alone.
      expect(results.map((r) => r.label)).toEqual([
        'Toronto Transit Stop, Anytown, Ontario',
        'Trillium Park, Anytown, Ontario',
        'Toldo Lancer Centre, Anytown, Ontario',
        'Tim Hortons, Anytown, Ontario',
      ]);
    });

    it('a short but meaningful single-word prefix makes the specifically-matching candidate competitive against non-matching distractors', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'Trillium Park, Anytown, Ontario, Canada', address: { road: 'Park Lane', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.2', lon: '-81.2', display_name: 'Tim Hortons, Anytown, Ontario, Canada', address: { road: 'Main Street', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.3', lon: '-81.3', display_name: 'Toldo Lancer Centre, Anytown, Ontario, Canada', address: { road: 'Sunset Avenue', city: 'Anytown', state: 'Ontario' } },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      // Neither "Trillium" nor "Tim" starts with "tol" -- only "Toldo"
      // does, so it should now rank first despite being listed last.
      const results = await searchPlaces('Tol');

      expect(results[0].label).toContain('Toldo Lancer Centre');
    });

    it('the complete first word of a multi-word name ranks it highly, clearly above candidates that share only the first letter', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'Trillium Park, Anytown, Ontario, Canada', address: { road: 'Park Lane', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.2', lon: '-81.2', display_name: 'Toldo Lancer Centre, Anytown, Ontario, Canada', address: { road: 'Sunset Avenue', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.3', lon: '-81.3', display_name: 'Tim Hortons, Anytown, Ontario, Canada', address: { road: 'Main Street', city: 'Anytown', state: 'Ontario' } },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      const results = await searchPlaces('Toldo');

      expect(results[0].label).toContain('Toldo Lancer Centre');
    });

    it('a multi-word query is not dominated by its first word -- a candidate matching every typed token (incl. a partial final token) outranks one matching only the first', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'Vincent Street, Anytown, Ontario, Canada', address: { road: 'Vincent Street', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.2', lon: '-81.2', display_name: 'Vincent Massey Park, Anytown, Ontario, Canada', address: { road: 'River Road', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.3', lon: '-81.3', display_name: 'Vincent Apartments, Anytown, Ontario, Canada', address: { road: 'Apartment Row', city: 'Anytown', state: 'Ontario' } },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      const results = await searchPlaces('Vincent Mass');

      expect(results[0].label).toContain('Vincent Massey Park');
    });

    it('two-word partial search: a candidate matching both typed tokens outranks one matching only one (generic, non-Vincent/Toldo example)', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'Green Street, Anytown, Ontario, Canada', address: { road: 'Green Street', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.2', lon: '-81.2', display_name: 'Green Valley Estates, Anytown, Ontario, Canada', address: { road: 'Estate Drive', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.3', lon: '-81.3', display_name: 'Green Meadows, Anytown, Ontario, Canada', address: { road: 'Meadow Lane', city: 'Anytown', state: 'Ontario' } },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      const results = await searchPlaces('Green Val');

      expect(results[0].label).toContain('Green Valley Estates');
    });

    it('three-word partial search: a candidate matching all three typed tokens outranks one matching only two', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'North Community Hall, Anytown, Ontario, Canada', address: { road: 'Hall Road', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.2', lon: '-81.2', display_name: 'North River Community Centre, Anytown, Ontario, Canada', address: { road: 'River Road', city: 'Anytown', state: 'Ontario' } },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      const results = await searchPlaces('North River Com');

      expect(results[0].label).toContain('North River Community Centre');
    });

    it('a partially typed final token counts as a match only when it is a genuine prefix of a real word in the candidate name', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'Green Street, Anytown, Ontario, Canada', address: { road: 'Green Street', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.2', lon: '-81.2', display_name: 'Green Valley Estates, Anytown, Ontario, Canada', address: { road: 'Estate Drive', city: 'Anytown', state: 'Ontario' } },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      // "Vall" is a genuine prefix of "Valley" -- should still match and
      // promote "Green Valley Estates", same as the shorter "Val" would.
      const results = await searchPlaces('Green Vall');

      expect(results[0].label).toContain('Green Valley Estates');
    });

    it('ranking considers a matched alias (alt_name), not just the primary name -- a query matching only the alias still outranks a non-matching distractor', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'Unrelated Diner, Anytown, Ontario, Canada', address: { road: 'Diner Road', city: 'Anytown', state: 'Ontario' } },
        {
          lat: '43.2', lon: '-81.2',
          display_name: 'Riverside Community Arena, Anytown, Ontario, Canada',
          address: { road: 'Arena Way', city: 'Anytown', state: 'Ontario' },
          namedetails: { name: 'Riverside Community Arena', alt_name: 'Sunrise Sponsor Arena' },
        },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      const results = await searchPlaces('Sunrise Sponsor');

      expect(results[0].label).toContain('Sunrise Sponsor Arena');
    });

    it('ranking is case- and punctuation-insensitive', async () => {
      const pool = [
        { lat: '43.1', lon: '-81.1', display_name: 'Green Street, Anytown, Ontario, Canada', address: { road: 'Green Street', city: 'Anytown', state: 'Ontario' } },
        { lat: '43.2', lon: '-81.2', display_name: 'Green Valley Estates, Anytown, Ontario, Canada', address: { road: 'Estate Drive', city: 'Anytown', state: 'Ontario' } },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      const results = await searchPlaces('GrEeN, VaLLey.');

      expect(results[0].label).toContain('Green Valley Estates');
    });

    it('when two candidates share an identical computed label, dedup keeps the higher-RANKED one, not simply whichever Nominatim listed first', async () => {
      const pool = [
        // Listed FIRST by Nominatim, but matches only the generic first token.
        { lat: '43.1', lon: '-81.1', display_name: 'Sample Place, Anytown, Ontario, Canada', address: { road: 'Vincent Street', city: 'Anytown', state: 'Ontario' } },
        // Listed SECOND, but this is the one whose full display name actually
        // matches the typed phrase -- should win the dedup keep despite
        // arriving later, because ranking runs BEFORE dedup.
        {
          lat: '43.2', lon: '-81.2',
          display_name: 'Sample Place, Anytown, Ontario, Canada',
          address: { road: 'Vincent Street', city: 'Anytown', state: 'Ontario' },
          namedetails: { name: 'Sample Place', alt_name: 'Sample Place Exact Match' },
        },
      ];
      mockFetchOnce(() => ({ ok: true, status: 200, json: async () => pool }));

      const results = await searchPlaces('Sample Place Exact Match');

      expect(results).toHaveLength(1);
      expect(results[0].lat).toBe(43.2); // the second (higher-ranked) candidate's coordinate won
    });
  });
});
