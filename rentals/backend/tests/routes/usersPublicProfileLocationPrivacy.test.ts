/**
 * Coverage for GET /users/:id (the fully public, unauthenticated profile
 * route) applying the same privacy-safe approximate listing location as
 * the browse/detail listing endpoints -- see utils/geo.ts's
 * toPublicListingLocation (unit-tested on its own in tests/utils/geo.test.ts)
 * and listingsLocationPrivacy.test.ts for the listings-route coverage this
 * mirrors.
 *
 * Prisma is mocked -- there is no test database wired up in this repo yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const OWNER_ID = '44444444-4444-4444-8444-444444444444';
const LISTING_ID = '33333333-3333-4333-8333-333333333333';
const REAL_LAT = 43.6532;
const REAL_LNG = -79.3832;
const REAL_ADDRESS = '123 Real Street, Unit 4';

const userFindUniqueMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
  },
}));

async function buildApp() {
  vi.resetModules();
  const { default: usersRoutes } = await import('../../src/routes/users');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/users', usersRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  userFindUniqueMock.mockReset();
});

describe('GET /users/:id (public profile) -- redacts each listing\'s location', () => {
  it('never includes address, and lat/lng differ from the real stored values', async () => {
    userFindUniqueMock.mockResolvedValue({
      id: OWNER_ID, name: 'Owner', avatarUrl: null, bio: null, createdAt: new Date(),
      listings: [{
        id: LISTING_ID, title: 'Cozy 2BR', lat: REAL_LAT, lng: REAL_LNG, address: REAL_ADDRESS,
        images: [],
      }],
    });
    const app = await buildApp();

    const res = await request(app).get(`/api/v1/users/${OWNER_ID}`);

    expect(res.status).toBe(200);
    const listing = res.body.data.listings[0];
    expect(listing).not.toHaveProperty('address');
    expect(listing.lat).not.toBe(REAL_LAT);
    expect(listing.lng).not.toBe(REAL_LNG);
    expect(listing.locationApproximate).toBe(true);
  });

  it('is stable across repeated requests for the same profile', async () => {
    userFindUniqueMock.mockResolvedValue({
      id: OWNER_ID, name: 'Owner', avatarUrl: null, bio: null, createdAt: new Date(),
      listings: [{
        id: LISTING_ID, title: 'Cozy 2BR', lat: REAL_LAT, lng: REAL_LNG, address: REAL_ADDRESS,
        images: [],
      }],
    });
    const app = await buildApp();

    const res1 = await request(app).get(`/api/v1/users/${OWNER_ID}`);
    const res2 = await request(app).get(`/api/v1/users/${OWNER_ID}`);

    expect(res1.body.data.listings[0].lat).toBe(res2.body.data.listings[0].lat);
  });

  it('handles a profile with no listings without error', async () => {
    userFindUniqueMock.mockResolvedValue({
      id: OWNER_ID, name: 'Owner', avatarUrl: null, bio: null, createdAt: new Date(),
      listings: [],
    });
    const app = await buildApp();

    const res = await request(app).get(`/api/v1/users/${OWNER_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.listings).toEqual([]);
  });

  it('404s for a nonexistent user without ever touching the redaction logic', async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app).get(`/api/v1/users/${OWNER_ID}`);

    expect(res.status).toBe(404);
  });
});
