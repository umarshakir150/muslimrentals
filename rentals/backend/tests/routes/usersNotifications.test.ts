/**
 * Regression coverage for the notification read/unread routes added to
 * users.ts:
 *  - GET /users/me/notifications/unread-count
 *  - PATCH /users/me/notifications/read-all
 *  - PATCH /users/me/notifications/:id/read (recipient-only, 404s -- never
 *    403s -- for another user's notification, so existence can't be
 *    enumerated)
 *
 * Prisma is mocked -- there is no test database wired up in this repo yet
 * (see usersSettings.test.ts for the same established pattern).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const USER_ID  = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const NOTIF_ID = '33333333-3333-4333-8333-333333333333';

const authUserFindUniqueMock = vi.fn(); // authenticate() middleware's own lookup
const notificationCountMock       = vi.fn();
const notificationUpdateManyMock  = vi.fn();
const notificationFindUniqueMock  = vi.fn();
const notificationUpdateMock      = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => authUserFindUniqueMock(...args),
    },
    notification: {
      count:      (...args: any[]) => notificationCountMock(...args),
      updateMany: (...args: any[]) => notificationUpdateManyMock(...args),
      findUnique: (...args: any[]) => notificationFindUniqueMock(...args),
      update:     (...args: any[]) => notificationUpdateMock(...args),
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
  const { default: usersRoutes } = await import('../../src/routes/users');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/users', usersRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  authUserFindUniqueMock.mockReset().mockResolvedValue(activeUser(USER_ID));
  notificationCountMock.mockReset();
  notificationUpdateManyMock.mockReset();
  notificationFindUniqueMock.mockReset();
  notificationUpdateMock.mockReset();
});

describe('GET /users/me/notifications/unread-count', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/v1/users/me/notifications/unread-count');
    expect(res.status).toBe(401);
  });

  it('returns the caller\'s own unread count', async () => {
    notificationCountMock.mockResolvedValue(4);
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/users/me/notifications/unread-count')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(4);
    expect(notificationCountMock).toHaveBeenCalledWith({ where: { userId: USER_ID, isRead: false } });
  });
});

describe('PATCH /users/me/notifications/read-all', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).patch('/api/v1/users/me/notifications/read-all');
    expect(res.status).toBe(401);
  });

  it('marks only the caller\'s own unread notifications as read', async () => {
    notificationUpdateManyMock.mockResolvedValue({ count: 3 });
    const app = await buildApp();

    const res = await request(app)
      .patch('/api/v1/users/me/notifications/read-all')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: USER_ID, isRead: false },
      data:  { isRead: true },
    });
  });
});

describe('PATCH /users/me/notifications/:id/read', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).patch(`/api/v1/users/me/notifications/${NOTIF_ID}/read`);
    expect(res.status).toBe(401);
  });

  it('rejects a non-UUID id', async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch('/api/v1/users/me/notifications/not-a-uuid/read')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`);
    expect(res.status).toBe(400);
  });

  it('marks the caller\'s own notification as read', async () => {
    notificationFindUniqueMock.mockResolvedValue({ id: NOTIF_ID, userId: USER_ID });
    notificationUpdateMock.mockResolvedValue({ id: NOTIF_ID, userId: USER_ID, isRead: true });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/users/me/notifications/${NOTIF_ID}/read`)
      .set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(notificationUpdateMock).toHaveBeenCalledWith({ where: { id: NOTIF_ID }, data: { isRead: true } });
  });

  it('404s (never 403s) for a notification that does not exist, so existence cannot be enumerated', async () => {
    notificationFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/users/me/notifications/${NOTIF_ID}/read`)
      .set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(404);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it('404s (never 403s) for a notification belonging to another user', async () => {
    notificationFindUniqueMock.mockResolvedValue({ id: NOTIF_ID, userId: OTHER_ID });
    const app = await buildApp();

    const res = await request(app)
      .patch(`/api/v1/users/me/notifications/${NOTIF_ID}/read`)
      .set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(404);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });
});
