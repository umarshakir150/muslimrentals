/**
 * Regression coverage for listing visibility once a listing's status can be
 * BANNED (set by /admin/users/:id/ban on every ACTIVE listing the banned
 * user owns -- see adminModeration.test.ts for that transaction). Public
 * endpoints must treat BANNED the same as REMOVED: never returned by browse
 * (also what the map page queries -- same endpoint, no separate route) and
 * a direct 404 on the detail page, so a banned user's listing can't be
 * reached by URL either. Admin/moderation endpoints are untouched -- GET
 * /admin/listings has no default status filter (covered by admin.ts's own
 * behavior, not re-tested here).
 *
 * Prisma is mocked -- there is no test database wired up in this repo yet
 * (same established pattern as listingsPermanentDelete.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const LISTING_ID = '33333333-3333-4333-8333-333333333333';

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
const findUniqueMock = vi.fn();
const updateMock = vi.fn().mockResolvedValue({});

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    listing: {
      findMany:   (...args: any[]) => findManyMock(...args),
      count:      (...args: any[]) => countMock(...args),
      findUnique: (...args: any[]) => findUniqueMock(...args),
      update:     (...args: any[]) => updateMock(...args),
    },
    savedListing: { findUnique: vi.fn().mockResolvedValue(null) },
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
  findManyMock.mockReset().mockResolvedValue([]);
  countMock.mockReset().mockResolvedValue(0);
  findUniqueMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
});

describe('GET /listings (browse -- also what the map page queries)', () => {
  it('only ever queries for ACTIVE listings, which structurally excludes BANNED (and every other non-ACTIVE status)', async () => {
    const app = await buildApp();
    await request(app).get('/api/v1/listings');

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'ACTIVE' }),
    }));
  });
});

describe('GET /listings/:id (detail page)', () => {
  it('404s a BANNED listing exactly like a REMOVED one -- not reachable by direct URL either', async () => {
    findUniqueMock.mockResolvedValue({
      id: LISTING_ID, status: 'BANNED', images: [], amenities: [],
      user: { id: 'owner-1', name: 'Owner', avatarUrl: null, createdAt: new Date() },
      _count: { savedBy: 0 },
    });
    const app = await buildApp();
    const res = await request(app).get(`/api/v1/listings/${LISTING_ID}`);

    expect(res.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled(); // no view-count bump on a hidden listing
  });

  it('still 404s a REMOVED listing, unchanged', async () => {
    findUniqueMock.mockResolvedValue({
      id: LISTING_ID, status: 'REMOVED', images: [], amenities: [],
      user: { id: 'owner-1', name: 'Owner', avatarUrl: null, createdAt: new Date() },
      _count: { savedBy: 0 },
    });
    const app = await buildApp();
    const res = await request(app).get(`/api/v1/listings/${LISTING_ID}`);

    expect(res.status).toBe(404);
  });

  it('still serves an ACTIVE listing normally (control case, unaffected by the BANNED status)', async () => {
    findUniqueMock.mockResolvedValue({
      id: LISTING_ID, status: 'ACTIVE', images: [], amenities: [],
      lat: 43.6532, lng: -79.3832, userId: 'owner-1',
      user: { id: 'owner-1', name: 'Owner', avatarUrl: null, createdAt: new Date() },
      _count: { savedBy: 0 },
    });
    const app = await buildApp();
    const res = await request(app).get(`/api/v1/listings/${LISTING_ID}`);

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ where: { id: LISTING_ID }, data: { viewCount: { increment: 1 } } });
  });
});
