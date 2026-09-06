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
import { geocodeAddress, verifyConfirmedPinLocation, GeocodingUnavailableError, GeocodingConfigError } from '../../src/utils/geocode';

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
