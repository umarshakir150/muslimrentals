/**
 * Coverage for the privacy-safe approximate listing location introduced
 * alongside the map milestone: public listing responses (browse, and the
 * detail page for anyone but the owner/staff) must never carry a listing's
 * real address or precise coordinates -- see utils/geo.ts's
 * toPublicListingLocation for the actual redaction logic (unit-tested on
 * its own in tests/utils/geo.test.ts). This file proves the *routes* apply
 * it in the right places and only there.
 *
 * Prisma is mocked -- there is no test database wired up in this repo yet
 * (same established pattern as listingsPublicVisibility.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const LISTING_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555';
const ADMIN_ID = '66666666-6666-4666-8666-666666666666';

const REAL_LAT = 43.6532;
const REAL_LNG = -79.3832;
const REAL_ADDRESS = '123 Real Street, Unit 4';

function baseListing(overrides: Record<string, any> = {}) {
  return {
    id: LISTING_ID, title: 'Cozy 2BR', status: 'ACTIVE',
    lat: REAL_LAT, lng: REAL_LNG, address: REAL_ADDRESS, userId: OWNER_ID,
    images: [], amenities: [],
    user: { id: OWNER_ID, name: 'Owner', avatarUrl: null, createdAt: new Date() },
    _count: { savedBy: 0 },
    ...overrides,
  };
}

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
const findUniqueMock = vi.fn();
const updateMock = vi.fn().mockResolvedValue({});
const userFindUniqueMock = vi.fn(); // authenticate()/optionalAuth()'s own lookup

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    listing: {
      findMany:   (...args: any[]) => findManyMock(...args),
      count:      (...args: any[]) => countMock(...args),
      findUnique: (...args: any[]) => findUniqueMock(...args),
      update:     (...args: any[]) => updateMock(...args),
    },
    savedListing: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany:   vi.fn().mockResolvedValue([]),
    },
    user:         { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
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
  const { default: listingRoutes } = await import('../../src/routes/listings');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/listings', listingRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
  countMock.mockReset().mockResolvedValue(0);
  findUniqueMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
  userFindUniqueMock.mockReset();
});

describe('GET /listings (browse) -- always redacts location', () => {
  it('never includes address, and lat/lng differ from the real stored values', async () => {
    findManyMock.mockResolvedValue([baseListing()]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/listings');

    expect(res.status).toBe(200);
    const l = res.body.data[0];
    expect(l).not.toHaveProperty('address');
    expect(l.lat).not.toBe(REAL_LAT);
    expect(l.lng).not.toBe(REAL_LNG);
    expect(l.locationApproximate).toBe(true);
    expect(typeof l.locationPrecisionRadiusM).toBe('number');
  });

  it('redacts even when the request is authenticated as the listing\'s own owner (browse is never "my listings")', async () => {
    findManyMock.mockResolvedValue([baseListing()]);
    userFindUniqueMock.mockResolvedValue(activeUser(OWNER_ID, 'USER'));
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID, 'USER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('address');
    expect(res.body.data[0].lat).not.toBe(REAL_LAT);
  });
});

describe('GET /listings/:id -- redacts for everyone except the owner and staff', () => {
  it('an anonymous (unauthenticated) viewer gets the approximate location, no address', async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    const app = await buildApp();

    const res = await request(app).get(`/api/v1/listings/${LISTING_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('address');
    expect(res.body.data.lat).not.toBe(REAL_LAT);
    expect(res.body.data.locationApproximate).toBe(true);
  });

  it('a logged-in USER who is not the owner gets the approximate location too', async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    userFindUniqueMock.mockResolvedValue(activeUser(OTHER_USER_ID, 'USER'));
    const app = await buildApp();

    const res = await request(app)
      .get(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OTHER_USER_ID, 'USER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('address');
    expect(res.body.data.lat).not.toBe(REAL_LAT);
  });

  it('the listing\'s own owner sees the real address and exact coordinates', async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    userFindUniqueMock.mockResolvedValue(activeUser(OWNER_ID, 'USER'));
    const app = await buildApp();

    const res = await request(app)
      .get(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID, 'USER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe(REAL_ADDRESS);
    expect(res.body.data.lat).toBe(REAL_LAT);
    expect(res.body.data.lng).toBe(REAL_LNG);
    expect(res.body.data.locationApproximate).toBeUndefined();
  });

  it('ADMIN sees the real address and exact coordinates (moderation context)', async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    userFindUniqueMock.mockResolvedValue(activeUser(ADMIN_ID, 'ADMIN'));
    const app = await buildApp();

    const res = await request(app)
      .get(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe(REAL_ADDRESS);
    expect(res.body.data.lat).toBe(REAL_LAT);
  });

  it('MODERATOR sees the real address and exact coordinates (moderation context)', async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    userFindUniqueMock.mockResolvedValue(activeUser(ADMIN_ID, 'MODERATOR'));
    const app = await buildApp();

    const res = await request(app)
      .get(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'MODERATOR')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe(REAL_ADDRESS);
    expect(res.body.data.lat).toBe(REAL_LAT);
  });

  it('the same listing\'s approximate point is identical across two separate anonymous requests (stable, not re-randomized)', async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    const app = await buildApp();

    const res1 = await request(app).get(`/api/v1/listings/${LISTING_ID}`);
    const res2 = await request(app).get(`/api/v1/listings/${LISTING_ID}`);

    expect(res1.body.data.lat).toBe(res2.body.data.lat);
    expect(res1.body.data.lng).toBe(res2.body.data.lng);
  });
});
