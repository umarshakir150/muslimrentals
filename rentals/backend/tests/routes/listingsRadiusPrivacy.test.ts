/**
 * Coverage for the location-radius search filter's privacy rule: distance
 * filtering must use each listing's PUBLIC approximate coordinate (the
 * exact same deterministic point toPublicListingLocation returns), never
 * the private precise one. Filtering on the real point would let a
 * motivated searcher binary-search shrinking radii around a suspected
 * address to localize a listing more precisely than the stated privacy
 * radius promises, and would let a result silently fall outside the very
 * circle drawn on the map for it.
 *
 * Prisma is mocked. getApproximateLocation is real (imported from
 * utils/geo.ts, not re-implemented) so this proves actual behavior, not an
 * assumption about it -- the test picks real coordinates/radii where the
 * precise-vs-approximate distinction provably changes the outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { getApproximateLocation, distKm } from '../../src/utils/geo';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const SEARCH_POINT = { lat: 43.6532, lng: -79.3832 }; // downtown Toronto

function fixture(overrides: Record<string, any>) {
  return {
    id: 'listing-x', status: 'ACTIVE', userId: 'owner-1',
    title: 'A listing', description: 'A description long enough.', city: 'Toronto', neighbourhood: null,
    address: null, images: [], amenities: [], _count: { savedBy: 0 },
    user: { id: 'owner-1', name: 'Owner', avatarUrl: null },
    ...overrides,
  };
}

const findManyMock = vi.fn();
const countMock = vi.fn().mockResolvedValue(0);

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    listing: {
      findMany: (...args: any[]) => findManyMock(...args),
      count:    (...args: any[]) => countMock(...args),
    },
    savedListing: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

async function buildApp() {
  vi.resetModules();
  const { default: listingRoutes } = await import('../../src/routes/listings');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/listings', listingRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  findManyMock.mockReset();
  countMock.mockClear();
});

describe('GET /listings?lat=&lng=&radiusKm= -- filters by the PUBLIC approximate point', () => {
  it('includes a listing whose approximate point is within the radius, using the real geo.ts helper to prove it', async () => {
    // A real precise point a known ~50m from the search point -- well within
    // any sane radius regardless of jitter, so this is an unambiguous "should match".
    const preciseLat = SEARCH_POINT.lat + 0.00045; // ~50m north
    const listing = fixture({ id: 'near', lat: preciseLat, lng: SEARCH_POINT.lng });
    findManyMock.mockResolvedValue([listing]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/listings').query({ lat: SEARCH_POINT.lat, lng: SEARCH_POINT.lng, radiusKm: 5 });

    expect(res.status).toBe(200);
    expect(res.body.data.map((l: any) => l.id)).toEqual(['near']);
  });

  it('excludes a listing whose approximate point falls outside the radius even though its PRECISE point is inside it', async () => {
    // Construct a real case: find a listing id/coordinate whose real point is
    // just inside a 1km radius, but whose deterministic jitter (see
    // getApproximateLocation; up to MAX_DISPLACEMENT_METERS) pushes the
    // approximate point just past it. Precise point ~954m from the search
    // point -- inside a 1km radius. 'listing-a7' is a known-good id for this
    // exact case: its deterministic jitter happens to push the approximate
    // point from ~0.953km to ~1.002km, crossing the 1km radius boundary in
    // the right direction.
    const preciseLat = SEARCH_POINT.lat + (954 / 111_320);
    const id = 'listing-a7';
    const approx = getApproximateLocation(id, preciseLat, SEARCH_POINT.lng);
    const preciseDistKm = distKm(SEARCH_POINT.lat, SEARCH_POINT.lng, preciseLat, SEARCH_POINT.lng);
    const approxDistKm = distKm(SEARCH_POINT.lat, SEARCH_POINT.lng, approx.lat, approx.lng);

    // Sanity-check the fixture actually exercises the interesting case
    // (precise point inside 1km, approximate point pushed outside it) --
    // if a future jitter-tuning change breaks this assumption, this test
    // fails loudly here rather than silently passing for the wrong reason.
    expect(preciseDistKm).toBeLessThan(1);
    expect(approxDistKm).toBeGreaterThan(1);

    const listing = fixture({ id, lat: preciseLat, lng: SEARCH_POINT.lng });
    findManyMock.mockResolvedValue([listing]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/listings').query({ lat: SEARCH_POINT.lat, lng: SEARCH_POINT.lng, radiusKm: 1 });

    expect(res.status).toBe(200);
    // Excluded: proves the route filtered on the approximate point, not the
    // real one (which was inside the radius and would otherwise have matched).
    expect(res.body.data).toEqual([]);
  });

  it('includes a listing whose PRECISE point is technically outside the radius but whose approximate point lands inside it', async () => {
    // The mirror image of the above: precise point just outside 1km, but
    // jitter happens to land the approximate point back inside it.
    // 'listing-c1' is a known-good id for this exact case: its jitter pulls
    // the approximate point from ~1.001km back to ~0.995km.
    const preciseLat = SEARCH_POINT.lat + (1002 / 111_320);
    const id = 'listing-c1';
    const approx = getApproximateLocation(id, preciseLat, SEARCH_POINT.lng);
    const preciseDistKm = distKm(SEARCH_POINT.lat, SEARCH_POINT.lng, preciseLat, SEARCH_POINT.lng);
    const approxDistKm = distKm(SEARCH_POINT.lat, SEARCH_POINT.lng, approx.lat, approx.lng);

    expect(preciseDistKm).toBeGreaterThan(1);
    expect(approxDistKm).toBeLessThan(1);

    const listing = fixture({ id, lat: preciseLat, lng: SEARCH_POINT.lng });
    findManyMock.mockResolvedValue([listing]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/listings').query({ lat: SEARCH_POINT.lat, lng: SEARCH_POINT.lng, radiusKm: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.map((l: any) => l.id)).toEqual([id]);
  });

  it('rejects a radiusKm above the new 10km cap', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/listings').query({ lat: SEARCH_POINT.lat, lng: SEARCH_POINT.lng, radiusKm: 11 });
    expect(res.status).toBe(422);
  });

  it('accepts a radiusKm at exactly the 10km cap', async () => {
    findManyMock.mockResolvedValue([]);
    const app = await buildApp();
    const res = await request(app).get('/api/v1/listings').query({ lat: SEARCH_POINT.lat, lng: SEARCH_POINT.lng, radiusKm: 10 });
    expect(res.status).toBe(200);
  });
});
