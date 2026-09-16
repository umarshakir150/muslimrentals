/**
 * Coverage for gating Listing.contactInfo (phone/WhatsApp/email) behind
 * authentication: a fully anonymous request to browse or the detail page
 * previously received it in the raw JSON response, making every landlord's
 * contact info trivially scrapeable at scale via a plain, paginated,
 * unauthenticated crawl. See stripContactInfoIfAnonymous in
 * routes/listings.ts for the actual redaction logic. This mirrors
 * listingsLocationPrivacy.test.ts's structure and mocking approach.
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

const LISTING_ID = '77777777-7777-4777-8777-777777777777';
const OWNER_ID = '88888888-8888-4888-8888-888888888888';
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';

const REAL_CONTACT_INFO = '555-0100 or landlord@example.com';

function baseListing(overrides: Record<string, any> = {}) {
  return {
    id: LISTING_ID, title: 'Cozy 2BR', status: 'ACTIVE',
    lat: 43.6532, lng: -79.3832, address: '123 Real Street', userId: OWNER_ID,
    contactInfo: REAL_CONTACT_INFO,
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

describe('GET /listings (browse) -- contactInfo only for authenticated viewers', () => {
  it('an anonymous request never receives contactInfo at all', async () => {
    findManyMock.mockResolvedValue([baseListing()]);
    const app = await buildApp();

    const res = await request(app).get('/api/v1/listings');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('contactInfo');
  });

  it('a logged-in USER (not the owner) still receives the real contactInfo', async () => {
    findManyMock.mockResolvedValue([baseListing()]);
    userFindUniqueMock.mockResolvedValue(activeUser(OTHER_USER_ID, 'USER'));
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/listings')
      .set('Authorization', `Bearer ${signToken(OTHER_USER_ID, 'USER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].contactInfo).toBe(REAL_CONTACT_INFO);
  });
});

describe('GET /listings/:id -- contactInfo only for authenticated viewers', () => {
  it('an anonymous (unauthenticated) viewer never receives contactInfo at all', async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    const app = await buildApp();

    const res = await request(app).get(`/api/v1/listings/${LISTING_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('contactInfo');
  });

  it('a logged-in USER who is not the owner still receives the real contactInfo', async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    userFindUniqueMock.mockResolvedValue(activeUser(OTHER_USER_ID, 'USER'));
    const app = await buildApp();

    const res = await request(app)
      .get(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OTHER_USER_ID, 'USER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.contactInfo).toBe(REAL_CONTACT_INFO);
  });

  it("the listing's own owner still receives the real contactInfo", async () => {
    findUniqueMock.mockResolvedValue(baseListing());
    userFindUniqueMock.mockResolvedValue(activeUser(OWNER_ID, 'USER'));
    const app = await buildApp();

    const res = await request(app)
      .get(`/api/v1/listings/${LISTING_ID}`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID, 'USER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.contactInfo).toBe(REAL_CONTACT_INFO);
  });

  it('other fields (title, price, amenities) are still returned in full for an anonymous viewer -- only contactInfo is gated', async () => {
    findUniqueMock.mockResolvedValue(baseListing({ price: 1500, amenities: [{ name: 'Parking' }] }));
    const app = await buildApp();

    const res = await request(app).get(`/api/v1/listings/${LISTING_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Cozy 2BR');
    expect(res.body.data.price).toBe(1500);
    expect(res.body.data.amenities).toEqual(['Parking']);
    expect(res.body.data).not.toHaveProperty('contactInfo');
  });
});
