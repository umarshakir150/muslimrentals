/**
 * Regression coverage for DELETE /listings/:id/permanent (permanent,
 * owner-initiated listing deletion).
 *
 * Prisma and the S3 client are mocked — there is no test database wired up
 * in this repo yet, so these are unit/integration-at-the-route-layer tests,
 * not full end-to-end DB tests. They verify: ownership enforcement (owner
 * succeeds, non-owner is rejected, unauthenticated is rejected), that S3
 * objects backing the listing's images are deleted, and that a subsequent
 * listing query (GET /listings) mocked to reflect the post-delete DB state
 * no longer returns the deleted listing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const OWNER_ID     = '11111111-1111-4111-8111-111111111111';
const OTHER_ID     = '22222222-2222-4222-8222-222222222222';
const LISTING_ID   = '33333333-3333-4333-8333-333333333333';

const findUniqueMock = vi.fn();
const deleteMock     = vi.fn();
const findManyMock   = vi.fn();
const findUniqueUserMock = vi.fn();

vi.mock('../prisma/client', () => ({
  prisma: {
    listing: {
      findUnique: (...args: any[]) => findUniqueMock(...args),
      delete:     (...args: any[]) => deleteMock(...args),
      findMany:   (...args: any[]) => findManyMock(...args),
      count:      vi.fn().mockResolvedValue(0),
      update:     vi.fn(),
    },
    user: {
      findUnique: (...args: any[]) => findUniqueUserMock(...args),
    },
    savedListing: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

const s3SendMock = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = s3SendMock; },
  DeleteObjectCommand: class { constructor(public input: any) {} },
}));

function signToken(userId: string, role: 'USER' | 'ADMIN' = 'USER') {
  return jwt.sign({ userId, email: 'u@example.com', role }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function activeUser(id: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { id, email: 'u@example.com', role, name: 'Test User', isActive: true, isBanned: false };
}

async function buildApp() {
  vi.resetModules();
  const { default: listingRoutes } = await import('./listings');
  const { errorHandler } = await import('../middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/listings', listingRoutes);
  app.use(errorHandler);
  return app;
}

describe('DELETE /listings/:id/permanent', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    deleteMock.mockReset();
    findManyMock.mockReset();
    findUniqueUserMock.mockReset();
    s3SendMock.mockReset();
  });

  afterEach(() => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_S3_BUCKET;
  });

  it('rejects an unauthenticated request with 401 and never touches the DB', async () => {
    const app = await buildApp();
    const res = await request(app).delete(`/api/v1/listings/${LISTING_ID}/permanent`);

    expect(res.status).toBe(401);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('rejects a non-owner with 403 and does not delete the listing', async () => {
    findUniqueUserMock.mockResolvedValue(activeUser(OTHER_ID));
    findUniqueMock.mockResolvedValue({
      id: LISTING_ID,
      userId: OWNER_ID,
      images: [{ id: 'img-1', key: 'listings/abc.jpg' }],
    });

    const app = await buildApp();
    const res = await request(app)
      .delete(`/api/v1/listings/${LISTING_ID}/permanent`)
      .set('Authorization', `Bearer ${signToken(OTHER_ID)}`);

    expect(res.status).toBe(403);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent listing rather than leaking ownership info', async () => {
    findUniqueUserMock.mockResolvedValue(activeUser(OTHER_ID));
    findUniqueMock.mockResolvedValue(null);

    const app = await buildApp();
    const res = await request(app)
      .delete(`/api/v1/listings/${LISTING_ID}/permanent`)
      .set('Authorization', `Bearer ${signToken(OTHER_ID)}`);

    expect(res.status).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('lets the owner permanently delete their listing and cleans up S3 objects', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_S3_BUCKET = 'test-bucket';

    findUniqueUserMock.mockResolvedValue(activeUser(OWNER_ID));
    findUniqueMock.mockResolvedValue({
      id: LISTING_ID,
      userId: OWNER_ID,
      images: [
        { id: 'img-1', key: 'listings/abc.jpg' },
        { id: 'img-2', key: 'listings/def.jpg' },
      ],
    });
    deleteMock.mockResolvedValue({ id: LISTING_ID });
    s3SendMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .delete(`/api/v1/listings/${LISTING_ID}/permanent`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: LISTING_ID } });
    // Both image objects were removed from S3, not just the DB rows.
    expect(s3SendMock).toHaveBeenCalledTimes(2);

    // Post-delete: a subsequent listing search no longer returns it (mocked
    // to reflect the DB state after the cascade delete).
    findManyMock.mockResolvedValue([]);
    const listRes = await request(app).get('/api/v1/listings');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toEqual([]);
  });

  it('still deletes the listing even if an S3 object delete fails (best-effort cleanup)', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    process.env.AWS_S3_BUCKET = 'test-bucket';

    findUniqueUserMock.mockResolvedValue(activeUser(OWNER_ID));
    findUniqueMock.mockResolvedValue({
      id: LISTING_ID,
      userId: OWNER_ID,
      images: [{ id: 'img-1', key: 'listings/abc.jpg' }],
    });
    deleteMock.mockResolvedValue({ id: LISTING_ID });
    s3SendMock.mockRejectedValue(new Error('S3 unavailable'));

    const app = await buildApp();
    const res = await request(app)
      .delete(`/api/v1/listings/${LISTING_ID}/permanent`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`);

    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: LISTING_ID } });
  });
});
