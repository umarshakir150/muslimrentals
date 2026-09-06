/**
 * Coverage for GET /listings' keyword search (title/description/
 * neighbourhood/city, case-insensitive, partial match). The query-building
 * itself long pre-dates this milestone; these tests were added because
 * nothing previously proved it actually worked end to end, especially for
 * description text -- the founder's explicit top priority for this feature.
 *
 * Prisma is mocked -- there is no test database in this repo. A small,
 * generic where-clause interpreter (limited to exactly the two patterns
 * this route emits: a top-level equality and an OR array of
 * `{ field: { contains, mode: 'insensitive' } }`) stands in for Postgres,
 * so these tests prove the route asks for the right things AND that doing
 * so actually returns/excludes the expected fixture rows -- not just that
 * some `where.OR` array with the right shape was constructed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

function fixture(overrides: Record<string, any>) {
  return {
    id: 'listing-x', status: 'ACTIVE', userId: 'owner-1',
    lat: 43.6532, lng: -79.3832, address: null,
    images: [], amenities: [], _count: { savedBy: 0 },
    user: { id: 'owner-1', name: 'Owner', avatarUrl: null },
    ...overrides,
  };
}

const FIXTURES = [
  fixture({ id: 'basement-suite', title: 'Bright Basement Suite', description: 'A cozy furnished apartment near transit.', city: 'Toronto', neighbourhood: 'Downtown' }),
  fixture({ id: 'sunny-loft', title: 'Sunny Loft', description: 'Spacious loft with a rooftop deck and BASEMENT storage locker.', city: 'Vancouver', neighbourhood: 'Yaletown' }),
  fixture({ id: 'quiet-room', title: 'Quiet Room for Rent', description: 'A calm room in a shared house.', city: 'Ottawa', neighbourhood: null }),
];

// Handles exactly one condition shape: a single `{ field: { contains, mode } }`
// entry, as found inside the route's `where.OR` array.
function matchesContainsCondition(listing: any, condition: Record<string, { contains: string }>): boolean {
  return Object.entries(condition).every(([field, spec]) => {
    const value = listing[field];
    if (value == null) return false;
    return String(value).toLowerCase().includes(String(spec.contains).toLowerCase());
  });
}

function matchesWhere(listing: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, spec]) => {
    if (key === 'status') return listing.status === spec;
    if (key === 'OR') return (spec as any[]).some((c) => matchesContainsCondition(listing, c));
    return true; // other unrelated where-clause keys (city, audience, price range, etc.) not exercised here
  });
}

const findManyMock = vi.fn();
const countMock = vi.fn();

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
  countMock.mockReset().mockResolvedValue(0);
  findManyMock.mockImplementation(({ where }: any) => {
    const matched = FIXTURES.filter((l) => matchesWhere(l, where));
    return Promise.resolve(matched);
  });
});

describe('GET /listings?keyword= -- searches title, description, and city', () => {
  it('matches on the title', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/listings').query({ keyword: 'Sunny Loft' });

    expect(res.status).toBe(200);
    expect(res.body.data.map((l: any) => l.id)).toEqual(['sunny-loft']);
  });

  it('matches on the description -- the top priority for this feature', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/listings').query({ keyword: 'rooftop deck' });

    expect(res.status).toBe(200);
    expect(res.body.data.map((l: any) => l.id)).toEqual(['sunny-loft']);
  });

  it('matches on the city', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/listings').query({ keyword: 'Ottawa' });

    expect(res.status).toBe(200);
    expect(res.body.data.map((l: any) => l.id)).toEqual(['quiet-room']);
  });

  it('is case-insensitive', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/listings').query({ keyword: 'BASEMENT SUITE' });

    expect(res.status).toBe(200);
    expect(res.body.data.map((l: any) => l.id)).toEqual(['basement-suite']);
  });

  it('matches on a partial substring, not just whole words', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/listings').query({ keyword: 'base' });

    expect(res.status).toBe(200);
    // Matches both "Basement Suite" (title) and "BASEMENT storage locker" (description)
    expect(res.body.data.map((l: any) => l.id).sort()).toEqual(['basement-suite', 'sunny-loft']);
  });

  it('returns an empty result set (not an error) when nothing matches', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/listings').query({ keyword: 'nonexistent-xyz-keyword' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('builds the expected case-insensitive/partial OR clause shape across title, description, neighbourhood, and city', async () => {
    const app = await buildApp();
    await request(app).get('/api/v1/listings').query({ keyword: 'basement' });

    const whereArg = findManyMock.mock.calls[0][0].where;
    expect(whereArg.OR).toEqual(expect.arrayContaining([
      { title:         { contains: 'basement', mode: 'insensitive' } },
      { description:   { contains: 'basement', mode: 'insensitive' } },
      { neighbourhood: { contains: 'basement', mode: 'insensitive' } },
      { city:          { contains: 'basement', mode: 'insensitive' } },
    ]));
  });
});
