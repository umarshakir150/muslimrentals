/**
 * Regression coverage for a leak found while auditing every public
 * listing/map/detail endpoint for address/coordinate exposure (per the
 * privacy-safe location milestone): GET /users/me/saved returned each saved
 * listing's real address and precise lat/lng verbatim (`...s.listing`),
 * even though a listing being saved by the current user doesn't make it
 * theirs -- it's someone else's listing they bookmarked while browsing, and
 * browsing never gets exact location (see listingsLocationPrivacy.test.ts
 * for the equivalent GET /listings coverage this mirrors).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const VIEWER_ID = '77777777-7777-4777-8777-777777777777';
const OWNER_ID = '88888888-8888-4888-8888-888888888888';
const LISTING_ID = '99999999-9999-4999-8999-999999999999';

const REAL_LAT = 43.6532;
const REAL_LNG = -79.3832;
const REAL_ADDRESS = '123 Real Street, Unit 4';

const savedListingFindManyMock = vi.fn();
const userFindUniqueMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    savedListing: {
      findMany: (...args: any[]) => savedListingFindManyMock(...args),
    },
    user: { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
  },
}));

function signToken(userId: string, role: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function activeUser(id: string, role: string) {
  return { id, email: `${id}@example.com`, role, name: 'Person', isActive: true, isBanned: false };
}

async function buildApp() {
  vi.resetModules();
  const { default: userRoutes } = await import('../../src/routes/users');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/users', userRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  savedListingFindManyMock.mockReset();
  userFindUniqueMock.mockReset();
});

describe('GET /users/me/saved -- redacts the saved listing\'s location, even for its own owner', () => {
  it('never includes address, and lat/lng differ from the real stored values', async () => {
    savedListingFindManyMock.mockResolvedValue([
      {
        listing: {
          id: LISTING_ID, title: 'Cozy 2BR',
          lat: REAL_LAT, lng: REAL_LNG, address: REAL_ADDRESS, userId: OWNER_ID,
          images: [], amenities: [],
          user: { id: OWNER_ID, name: 'Owner', avatarUrl: null },
        },
      },
    ]);
    userFindUniqueMock.mockResolvedValue(activeUser(VIEWER_ID, 'USER'));
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/users/me/saved')
      .set('Authorization', `Bearer ${signToken(VIEWER_ID, 'USER')}`);

    expect(res.status).toBe(200);
    const l = res.body.data[0];
    expect(l).not.toHaveProperty('address');
    expect(l.lat).not.toBe(REAL_LAT);
    expect(l.lng).not.toBe(REAL_LNG);
    expect(l.locationApproximate).toBe(true);
    expect(l.isSaved).toBe(true);
  });

  it('redacts even in the edge case where the viewer saved their own listing', async () => {
    savedListingFindManyMock.mockResolvedValue([
      {
        listing: {
          id: LISTING_ID, title: 'Cozy 2BR',
          lat: REAL_LAT, lng: REAL_LNG, address: REAL_ADDRESS, userId: VIEWER_ID,
          images: [], amenities: [],
          user: { id: VIEWER_ID, name: 'Self', avatarUrl: null },
        },
      },
    ]);
    userFindUniqueMock.mockResolvedValue(activeUser(VIEWER_ID, 'USER'));
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/users/me/saved')
      .set('Authorization', `Bearer ${signToken(VIEWER_ID, 'USER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('address');
    expect(res.body.data[0].lat).not.toBe(REAL_LAT);
  });

  it('the approximate point is stable across two separate requests', async () => {
    const row = {
      listing: {
        id: LISTING_ID, title: 'Cozy 2BR',
        lat: REAL_LAT, lng: REAL_LNG, address: REAL_ADDRESS, userId: OWNER_ID,
        images: [], amenities: [],
        user: { id: OWNER_ID, name: 'Owner', avatarUrl: null },
      },
    };
    savedListingFindManyMock.mockResolvedValue([row]);
    userFindUniqueMock.mockResolvedValue(activeUser(VIEWER_ID, 'USER'));
    const app = await buildApp();

    const res1 = await request(app).get('/api/v1/users/me/saved').set('Authorization', `Bearer ${signToken(VIEWER_ID, 'USER')}`);
    const res2 = await request(app).get('/api/v1/users/me/saved').set('Authorization', `Bearer ${signToken(VIEWER_ID, 'USER')}`);

    expect(res1.body.data[0].lat).toBe(res2.body.data[0].lat);
    expect(res1.body.data[0].lng).toBe(res2.body.data[0].lng);
  });
});
