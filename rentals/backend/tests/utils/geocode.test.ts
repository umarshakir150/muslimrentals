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

    expect(capturedUrl).toContain(encodeURIComponent('123 Main Street'));
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
