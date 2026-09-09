/**
 * Coverage for the Geocodio provider path added behind utils/geocode.ts's
 * existing geocodeAddress/verifyConfirmedPinLocation interface (see that
 * file's top-of-file comment for the full provider-plumbing rationale).
 * Selected via GEOCODING_PROVIDER=geocodio + GEOCODIO_API_KEY -- both read
 * lazily per call, so each test sets/clears them directly rather than
 * needing module re-imports.
 *
 * These are unit tests against a MOCKED fetch using response shapes
 * documented in Geocodio's own OpenAPI spec (github.com/Geocodio/openapi-
 * spec) -- this is a pre-production evaluation spike with no live
 * GEOCODIO_API_KEY provisioned, so nothing here is a real network call
 * against api.geocod.io. See the manual regression report for how these
 * same fixtures were used to reason about real Ontario addresses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocodeAddress, resolvePlace, verifyConfirmedPinLocation, GeocodingUnavailableError, GeocodingConfigError } from '../../src/utils/geocode';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function mockFetchOnce(impl: () => Promise<Partial<Response>> | Partial<Response>) {
  globalThis.fetch = vi.fn(async () => impl() as Response) as unknown as typeof fetch;
}

function geocodioForwardResponse(results: any[]) {
  return { ok: true, status: 200, json: async () => ({ results }) };
}

function geocodioReverseResponse(result: any | null) {
  return { ok: true, status: 200, json: async () => ({ results: result ? [result] : [] }) };
}

// A realistic Geocodio result for a rooftop-precision Canadian address,
// shaped per Geocodio's documented address_components/location/
// accuracy_type fields.
function rooftopResult(overrides: Record<string, any> = {}) {
  return {
    address_components: {
      number: '1051', street: 'Cedarglen', suffix: 'Gate',
      formatted_street: 'Cedarglen Gate',
      city: 'Mississauga', state: 'ON', zip: '', country: 'CA',
    },
    formatted_address: '1051 Cedarglen Gate, Mississauga, ON, Canada',
    location: { lat: 43.5789, lng: -79.6583 },
    accuracy: 1, accuracy_type: 'rooftop', source: 'Statistics Canada',
    ...overrides,
  };
}

beforeEach(() => {
  process.env.GEOCODING_PROVIDER = 'geocodio';
  process.env.GEOCODIO_API_KEY = 'test-geocodio-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe('Geocodio provider: successful forward geocode', () => {
  it('resolves a rooftop-precision structured match as confidence: "precise"', async () => {
    mockFetchOnce(() => geocodioForwardResponse([rooftopResult()]));

    const result = await geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.5789, lng: -79.6583, confidence: 'precise' });
  });

  it('sends the API key as a query parameter, never in a header the frontend could ever see (server-only)', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url: any) => {
      capturedUrl = String(url);
      return geocodioForwardResponse([rooftopResult()]) as unknown as Response;
    }) as unknown as typeof fetch;

    await geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true });

    expect(capturedUrl).toContain('api.geocod.io');
    expect(capturedUrl).toContain('api_key=test-geocodio-key');
  });

  it('resolves a street_center (range-interpolated) match as confidence: "street", not "precise" -- accuracy_type governs this, not whether a house number was in the input', async () => {
    mockFetchOnce(() => geocodioForwardResponse([{
      address_components: { number: '732', street: 'Mill', suffix: 'St', formatted_street: 'Mill St', city: 'Windsor', state: 'ON', zip: 'N9C', country: 'CA' },
      formatted_address: '732 Mill St, Windsor, ON N9C, Canada',
      location: { lat: 42.2905, lng: -83.0455 },
      accuracy: 0.8, accuracy_type: 'street_center', source: 'TIGER/Line',
    }]));

    const result = await geocodeAddress('732 Mill St', 'Windsor', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 42.2905, lng: -83.0455, confidence: 'street' });
  });

  it('rejects a bare "place"-level match (accuracy_type=place) exactly like Nominatim\'s no-street rejection, both structured and free-text', async () => {
    // "Mill St" already has a recognized suffix, so this never falls
    // through to the 10-attempt suffix-expansion fallback -- isolates the
    // place-level rejection itself, checked on both attempts.
    const placeLevelResult = {
      address_components: { city: 'Windsor', state: 'ON', country: 'CA' },
      formatted_address: 'Windsor, ON, Canada',
      location: { lat: 42.3, lng: -83.03 },
      accuracy: 0.5, accuracy_type: 'place', source: 'Geocodio',
    };
    globalThis.fetch = vi.fn(async () => geocodioForwardResponse([placeLevelResult]) as unknown as Response) as unknown as typeof fetch;

    const result = await geocodeAddress('999 Nonexistent Mill St', 'Windsor', 'ON', { requirePreciseMatch: true });

    // A place-level centroid is never accepted as if it were the address,
    // no matter how many times it's the only thing returned.
    expect(result).toBeNull();
  });

  it('falls back to free-text when the structured query finds nothing, same two-tier behavior as Nominatim', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return (callCount === 1 ? geocodioForwardResponse([]) : geocodioForwardResponse([rooftopResult()])) as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true });

    expect(result).toEqual({ lat: 43.5789, lng: -79.6583, confidence: 'precise' });
    expect(callCount).toBe(2);
  });
});

// Coverage for the narrow split added to resolvePlace() (Browse's manual
// Search/Enter, GET /geocode/resolve): a query that LOOKS LIKE a full
// street address (a leading house number) now resolves via Geocodio's own
// forward-geocoding free-text path instead of the Nominatim-only
// searchPlaces() pipeline. Acceptance is judged directly on Geocodio's own
// accuracy_type string (never re-derived from house_number presence, which
// is deliberately NOT populated for range_interpolation -- see
// GEOCODIO_APPROXIMATE_ADDRESS_ACCURACY_TYPES's own comment) and never
// re-ranked by any Nominatim heuristic. Non-address queries are unaffected
// and still resolve through searchPlaces()/Nominatim, proven here by
// asserting Geocodio is never called for one even with
// GEOCODING_PROVIDER=geocodio active.
describe('resolvePlace address-shaped split (Browse manual Search/Enter)', () => {
  it('1. accepts a rooftop result', async () => {
    mockFetchOnce(() => geocodioForwardResponse([rooftopResult()]));

    const result = await resolvePlace('1051 Cedarglen Gate');

    expect(result).toEqual({
      lat: 43.5789, lng: -79.6583, confidence: 'precise', accuracyType: 'rooftop', precision: 'exact',
    });
  });

  it('2. accepts a point result', async () => {
    mockFetchOnce(() => geocodioForwardResponse([rooftopResult({ accuracy_type: 'point', accuracy: 1 })]));

    const result = await resolvePlace('1051 Cedarglen Gate');

    expect(result).toEqual({
      lat: 43.5789, lng: -79.6583, confidence: 'precise', accuracyType: 'point', precision: 'exact',
    });
  });

  it('3. accepts a nearest_rooftop_match result', async () => {
    mockFetchOnce(() => geocodioForwardResponse([rooftopResult({ accuracy_type: 'nearest_rooftop_match', accuracy: 0.8 })]));

    const result = await resolvePlace('1051 Cedarglen Gate');

    expect(result).toEqual({
      lat: 43.5789, lng: -79.6583, confidence: 'precise', accuracyType: 'nearest_rooftop_match', precision: 'exact',
    });
  });

  it('4. accepts a range_interpolation result -- a real, useful match, returned and clearly marked approximate, never rejected', async () => {
    mockFetchOnce(() => geocodioForwardResponse([{
      address_components: { number: '732', street: 'Mill', suffix: 'St', formatted_street: 'Mill St', city: 'Windsor', state: 'ON', zip: 'N9C', country: 'CA' },
      formatted_address: '732 Mill St, Windsor, ON N9C, Canada',
      location: { lat: 42.2905, lng: -83.0455 },
      accuracy: 0.8, accuracy_type: 'range_interpolation', source: 'TIGER/Line',
    }]));

    const result = await resolvePlace('732 Mill St');

    expect(result).toEqual({
      lat: 42.2905, lng: -83.0455, confidence: 'street', accuracyType: 'range_interpolation', precision: 'approximate',
    });
  });

  it('5. accepts a street_center result as approximate -- founder-tested real case ("2555 college ave windsor" resolves to street_center and nothing better)', async () => {
    mockFetchOnce(() => geocodioForwardResponse([{
      address_components: { number: '732', street: 'Mill', suffix: 'St', formatted_street: 'Mill St', city: 'Windsor', state: 'ON', zip: 'N9C', country: 'CA' },
      formatted_address: '732 Mill St, Windsor, ON N9C, Canada',
      location: { lat: 42.2905, lng: -83.0455 },
      accuracy: 0.8, accuracy_type: 'street_center', source: 'TIGER/Line',
    }]));

    const result = await resolvePlace('732 Mill St');

    expect(result).toEqual({
      lat: 42.2905, lng: -83.0455, confidence: 'street', accuracyType: 'street_center', precision: 'approximate',
    });
  });

  it('6. rejects a bare place/city-level match -- no street resolved at all, and never tries a Nominatim rescue (a real Nominatim response is mocked here specifically to prove the rejection is not just an artifact of a same-shaped mock)', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([{
        address_components: { city: 'Windsor', state: 'ON', country: 'CA' },
        formatted_address: 'Windsor, ON, Canada',
        location: { lat: 42.3, lng: -83.03 },
        accuracy: 0.5, accuracy_type: 'place', source: 'Geocodio',
      }]),
      nominatimPoiResponse(),
    );

    expect(await resolvePlace('999 Nonexistent Mill St')).toBeNull();
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });

  it('7. rejects a bare state/province-level match -- no street resolved at all, and never tries a Nominatim rescue', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([{
        address_components: { state: 'ON', country: 'CA' },
        formatted_address: 'Ontario, Canada',
        location: { lat: 51.25, lng: -85.32 },
        accuracy: 0.3, accuracy_type: 'state', source: 'Geocodio',
      }]),
      nominatimPoiResponse(),
    );

    expect(await resolvePlace('999 Nonexistent Mill St')).toBeNull();
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });

  it('8. rejects a result that resolves outside Canada, even when rooftop-precise, and never tries a Nominatim rescue', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([{
        address_components: { number: '100', street: 'Main', formatted_street: 'Main St', city: 'Detroit', state: 'MI', zip: '48226', country: 'US' },
        formatted_address: '100 Main St, Detroit, MI 48226',
        location: { lat: 42.33, lng: -83.04 },
        accuracy: 1, accuracy_type: 'rooftop', source: 'Geocodio',
      }]),
      nominatimPoiResponse(),
    );

    const result = await resolvePlace('100 Main St');

    expect(result).toBeNull();
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });

  // Verifies the exact real-world case reported after this fix: the query
  // that previously 404'd against the live backend (see this repo's own
  // commit history for the sanitized Geocodio fields logged for it) now
  // resolves successfully, tagged approximate rather than rejected.
  it('resolves "2555 college ave windsor" (the real founder-tested query) to a successful approximate result, not 404', async () => {
    mockFetchOnce(() => geocodioForwardResponse([{
      address_components: { number: '2555', street: 'College', suffix: 'Ave', formatted_street: 'College Ave', city: 'Windsor', state: 'ON', zip: 'N9B', country: 'CA' },
      formatted_address: '2555 College Ave, Windsor, ON N9B, Canada',
      location: { lat: 42.3009, lng: -83.0578 },
      accuracy: 0.8, accuracy_type: 'street_center', source: 'Geocodio',
    }]));

    const result = await resolvePlace('2555 college ave windsor');

    expect(result).toEqual({
      lat: 42.3009, lng: -83.0578, confidence: 'street', accuracyType: 'street_center', precision: 'approximate',
    });
  });

  it('sends the query to Geocodio\'s free-text endpoint with an explicit Canada hint, never a structured street/city query', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url: any) => {
      capturedUrl = String(url);
      return geocodioForwardResponse([rooftopResult()]) as unknown as Response;
    }) as unknown as typeof fetch;

    await resolvePlace('1051 Cedarglen Gate');

    expect(capturedUrl).toContain('api.geocod.io');
    const params = new URL(capturedUrl).searchParams;
    expect(params.get('q')).toBe('1051 Cedarglen Gate, Canada');
    expect(params.has('street')).toBe(false);
  });

  it('propagates GeocodingUnavailableError (never silently returns null) when Geocodio is rate-limited', async () => {
    mockFetchOnce(() => ({ ok: false, status: 429, json: async () => ({}) }));

    await expect(resolvePlace('1051 Cedarglen Gate')).rejects.toThrow(GeocodingUnavailableError);
  });

  it('does NOT call Geocodio for a non-address (POI/place-name) query -- that still resolves via Nominatim, unchanged', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url: any) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, json: async () => [{
        lat: '42.30569', lon: '-83.06437',
        display_name: 'Vincent Massey Secondary School, Windsor, Ontario, Canada',
        address: { road: 'Somewhere Else Road', city: 'Windsor', state: 'Ontario' },
      }] } as Response;
    }) as unknown as typeof fetch;

    const result = await resolvePlace('Vincent Massey Secondary School');

    expect(capturedUrl).toContain('nominatim.openstreetmap.org');
    expect(capturedUrl).not.toContain('api.geocod.io');
    expect(result).toEqual({ lat: 42.30569, lng: -83.06437 });
  });
});

// QA finding (2026-09): looksLikeFullAddress is a SHAPE check only (leading
// house number + more text) -- it also matches plenty of real business/POI
// names that happen to start with a number ("24 Hour Fitness", "3 Brewers",
// "7 Eleven Windsor"). Before this fix, resolvePlace() routed those straight
// to geocodeFullAddress() with no fallback, so Geocodio (a pure address
// geocoder with no POI data) correctly found nothing and the search dead-
// ended in "Location not found" even though the same query would have
// resolved fine via the autocomplete dropdown's Nominatim-backed path.
//
// The fix: resolvePlace() now falls back to searchPlaces()/Nominatim
// whenever geocodeFullAddress() returns null, so a genuine address-shaped
// query still gets its accurate Geocodio-only-if-Geocodio-succeeds
// treatment, but a false-positive-shaped POI/business query still resolves
// instead of dead-ending. A query that Geocodio DOES resolve is returned
// immediately and never touches Nominatim at all -- the fallback is a
// last resort, not a second opinion.
function mockFetchByProvider(geocodioResponse: Partial<Response>, nominatimResponse: Partial<Response>) {
  let geocodioCalls = 0;
  let nominatimCalls = 0;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url).includes('api.geocod.io')) {
      geocodioCalls++;
      return geocodioResponse as Response;
    }
    nominatimCalls++;
    return nominatimResponse as Response;
  }) as unknown as typeof fetch;
  return { geocodioCalls: () => geocodioCalls, nominatimCalls: () => nominatimCalls };
}

function nominatimPoiResponse(overrides: Record<string, any> = {}) {
  return {
    ok: true, status: 200, json: async () => [{
      lat: '42.2917', lon: '-83.0398',
      display_name: 'A Place, Some Road, Windsor, Ontario, Canada',
      address: { road: 'Some Road', city: 'Windsor', state: 'Ontario', country_code: 'ca' },
      ...overrides,
    }],
  };
}

describe('resolvePlace Nominatim fallback for false-positive address-shaped queries (QA fix)', () => {
  it('1. "2555 College Ave Windsor" still resolves through Geocodio directly -- no fallback needed', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([{
        address_components: { number: '2555', street: 'College', suffix: 'Ave', formatted_street: 'College Ave', city: 'Windsor', state: 'ON', zip: 'N9B', country: 'CA' },
        formatted_address: '2555 College Ave, Windsor, ON N9B, Canada',
        location: { lat: 42.3009, lng: -83.0578 },
        accuracy: 0.8, accuracy_type: 'street_center', source: 'Geocodio',
      }]),
      { ok: true, status: 200, json: async () => [] },
    );

    const result = await resolvePlace('2555 College Ave Windsor');

    expect(result).toEqual({
      lat: 42.3009, lng: -83.0578, confidence: 'street', accuracyType: 'street_center', precision: 'approximate',
    });
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });

  it('2. "24 Hour Fitness Windsor" falls back to Nominatim when Geocodio has no address-level match', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([]),
      nominatimPoiResponse({ display_name: '24 Hour Fitness, Tecumseh Road E, Windsor, Ontario, Canada', address: { road: 'Tecumseh Road E', city: 'Windsor', state: 'Ontario', country_code: 'ca' } }),
    );

    const result = await resolvePlace('24 Hour Fitness Windsor');

    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(1);
    expect(result).toEqual({ lat: 42.2917, lng: -83.0398 });
  });

  it('3. "7 Eleven Windsor" falls back to Nominatim correctly (space-separated form -- the shape check requires whitespace right after the leading digits, so the hyphenated brand spelling "7-Eleven" never matches looksLikeFullAddress in the first place and already went straight to Nominatim before this fix)', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([]),
      nominatimPoiResponse({ display_name: '7 Eleven, Wyandotte Street, Windsor, Ontario, Canada', address: { road: 'Wyandotte Street', city: 'Windsor', state: 'Ontario', country_code: 'ca' } }),
    );

    const result = await resolvePlace('7 Eleven Windsor');

    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(1);
    expect(result).toEqual({ lat: 42.2917, lng: -83.0398 });
  });

  it('4. a genuinely invalid query returns null ("Location not found") only when BOTH Geocodio and Nominatim find nothing', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([]),
      { ok: true, status: 200, json: async () => [] },
    );

    const result = await resolvePlace('999999 Totally Fake Nonexistent Street');

    expect(result).toBeNull();
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(1);
  });

  it('5. a real street address that Geocodio resolves precisely never falls back to Nominatim', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([rooftopResult()]),
      { ok: true, status: 200, json: async () => [] },
    );

    const result = await resolvePlace('1051 Cedarglen Gate');

    expect(result).toEqual({ lat: 43.5789, lng: -79.6583, confidence: 'precise', accuracyType: 'rooftop', precision: 'exact' });
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });
});

// QA re-review finding (2026-09): the fallback above originally triggered on
// ANY null/falsy return from geocodeFullAddress(), which conflated "Geocodio
// found no candidate at all" (the intended POI-name fallback case) with
// "Geocodio found a candidate but rejected it as place/state-level or
// non-Canadian" -- the latter previously produced an honest, immediate 404,
// and collapsing it into the same fallback path could silently return an
// imprecise Nominatim match for an address Geocodio had deliberately
// rejected. geocodeFullAddress() now returns a discriminated
// FullAddressResolution ('resolved' | 'no_candidate' | 'rejected_imprecise')
// so resolvePlace() can fall back ONLY on 'no_candidate'. This block proves
// that distinction directly, covering every scenario named in the fix.
describe('resolvePlace: no_candidate vs rejected_imprecise fallback gating (QA re-review fix)', () => {
  it('1. no Geocodio candidates at all -> falls back to Nominatim', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([]),
      nominatimPoiResponse({ display_name: '3 Brewers, Ouellette Avenue, Windsor, Ontario, Canada', address: { road: 'Ouellette Avenue', city: 'Windsor', state: 'Ontario', country_code: 'ca' } }),
    );

    const result = await resolvePlace('3 Brewers Windsor');

    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(1);
    expect(result).toEqual({ lat: 42.2917, lng: -83.0398 });
  });

  it('2. Geocodio returns a place-level (city-only) result -> NO fallback, "Location not found"', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([{
        address_components: { city: 'Windsor', state: 'ON', country: 'CA' },
        formatted_address: 'Windsor, ON, Canada',
        location: { lat: 42.3, lng: -83.03 },
        accuracy: 0.5, accuracy_type: 'place', source: 'Geocodio',
      }]),
      // A real, resolvable Nominatim response -- if the fallback incorrectly
      // fired for a place-level rejection, this mock would let it "succeed"
      // and the test would catch the regression.
      nominatimPoiResponse(),
    );

    const result = await resolvePlace('452 Some Unmapped Street Windsor');

    expect(result).toBeNull();
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });

  it('3. Geocodio returns a state-level (province-only) result -> NO fallback, "Location not found"', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([{
        address_components: { state: 'ON', country: 'CA' },
        formatted_address: 'Ontario, Canada',
        location: { lat: 51.25, lng: -85.32 },
        accuracy: 0.3, accuracy_type: 'state', source: 'Geocodio',
      }]),
      nominatimPoiResponse(),
    );

    const result = await resolvePlace('452 Some Unmapped Street Windsor');

    expect(result).toBeNull();
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });

  it('4. a valid precise address (rooftop) resolves via Geocodio -> no fallback', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([rooftopResult()]),
      nominatimPoiResponse(),
    );

    const result = await resolvePlace('1051 Cedarglen Gate');

    expect(result).toEqual({ lat: 43.5789, lng: -79.6583, confidence: 'precise', accuracyType: 'rooftop', precision: 'exact' });
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });

  it('5. a valid approximate address (street_center) resolves via Geocodio -> no fallback', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([{
        address_components: { number: '2555', street: 'College', suffix: 'Ave', formatted_street: 'College Ave', city: 'Windsor', state: 'ON', zip: 'N9B', country: 'CA' },
        formatted_address: '2555 College Ave, Windsor, ON N9B, Canada',
        location: { lat: 42.3009, lng: -83.0578 },
        accuracy: 0.8, accuracy_type: 'street_center', source: 'Geocodio',
      }]),
      nominatimPoiResponse(),
    );

    const result = await resolvePlace('2555 college ave windsor');

    expect(result).toEqual({
      lat: 42.3009, lng: -83.0578, confidence: 'street', accuracyType: 'street_center', precision: 'approximate',
    });
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(0);
  });

  it('6. an invalid query with no candidates from either provider -> "Location not found"', async () => {
    const { geocodioCalls, nominatimCalls } = mockFetchByProvider(
      geocodioForwardResponse([]),
      { ok: true, status: 200, json: async () => [] },
    );

    const result = await resolvePlace('888888 Absolutely Nowhere Lane');

    expect(result).toBeNull();
    expect(geocodioCalls()).toBe(1);
    expect(nominatimCalls()).toBe(1);
  });
});

describe('Geocodio provider: successful reverse verification', () => {
  it('accepts a confirmed pin that reverse-geocodes to the requested city/province', async () => {
    mockFetchOnce(() => geocodioReverseResponse({
      address_components: { city: 'Windsor', state: 'ON', country: 'CA' },
      formatted_address: 'Windsor, ON, Canada',
      location: { lat: 42.31, lng: -83.05 },
      accuracy: 1, accuracy_type: 'rooftop',
    }));

    const result = await verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON');

    expect(result).toEqual({ ok: true, reason: 'matches the requested city/province' });
  });

  it('rejects (never throws) a confirmed pin whose reverse geocode resolves to the wrong city', async () => {
    mockFetchOnce(() => geocodioReverseResponse({
      address_components: { city: 'Toronto', state: 'ON', country: 'CA' },
      formatted_address: 'Toronto, ON, Canada',
      location: { lat: 43.65, lng: -79.38 },
      accuracy: 1, accuracy_type: 'rooftop',
    }));

    const result = await verifyConfirmedPinLocation(43.65, -79.38, 'Windsor', 'ON');

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Toronto/);
  });

  it('rejects a confirmed pin whose reverse geocode resolves to the wrong province, even with a matching city string', async () => {
    mockFetchOnce(() => geocodioReverseResponse({
      address_components: { city: 'Windsor', state: 'NS', country: 'CA' }, // Windsor, Nova Scotia -- a real, different place
      formatted_address: 'Windsor, NS, Canada',
      location: { lat: 44.98, lng: -64.13 },
      accuracy: 1, accuracy_type: 'rooftop',
    }));

    const result = await verifyConfirmedPinLocation(44.98, -64.13, 'Windsor', 'ON');

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/NS/);
  });
});

describe('Geocodio provider: 429 / 5xx / unavailable handling', () => {
  it('throws GeocodingUnavailableError (never falls through to "not found") on 429 (daily free-tier quota exceeded)', async () => {
    mockFetchOnce(() => ({ ok: false, status: 429, json: async () => ({}) }));

    await expect(geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true }))
      .rejects.toThrow(GeocodingUnavailableError);
  });

  it('throws GeocodingUnavailableError on a 5xx from Geocodio\'s own service', async () => {
    mockFetchOnce(() => ({ ok: false, status: 500, json: async () => ({}) }));

    await expect(geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true }))
      .rejects.toThrow(GeocodingUnavailableError);
  });

  it('throws GeocodingUnavailableError on 429 during reverse-geocode pin verification too', async () => {
    mockFetchOnce(() => ({ ok: false, status: 429, json: async () => ({}) }));

    await expect(verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON')).rejects.toThrow(GeocodingUnavailableError);
  });

  it('stops immediately on 429 from the structured query -- never attempts the free-text fallback', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return { ok: false, status: 429, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    await expect(geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true }))
      .rejects.toThrow(GeocodingUnavailableError);
    expect(callCount).toBe(1);
  });
});

describe('Geocodio provider: missing/invalid API key behavior', () => {
  it('throws GeocodingConfigError synchronously (no fetch attempted at all) when GEOCODIO_API_KEY is not set', async () => {
    delete process.env.GEOCODIO_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true }))
      .rejects.toThrow(GeocodingConfigError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws GeocodingConfigError synchronously when GEOCODIO_API_KEY is set but blank', async () => {
    process.env.GEOCODIO_API_KEY = '   ';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true }))
      .rejects.toThrow(GeocodingConfigError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws GeocodingConfigError (a subclass of GeocodingUnavailableError, so existing catch sites still work) when Geocodio rejects the key with a 403', async () => {
    mockFetchOnce(() => ({ ok: false, status: 403, json: async () => ({ error: 'Invalid API key' }) }));

    const err = await geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true }).catch((e) => e);

    expect(err).toBeInstanceOf(GeocodingConfigError);
    expect(err).toBeInstanceOf(GeocodingUnavailableError);
  });

  it('also throws GeocodingConfigError for a missing key during reverse-geocode pin verification', async () => {
    delete process.env.GEOCODIO_API_KEY;

    await expect(verifyConfirmedPinLocation(42.31, -83.05, 'Windsor', 'ON')).rejects.toThrow(GeocodingConfigError);
  });
});
