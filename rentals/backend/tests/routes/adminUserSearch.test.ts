/**
 * Coverage for GET /admin/users -- the directory search backing the new
 * User Search / User Management section in /admin. Escalated to ADMIN-only
 * (unlike every other GET in this router) since, unlike a single report's
 * reportedUser, this endpoint can return a searchable slice of every user
 * account. Reused as-is by the frontend; no separate "detail" endpoint --
 * a search result row already carries everything the selected-user view
 * needs (name, email, isBanned, isActive, createdAt).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const MODERATOR_ID = '88888888-8888-4888-8888-888888888888';
const USER_ID = '77777777-7777-4777-8777-777777777777';

const userFindUniqueMock = vi.fn();
const userFindManyMock = vi.fn();
const userCountMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => userFindUniqueMock(...args),
      findMany:   (...args: any[]) => userFindManyMock(...args),
      count:      (...args: any[]) => userCountMock(...args),
    },
  },
}));

function signToken(userId: string, role: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function actingUser(id: string, role: string) {
  return { id, email: `${id}@example.com`, role, name: 'Staff', isActive: true, isBanned: false };
}

function mockUsersById(map: Record<string, any>) {
  userFindUniqueMock.mockImplementation(({ where }: any) => Promise.resolve(map[where.id] ?? null));
}

async function buildApp() {
  vi.resetModules();
  const { default: adminRoutes } = await import('../../src/routes/admin');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', adminRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  userFindUniqueMock.mockReset();
  userFindManyMock.mockReset().mockResolvedValue([]);
  userCountMock.mockReset().mockResolvedValue(0);
});

describe('GET /admin/users — directory search', () => {
  it('ADMIN can search by name', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const matches = [{ id: 'u1', name: 'Jake Smith', email: 'jake@example.com', role: 'USER', isBanned: false, isActive: true, createdAt: new Date('2026-01-01'), _count: { listings: 2 } }];
    userFindManyMock.mockResolvedValue(matches);
    userCountMock.mockResolvedValue(1);
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/users?q=Jake')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Jake Smith');
    expect(userFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ name: { contains: 'Jake', mode: 'insensitive' } }, { email: { contains: 'Jake', mode: 'insensitive' } }] },
    }));
  });

  it('ADMIN can search by email', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const matches = [{ id: 'u1', name: 'Jake Smith', email: 'jake@example.com', role: 'USER', isBanned: false, isActive: true, createdAt: new Date(), _count: { listings: 0 } }];
    userFindManyMock.mockResolvedValue(matches);
    userCountMock.mockResolvedValue(1);
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/users?q=jake@example.com')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].email).toBe('jake@example.com');
    expect(userFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ name: { contains: 'jake@example.com', mode: 'insensitive' } }, { email: { contains: 'jake@example.com', mode: 'insensitive' } }] },
    }));
  });

  it('matching is partial and case-insensitive (contains + insensitive mode passed straight to Prisma)', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();

    await request(app)
      .get('/api/v1/admin/users?q=jAk')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    const where = userFindManyMock.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ name: { contains: 'jAk', mode: 'insensitive' } });
    expect(where.OR[1]).toEqual({ email: { contains: 'jAk', mode: 'insensitive' } });
  });

  it('returns an empty list (not an error) when nothing matches', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    userFindManyMock.mockResolvedValue([]);
    userCountMock.mockResolvedValue(0);
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/users?q=nobody-with-this-name-or-email')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('MODERATOR is rejected (ADMIN-only, unlike every other GET in this router)', async () => {
    mockUsersById({ [MODERATOR_ID]: actingUser(MODERATOR_ID, 'MODERATOR') });
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/users?q=jake')
      .set('Authorization', `Bearer ${signToken(MODERATOR_ID, 'MODERATOR')}`);

    expect(res.status).toBe(403);
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('a plain USER is rejected', async () => {
    mockUsersById({ [USER_ID]: actingUser(USER_ID, 'USER') });
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/users?q=jake')
      .set('Authorization', `Bearer ${signToken(USER_ID, 'USER')}`);

    expect(res.status).toBe(403);
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('is not publicly exposed: an unauthenticated request is rejected before any query runs', async () => {
    const app = await buildApp();

    const res = await request(app).get('/api/v1/admin/users?q=jake');

    expect(res.status).toBe(401);
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('only ever selects the fields the admin UI needs -- never passwordHash, tokens, or other sensitive columns', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();

    await request(app)
      .get('/api/v1/admin/users?q=jake')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    const select = userFindManyMock.mock.calls[0][0].select;
    expect(select).toEqual(expect.objectContaining({
      id: true, name: true, email: true, role: true, isBanned: true, isActive: true, createdAt: true,
    }));
    expect(select.passwordHash).toBeUndefined();
    expect(select.refreshToken).toBeUndefined();
    expect(select.resetToken).toBeUndefined();
  });
});
