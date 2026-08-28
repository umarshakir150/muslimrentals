/**
 * Regression coverage for GET /users/me/listings.
 *
 * This route previously returned the raw Prisma result, which left
 * `amenities` as `{ name: string }[]` instead of `string[]` and omitted the
 * `user` relation entirely — both of which crashed the shared ListingDetail
 * frontend component ("Objects are not valid as a React child") whenever a
 * listing had at least one amenity, and always hid the owner-only controls
 * (Delete) for a listing viewed from My Listings. This test locks in the
 * corrected response shape so this endpoint can't silently diverge again
 * from the pattern already used by GET /users/me/saved and GET /listings.
 *
 * Prisma is mocked — there is no test database wired up in this repo yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';

const findManyListingMock = vi.fn();
const findUniqueUserMock  = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    listing: {
      findMany: (...args: any[]) => findManyListingMock(...args),
    },
    user: {
      findUnique: (...args: any[]) => findUniqueUserMock(...args),
    },
  },
}));

function signToken(userId: string) {
  return jwt.sign({ userId, email: 'owner@example.com', role: 'USER' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function activeUser(id: string) {
  return { id, email: 'owner@example.com', role: 'USER', name: 'Owner', isActive: true, isBanned: false };
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

describe('GET /users/me/listings', () => {
  beforeEach(() => {
    findManyListingMock.mockReset();
    findUniqueUserMock.mockReset();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/users/me/listings');

    expect(res.status).toBe(401);
    expect(findManyListingMock).not.toHaveBeenCalled();
  });

  it('returns amenities as a flat string array and includes the owner relation', async () => {
    findUniqueUserMock.mockResolvedValue(activeUser(OWNER_ID));
    findManyListingMock.mockResolvedValue([
      {
        id: 'listing-1',
        userId: OWNER_ID,
        title: 'Sunny room near the mosque',
        images: [{ id: 'img-1', url: 'https://cdn.example.com/img-1.jpg' }],
        amenities: [{ name: 'WiFi' }, { name: 'Parking' }],
        user: { id: OWNER_ID, name: 'Owner', avatarUrl: null },
        _count: { savedBy: 2 },
      },
    ]);

    const app = await buildApp();
    const res = await request(app)
      .get('/api/v1/users/me/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);

    const listing = res.body.data[0];
    // Must be a plain string array, not [{ name: 'WiFi' }, ...] — the shape
    // that previously crashed ListingDetail's `amenities.map(a => <span>{a}</span>)`.
    expect(listing.amenities).toEqual(['WiFi', 'Parking']);
    expect(listing.amenities.every((a: unknown) => typeof a === 'string')).toBe(true);

    // The owner relation must be present so ListingDetail's
    // `isOwner = user?.id === listing.user?.id` check works for the caller's
    // own listings (previously always false, hiding the Delete button).
    expect(listing.user).toMatchObject({ id: OWNER_ID, name: 'Owner' });

    expect(listing.thumbnailUrl).toBe('https://cdn.example.com/img-1.jpg');
  });

  it('still renders a listing with zero amenities correctly', async () => {
    findUniqueUserMock.mockResolvedValue(activeUser(OWNER_ID));
    findManyListingMock.mockResolvedValue([
      {
        id: 'listing-2',
        userId: OWNER_ID,
        title: 'Bare room, no amenities listed',
        images: [],
        amenities: [],
        user: { id: OWNER_ID, name: 'Owner', avatarUrl: null },
        _count: { savedBy: 0 },
      },
    ]);

    const app = await buildApp();
    const res = await request(app)
      .get('/api/v1/users/me/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].amenities).toEqual([]);
    expect(res.body.data[0].thumbnailUrl).toBeNull();
    expect(res.body.data[0].user).toMatchObject({ id: OWNER_ID });
  });

  it('only returns listings belonging to the authenticated user', async () => {
    findUniqueUserMock.mockResolvedValue(activeUser(OWNER_ID));
    findManyListingMock.mockResolvedValue([]);

    const app = await buildApp();
    await request(app)
      .get('/api/v1/users/me/listings')
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`);

    expect(findManyListingMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: OWNER_ID } })
    );
  });
});
