/**
 * Coverage for GET /geocode (single-result lookup) and GET /geocode/suggestions
 * (multi-result autocomplete, backing the Browse location-search widget) --
 * both ad-hoc place/address search endpoints. Built on the same
 * utils/geocode.ts helpers listing creation uses (mocked here); their own
 * success/failure-mode behavior is covered in tests/utils/geocode.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const geocodeAddressMock = vi.fn();
const searchPlacesMock = vi.fn();
const resolvePlaceMock = vi.fn();
class GeocodingUnavailableError extends Error {}
vi.mock('../../src/utils/geocode', () => ({
  geocodeAddress: (...args: any[]) => geocodeAddressMock(...args),
  searchPlaces: (...args: any[]) => searchPlacesMock(...args),
  resolvePlace: (...args: any[]) => resolvePlaceMock(...args),
  GeocodingUnavailableError,
}));

async function buildApp() {
  vi.resetModules();
  const { default: geocodeRoutes } = await import('../../src/routes/geocode');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/geocode', geocodeRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  geocodeAddressMock.mockReset();
  searchPlacesMock.mockReset();
  resolvePlaceMock.mockReset();
});

describe('GET /geocode', () => {
  it('resolves a free-text place search to coordinates', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 43.773, lng: -79.257 });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Scarborough' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ lat: 43.773, lng: -79.257 });
    expect(geocodeAddressMock).toHaveBeenCalledWith('Scarborough', '');
  });

  it('never requires or accepts a city/province -- one free-text field is enough', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 1, lng: 2 });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Anywhere', city: 'Toronto' });

    // `city` is an unrecognized field for this schema -- .strict() isn't used
    // here (no mass-assignment risk on a read-only lookup), but the route
    // must still ignore it and only ever pass the single `q` value through.
    expect(res.status).toBe(200);
    expect(geocodeAddressMock).toHaveBeenCalledWith('Anywhere', '');
  });

  it('returns 404 with a clear message when the place cannot be found', async () => {
    geocodeAddressMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Nonexistent Fake Place 99999' });

    expect(res.status).toBe(404);
    expect(geocodeAddressMock).toHaveBeenCalled();
  });

  // Regression coverage: the geocoding provider being rate-limited used to
  // be indistinguishable from "no match" (both surfaced as a plain 404
  // "could not find that location"), misleading the searcher into thinking
  // their query was wrong when the real problem was the provider itself.
  it('returns a distinct 503 (never the generic 404) when the geocoding provider is rate-limited', async () => {
    geocodeAddressMock.mockRejectedValue(new GeocodingUnavailableError());
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Some Real Place' });

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/temporarily unavailable/i);
  });

  it('rejects a query shorter than 2 characters', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/geocode').query({ q: 'a' });

    expect(res.status).toBe(422);
    expect(geocodeAddressMock).not.toHaveBeenCalled();
  });

  it('rejects a missing q param', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/geocode');

    expect(res.status).toBe(422);
  });

  it('trims whitespace from the query', async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 1, lng: 2 });
    const app = await buildApp();

    await request(app).get('/api/v1/geocode').query({ q: '  Scarborough  ' });

    expect(geocodeAddressMock).toHaveBeenCalledWith('Scarborough', '');
  });

  it('never stores or persists the search query anywhere (stateless lookup)', async () => {
    // No prisma import at all in the route module -- this test documents
    // and enforces that contract by never mocking prisma/client; if the
    // route ever tried to touch the database, this test file would need a
    // mock for it to even load without throwing, which is the point.
    geocodeAddressMock.mockResolvedValue({ lat: 1, lng: 2 });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode').query({ q: 'Some Place' });

    expect(res.status).toBe(200);
  });
});

// Coverage for the Browse location-search autocomplete's backing endpoint --
// distinct from GET /geocode above (single result, 404 on no match): this
// one returns a LIST (possibly empty) for an as-you-type dropdown. The
// actual "always Nominatim, never Geocodio" provider behavior lives in and
// is tested by tests/utils/geocode.test.ts (searchPlaces is mocked here,
// same as geocodeAddress is above) -- this file only covers the route's own
// request/response contract.
describe('GET /geocode/suggestions', () => {
  it('returns a list of place suggestions for a free-text query', async () => {
    searchPlacesMock.mockResolvedValue([
      { label: 'Toldo Lancer Centre, Windsor, Ontario', lat: 42.3057, lng: -83.0644 },
    ]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode/suggestions').query({ q: 'Toldo Lancer Centre' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { label: 'Toldo Lancer Centre, Windsor, Ontario', lat: 42.3057, lng: -83.0644 },
    ]);
    expect(searchPlacesMock).toHaveBeenCalledWith('Toldo Lancer Centre');
  });

  it('returns multiple candidates for a genuinely ambiguous query, for the renter to disambiguate', async () => {
    searchPlacesMock.mockResolvedValue([
      { label: '123 Main Street, Windsor, Ontario', lat: 42.3, lng: -83.0 },
      { label: '123 Main Street, Toronto, Ontario', lat: 43.6, lng: -79.4 },
    ]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode/suggestions').query({ q: '123 Main Street' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns an empty list (never a 404) when nothing matches -- "no results yet" is a normal autocomplete state', async () => {
    searchPlacesMock.mockResolvedValue([]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode/suggestions').query({ q: 'Nonexistent Fake Place 99999' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns a distinct 503 (never a generic error) when the geocoding provider is rate-limited', async () => {
    searchPlacesMock.mockRejectedValue(new GeocodingUnavailableError());
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode/suggestions').query({ q: 'Some Real Place' });

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/temporarily unavailable/i);
  });

  it('rejects a query shorter than 2 characters', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/geocode/suggestions').query({ q: 'a' });

    expect(res.status).toBe(422);
    expect(searchPlacesMock).not.toHaveBeenCalled();
  });

  it('rejects a missing q param', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/geocode/suggestions');

    expect(res.status).toBe(422);
  });

  it('never leaks a provider API key or raw provider response shape into the response body', async () => {
    searchPlacesMock.mockResolvedValue([{ label: 'Some Place, Ontario', lat: 1, lng: 2 }]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode/suggestions').query({ q: 'Some Place' });

    expect(JSON.stringify(res.body)).not.toMatch(/api_key|GEOCODIO/i);
  });
});

// Coverage for the Browse location-search widget's manual Enter/Search
// action -- distinct from both endpoints above: unlike GET /geocode/suggestions
// this resolves to a SINGLE best location (like GET /geocode), but unlike
// GET /geocode it's built on resolvePlace()/searchPlaces() rather than
// geocodeAddress (see resolvePlace's own doc comment for why). This file
// only covers the route's own request/response contract; resolvePlace is
// mocked here, same as searchPlaces/geocodeAddress are above.
describe('GET /geocode/resolve', () => {
  it('resolves the complete typed text to a single best location', async () => {
    resolvePlaceMock.mockResolvedValue({ lat: 42.3, lng: -83.0 });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode/resolve').query({ q: 'Vincent Massey Secondary School' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ lat: 42.3, lng: -83.0 });
    expect(resolvePlaceMock).toHaveBeenCalledWith('Vincent Massey Secondary School');
  });

  it('returns 404 with a clear message when nothing resolves -- the renter can edit and retry', async () => {
    resolvePlaceMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode/resolve').query({ q: 'Nonexistent Fake Place 99999' });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/could not find/i);
  });

  it('returns a distinct 503 (never the generic 404) when the geocoding provider is rate-limited', async () => {
    resolvePlaceMock.mockRejectedValue(new GeocodingUnavailableError());
    const app = await buildApp();

    const res = await request(app).get('/api/v1/geocode/resolve').query({ q: 'Some Real Place' });

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/temporarily unavailable/i);
  });

  it('rejects a query shorter than 2 characters', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/geocode/resolve').query({ q: 'a' });

    expect(res.status).toBe(422);
    expect(resolvePlaceMock).not.toHaveBeenCalled();
  });

  it('never falls back to geocodeAddress or searchPlaces directly -- always goes through resolvePlace', async () => {
    resolvePlaceMock.mockResolvedValue({ lat: 1, lng: 2 });
    const app = await buildApp();

    await request(app).get('/api/v1/geocode/resolve').query({ q: 'Some Place' });

    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(searchPlacesMock).not.toHaveBeenCalled();
    expect(resolvePlaceMock).toHaveBeenCalledTimes(1);
  });
});
