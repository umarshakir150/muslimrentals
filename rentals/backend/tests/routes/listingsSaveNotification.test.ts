/**
 * Regression coverage for the LISTING_SAVED notification wired into
 * POST /listings/:id/save (see src/utils/notifications.ts and PR D):
 *  - saving someone else's listing notifies its owner
 *  - saving your own listing never notifies you (no self-notification)
 *  - un-saving (the toggle-off branch) never notifies anyone
 *  - a nonexistent listing still 404s, untouched by the notification logic
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const OWNER_ID   = '11111111-1111-4111-8111-111111111111';
const SAVER_ID   = '22222222-2222-4222-8222-222222222222';
const LISTING_ID = '33333333-3333-4333-8333-333333333333';

const savedFindUniqueMock = vi.fn();
const savedDeleteMock     = vi.fn();
const savedCreateMock     = vi.fn();
const listingFindUniqueMock = vi.fn();
const userFindUniqueMock    = vi.fn();
const notificationCreateMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    savedListing: {
      findUnique: (...args: any[]) => savedFindUniqueMock(...args),
      delete:     (...args: any[]) => savedDeleteMock(...args),
      create:     (...args: any[]) => savedCreateMock(...args),
    },
    listing: {
      findUnique: (...args: any[]) => listingFindUniqueMock(...args),
    },
    user: {
      findUnique: (...args: any[]) => userFindUniqueMock(...args),
    },
    notification: {
      create: (...args: any[]) => notificationCreateMock(...args),
    },
  },
}));

function signToken(userId: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role: 'USER' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function activeUser(id: string) {
  return { id, email: `${id}@example.com`, role: 'USER', name: 'Test User', isActive: true, isBanned: false };
}

async function buildApp() {
  vi.resetModules();
  const { default: listingRoutes } = await import('../../src/routes/listings');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  const io = { to: vi.fn(() => ({ emit: vi.fn() })) };
  app.set('io', io);
  app.use('/api/v1/listings', listingRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  savedFindUniqueMock.mockReset();
  savedDeleteMock.mockReset();
  savedCreateMock.mockReset();
  listingFindUniqueMock.mockReset();
  userFindUniqueMock.mockReset();
  notificationCreateMock.mockReset().mockResolvedValue({ id: 'n1' });
});

describe('POST /listings/:id/save', () => {
  it('notifies the owner when someone else saves their listing', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(SAVER_ID));
    savedFindUniqueMock.mockResolvedValue(null);
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, userId: OWNER_ID, title: 'Cozy 2BR' });
    savedCreateMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/listings/${LISTING_ID}/save`)
      .set('Authorization', `Bearer ${signToken(SAVER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(notificationCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: OWNER_ID, type: 'LISTING_SAVED', data: { listingId: LISTING_ID } }),
    }));
  });

  it('never notifies you for saving your own listing', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(OWNER_ID));
    savedFindUniqueMock.mockResolvedValue(null);
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, userId: OWNER_ID, title: 'Cozy 2BR' });
    savedCreateMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/listings/${LISTING_ID}/save`)
      .set('Authorization', `Bearer ${signToken(OWNER_ID)}`);

    expect(res.status).toBe(200);
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it('does not notify on un-save (toggle-off)', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(SAVER_ID));
    savedFindUniqueMock.mockResolvedValue({ userId: SAVER_ID, listingId: LISTING_ID });
    savedDeleteMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/listings/${LISTING_ID}/save`)
      .set('Authorization', `Bearer ${signToken(SAVER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(false);
    expect(listingFindUniqueMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it('404s for a nonexistent listing without notifying anyone', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(SAVER_ID));
    savedFindUniqueMock.mockResolvedValue(null);
    listingFindUniqueMock.mockResolvedValue(null);

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/listings/${LISTING_ID}/save`)
      .set('Authorization', `Bearer ${signToken(SAVER_ID)}`);

    expect(res.status).toBe(404);
    expect(savedCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it('never notifies for a permanently-deleted owner (listing.userId null)', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(SAVER_ID));
    savedFindUniqueMock.mockResolvedValue(null);
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, userId: null, title: 'Orphaned listing' });
    savedCreateMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/listings/${LISTING_ID}/save`)
      .set('Authorization', `Bearer ${signToken(SAVER_ID)}`);

    expect(res.status).toBe(200);
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });
});
