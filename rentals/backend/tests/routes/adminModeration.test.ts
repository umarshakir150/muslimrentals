/**
 * Coverage for the two moderation actions introduced alongside the
 * Pending/Resolved report-tab simplification:
 *  - POST /admin/users/:id/restrict + PATCH /admin/users/:id/unrestrict --
 *    a narrow, reversible action (stop one user from messaging one other
 *    specific user again) distinct from the pre-existing, broader
 *    account-wide /ban. ADMIN and MODERATOR can both use it.
 *  - /ban and /unban's existing ADMIN-only gate, confirmed unchanged
 *    (no prior test file covered their authorization at all).
 *  - GET /admin/reports now attaches each report's active restriction
 *    (if any) alongside its reportedUser, so the admin UI can render
 *    Restrict vs. Unrestrict correctly.
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
const RESTRICTED_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROTECTED_USER_ID  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const userFindUniqueMock = vi.fn();
const restrictionFindUniqueMock = vi.fn();
const restrictionUpsertMock = vi.fn();
const restrictionUpdateMock = vi.fn();
const restrictionFindManyMock = vi.fn();
const userUpdateMock = vi.fn();
const listingUpdateManyMock = vi.fn();
const reportFindManyMock = vi.fn();
const reportGroupByMock = vi.fn();
// Real $transaction([opA, opB]) receives two already-invoked mocked-Prisma
// promises (the individual mocks above already ran); this just awaits both
// together and returns their results in order, matching Prisma's own shape
// closely enough to test that /ban and /unban update the user and their
// listings atomically, in one transaction, not as two independent calls.
const transactionMock = vi.fn((ops: Promise<any>[]) => Promise.all(ops));

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => userFindUniqueMock(...args),
      update:     (...args: any[]) => userUpdateMock(...args),
    },
    listing: {
      updateMany: (...args: any[]) => listingUpdateManyMock(...args),
    },
    userMessageRestriction: {
      findUnique: (...args: any[]) => restrictionFindUniqueMock(...args),
      upsert:     (...args: any[]) => restrictionUpsertMock(...args),
      update:     (...args: any[]) => restrictionUpdateMock(...args),
      findMany:   (...args: any[]) => restrictionFindManyMock(...args),
    },
    report: {
      findMany: (...args: any[]) => reportFindManyMock(...args),
      groupBy:  (...args: any[]) => reportGroupByMock(...args),
    },
    $transaction: (...args: any[]) => transactionMock(...args),
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

async function buildApp(io?: any) {
  vi.resetModules();
  const { default: adminRoutes } = await import('../../src/routes/admin');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  if (io) app.set('io', io);
  app.use(express.json());
  app.use('/api/v1/admin', adminRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  userFindUniqueMock.mockReset();
  restrictionFindUniqueMock.mockReset();
  restrictionUpsertMock.mockReset().mockResolvedValue({});
  restrictionUpdateMock.mockReset().mockResolvedValue({});
  restrictionFindManyMock.mockReset().mockResolvedValue([]);
  userUpdateMock.mockReset().mockResolvedValue({ email: 'target@example.com' });
  listingUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
  reportFindManyMock.mockReset().mockResolvedValue([]);
  reportGroupByMock.mockReset().mockResolvedValue([]);
  transactionMock.mockReset().mockImplementation((ops: Promise<any>[]) => Promise.all(ops));
});

// The `authenticate` middleware re-fetches the acting user by id on every
// request (see auth.ts) -- route handlers below additionally look up the
// *protected* user by a different id, so the mock must branch on which id
// was actually asked for rather than always returning the same fixture.
function mockUsersById(map: Record<string, any>) {
  userFindUniqueMock.mockImplementation(({ where }: any) =>
    Promise.resolve(map[where.id] ?? null));
}

describe('POST /admin/users/:id/restrict', () => {
  it('MODERATOR can place a restriction (narrower than /ban, not ADMIN-gated)', async () => {
    mockUsersById({ [MODERATOR_ID]: actingUser(MODERATOR_ID, 'MODERATOR'), [PROTECTED_USER_ID]: { id: PROTECTED_USER_ID } });
    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/admin/users/${RESTRICTED_USER_ID}/restrict`)
      .set('Authorization', `Bearer ${signToken(MODERATOR_ID, 'MODERATOR')}`)
      .send({ protectedUserId: PROTECTED_USER_ID, reason: 'Harassing the reporter after being reported' });

    expect(res.status).toBe(200);
    expect(restrictionUpsertMock).toHaveBeenCalledWith({
      where:  { restrictedUserId_protectedUserId: { restrictedUserId: RESTRICTED_USER_ID, protectedUserId: PROTECTED_USER_ID } },
      create: { restrictedUserId: RESTRICTED_USER_ID, protectedUserId: PROTECTED_USER_ID, reason: 'Harassing the reporter after being reported' },
      update: { reason: 'Harassing the reporter after being reported', liftedAt: null },
    });
  });

  it('a plain USER cannot restrict anyone (blocked by the router-wide role gate)', async () => {
    mockUsersById({ [USER_ID]: actingUser(USER_ID, 'USER') });
    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/admin/users/${RESTRICTED_USER_ID}/restrict`)
      .set('Authorization', `Bearer ${signToken(USER_ID, 'USER')}`)
      .send({ protectedUserId: PROTECTED_USER_ID, reason: 'irrelevant, should never reach the handler' });

    expect(res.status).toBe(403);
    expect(restrictionUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects restricting a user from messaging themselves', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/admin/users/${RESTRICTED_USER_ID}/restrict`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ protectedUserId: RESTRICTED_USER_ID, reason: 'nonsensical self-restriction' });

    expect(res.status).toBe(400);
    expect(restrictionUpsertMock).not.toHaveBeenCalled();
  });

  it('404s (well, 400s) when protectedUserId does not refer to a real user', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN'), [PROTECTED_USER_ID]: null });
    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/admin/users/${RESTRICTED_USER_ID}/restrict`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ protectedUserId: PROTECTED_USER_ID, reason: 'valid reason but bad protectedUserId' });

    expect(res.status).toBe(400);
    expect(restrictionUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects a reason under 5 characters', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();
    const res = await request(app)
      .post(`/api/v1/admin/users/${RESTRICTED_USER_ID}/restrict`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ protectedUserId: PROTECTED_USER_ID, reason: 'hi' });

    expect(res.status).toBe(422);
    expect(restrictionUpsertMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /admin/users/:id/unrestrict', () => {
  it('lifts an existing active restriction', async () => {
    mockUsersById({ [MODERATOR_ID]: actingUser(MODERATOR_ID, 'MODERATOR') });
    restrictionFindUniqueMock.mockResolvedValue({
      restrictedUserId: RESTRICTED_USER_ID, protectedUserId: PROTECTED_USER_ID, reason: 'x', liftedAt: null,
    });
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/unrestrict`)
      .set('Authorization', `Bearer ${signToken(MODERATOR_ID, 'MODERATOR')}`)
      .send({ protectedUserId: PROTECTED_USER_ID });

    expect(res.status).toBe(200);
    expect(restrictionUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { restrictedUserId_protectedUserId: { restrictedUserId: RESTRICTED_USER_ID, protectedUserId: PROTECTED_USER_ID } },
      data:  expect.objectContaining({ liftedAt: expect.any(Date) }),
    }));
  });

  it('404s -- refuses to "double-unrestrict" -- when no active restriction exists for the pair', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    restrictionFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/unrestrict`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ protectedUserId: PROTECTED_USER_ID });

    expect(res.status).toBe(404);
    expect(restrictionUpdateMock).not.toHaveBeenCalled();
  });

  it('404s on a restriction that was already lifted (no contradictory double-lift)', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    restrictionFindUniqueMock.mockResolvedValue({
      restrictedUserId: RESTRICTED_USER_ID, protectedUserId: PROTECTED_USER_ID, reason: 'x', liftedAt: new Date('2026-01-01'),
    });
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/unrestrict`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ protectedUserId: PROTECTED_USER_ID });

    expect(res.status).toBe(404);
    expect(restrictionUpdateMock).not.toHaveBeenCalled();
  });
});

describe('/ban and /unban authorization (pre-existing endpoints, previously untested)', () => {
  it('ADMIN can ban', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/ban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Repeated harassment across multiple conversations' });

    expect(res.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: RESTRICTED_USER_ID },
      data:  { isBanned: true, banReason: 'Repeated harassment across multiple conversations', refreshToken: null },
    });
  });

  it('MODERATOR cannot ban -- a strictly more serious action than /restrict, ADMIN-only', async () => {
    mockUsersById({ [MODERATOR_ID]: actingUser(MODERATOR_ID, 'MODERATOR') });
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/ban`)
      .set('Authorization', `Bearer ${signToken(MODERATOR_ID, 'MODERATOR')}`)
      .send({ reason: 'Repeated harassment across multiple conversations' });

    expect(res.status).toBe(403);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('a plain USER cannot ban', async () => {
    mockUsersById({ [USER_ID]: actingUser(USER_ID, 'USER') });
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/ban`)
      .set('Authorization', `Bearer ${signToken(USER_ID, 'USER')}`)
      .send({ reason: 'Repeated harassment across multiple conversations' });

    expect(res.status).toBe(403);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('MODERATOR cannot unban either', async () => {
    mockUsersById({ [MODERATOR_ID]: actingUser(MODERATOR_ID, 'MODERATOR') });
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/unban`)
      .set('Authorization', `Bearer ${signToken(MODERATOR_ID, 'MODERATOR')}`);

    expect(res.status).toBe(403);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});

describe('/ban and /unban: hiding and restoring the banned user\'s listings', () => {
  it('banning hides every currently-ACTIVE listing owned by that user, in the same transaction as the account ban', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/ban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Repeated scam listings' });

    expect(res.status).toBe(200);
    expect(listingUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: RESTRICTED_USER_ID, status: 'ACTIVE' },
      data:  { status: 'BANNED' },
    });
    // Both writes went through the same $transaction call, not two
    // independent requests that could partially fail.
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(transactionMock.mock.calls[0][0]).toHaveLength(2);
  });

  it('force-disconnects any live Socket.IO session the banned user already has open, not just future connection attempts', async () => {
    // Founder-reported gap: Socket.IO's own auth middleware only runs at
    // connect time (socketServer.ts), so a session opened before the ban
    // would otherwise sit connected indefinitely -- marking messages read,
    // seeing typing indicators, receiving pushes -- until it happened to
    // reconnect on its own. /ban must actively close it, the same instant
    // the account is banned, not wait for that.
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const disconnectSocketsMock = vi.fn();
    const inMock = vi.fn(() => ({ disconnectSockets: disconnectSocketsMock }));
    const fakeIo = { in: inMock };

    const app = await buildApp(fakeIo);
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/ban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Repeated scam listings' });

    expect(res.status).toBe(200);
    expect(inMock).toHaveBeenCalledWith(`user:${RESTRICTED_USER_ID}`);
    expect(disconnectSocketsMock).toHaveBeenCalledWith(true);
  });

  it('does not error when no io instance is registered on the app (e.g. in a context without sockets)', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp(); // no io set

    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/ban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Repeated scam listings' });

    expect(res.status).toBe(200);
  });

  it('unban restores only listings the ban itself hid (status BANNED), not ones already non-public before the ban', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/unban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    expect(res.status).toBe(200);
    // Scoped to status: 'BANNED' only -- a listing that was already
    // INACTIVE/PENDING/REMOVED before the ban was never moved to BANNED,
    // so this query can never touch it and accidentally "revive" it.
    expect(listingUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: RESTRICTED_USER_ID, status: 'BANNED' },
      data:  { status: 'ACTIVE' },
    });
  });

  it('repeated ban/unban stays idempotent: a second ban only re-targets ACTIVE listings, a second unban only BANNED ones', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();

    for (let i = 0; i < 2; i++) {
      await request(app)
        .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/ban`)
        .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
        .send({ reason: 'Repeated scam listings, second look' });
    }
    for (let i = 0; i < 2; i++) {
      await request(app)
        .patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/unban`)
        .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);
    }

    // Every call used the same fixed where/data shape -- a real (unmocked)
    // updateMany against a set of already-BANNED (or already-ACTIVE) rows
    // is a no-op, not an error or a state corruption, so calling it twice
    // in a row is safe by construction.
    for (const call of listingUpdateManyMock.mock.calls) {
      expect(['ACTIVE', 'BANNED']).toContain(call[0].where.status);
      expect(['ACTIVE', 'BANNED']).toContain(call[0].data.status);
      expect(call[0].where.status).not.toBe(call[0].data.status);
    }
    expect(listingUpdateManyMock).toHaveBeenCalledTimes(4);
  });

  it('actually simulating a mixed listing set: ban only flips the ACTIVE one, and unban only restores that same one -- INACTIVE/PENDING/REMOVED listings never move', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    // A real in-memory "table" (not just an assertion on the call shape) so
    // this test can't pass on a where-clause typo the way an args-only
    // assertion could -- updateMany here actually filters and mutates rows.
    const listings = [
      { id: 'l-active',  userId: RESTRICTED_USER_ID, status: 'ACTIVE' },
      { id: 'l-inactive', userId: RESTRICTED_USER_ID, status: 'INACTIVE' },
      { id: 'l-pending', userId: RESTRICTED_USER_ID, status: 'PENDING' },
      { id: 'l-removed', userId: RESTRICTED_USER_ID, status: 'REMOVED' },
    ];
    listingUpdateManyMock.mockImplementation(({ where, data }: any) => {
      let count = 0;
      for (const l of listings) {
        if (l.userId === where.userId && l.status === where.status) { l.status = data.status; count++; }
      }
      return Promise.resolve({ count });
    });

    const app = await buildApp();
    await request(app).patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/ban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Repeated scam listings' });

    expect(listings.find(l => l.id === 'l-active')!.status).toBe('BANNED');
    expect(listings.find(l => l.id === 'l-inactive')!.status).toBe('INACTIVE');
    expect(listings.find(l => l.id === 'l-pending')!.status).toBe('PENDING');
    expect(listings.find(l => l.id === 'l-removed')!.status).toBe('REMOVED');

    await request(app).patch(`/api/v1/admin/users/${RESTRICTED_USER_ID}/unban`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    expect(listings.find(l => l.id === 'l-active')!.status).toBe('ACTIVE');
    expect(listings.find(l => l.id === 'l-inactive')!.status).toBe('INACTIVE');
    expect(listings.find(l => l.id === 'l-pending')!.status).toBe('PENDING');
    expect(listings.find(l => l.id === 'l-removed')!.status).toBe('REMOVED');
  });
});

describe('GET /admin/reports: active restriction surfaced alongside reportedUser', () => {
  it('attaches the active restriction (reason + createdAt) for a reportedUser who is currently restricted', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    reportFindManyMock.mockResolvedValue([{
      id: 'r1', reason: 'Harassment', description: null, status: 'PENDING', createdAt: new Date(), resolvedAt: null,
      resolution: null, reporterId: PROTECTED_USER_ID, targetType: 'USER', reportedUserId: RESTRICTED_USER_ID,
      reporter: { id: PROTECTED_USER_ID, name: 'Reporter', email: 'r@example.com' },
      listing: null, message: null,
      reportedUser: { id: RESTRICTED_USER_ID, name: 'Target', email: 't@example.com', isBanned: false, banReason: null, createdAt: new Date() },
    }]);
    restrictionFindManyMock.mockResolvedValue([{ restrictedUserId: RESTRICTED_USER_ID, protectedUserId: PROTECTED_USER_ID, reason: 'Prior harassment', createdAt }]);

    const app = await buildApp();
    const res = await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].restriction).toEqual({ reason: 'Prior harassment', createdAt: createdAt.toISOString() });
  });

  it('restriction is null for a reportedUser with no active restriction', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    reportFindManyMock.mockResolvedValue([{
      id: 'r1', reason: 'Harassment', description: null, status: 'PENDING', createdAt: new Date(), resolvedAt: null,
      resolution: null, reporterId: PROTECTED_USER_ID, targetType: 'USER', reportedUserId: RESTRICTED_USER_ID,
      reporter: { id: PROTECTED_USER_ID, name: 'Reporter', email: 'r@example.com' },
      listing: null, message: null,
      reportedUser: { id: RESTRICTED_USER_ID, name: 'Target', email: 't@example.com', isBanned: false, banReason: null, createdAt: new Date() },
    }]);
    restrictionFindManyMock.mockResolvedValue([]);

    const app = await buildApp();
    const res = await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].restriction).toBeNull();
  });
});
