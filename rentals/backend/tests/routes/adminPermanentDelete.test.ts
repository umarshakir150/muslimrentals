/**
 * Coverage for ADMIN-only permanent account deletion --
 * DELETE /admin/users/:id -- intentionally different from the existing
 * /ban (reversible suspension, row/email/identity intact) and from the
 * existing self-service DELETE /users/me (which deliberately anonymizes in
 * place rather than deleting the row). This is the one true hard-delete
 * path: the User row is actually removed, its email becomes available for
 * a brand new signup, and every surviving reference (Listing.userId,
 * Message.senderId, Report.reporterId, plus the pre-existing
 * Report.reportedUserId/listingId/messageId) is SET NULL rather than
 * cascaded, so listings/messages/reports survive with the identity
 * detached instead of being destroyed.
 *
 * Prisma is mocked, same established pattern as adminListingModeration.test.ts
 * and usersSettings.test.ts (no test database wired up in this repo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const MODERATOR_ID = '88888888-8888-4888-8888-888888888888';
const USER_ID = '77777777-7777-4777-8777-777777777777';
const TARGET_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const userFindUniqueMock = vi.fn();
const userDeleteMock = vi.fn();
const listingUpdateManyMock = vi.fn();
const transactionMock = vi.fn((ops: Promise<any>[]) => Promise.all(ops));

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => userFindUniqueMock(...args),
      delete:     (...args: any[]) => userDeleteMock(...args),
    },
    listing: {
      updateMany: (...args: any[]) => listingUpdateManyMock(...args),
    },
    $transaction: (...args: any[]) => transactionMock(...args),
  },
}));

const s3SendMock = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = s3SendMock; },
  DeleteObjectCommand: class { constructor(public input: any) {} },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
  userDeleteMock.mockReset().mockResolvedValue({});
  listingUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
  transactionMock.mockReset().mockImplementation((ops: Promise<any>[]) => Promise.all(ops));
  s3SendMock.mockReset();
});

afterEach(() => {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_S3_BUCKET;
});

describe('DELETE /admin/users/:id — permanent account deletion', () => {
  it('ADMIN can permanently delete an account with a reason', async () => {
    mockUsersById({
      [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN'),
      [TARGET_ID]: { id: TARGET_ID, email: 'target@example.com', avatarKey: null },
    });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Repeated fraudulent listings, confirmed by multiple reports' });

    expect(res.status).toBe(200);
    expect(userDeleteMock).toHaveBeenCalledWith({ where: { id: TARGET_ID } });
  });

  it('MODERATOR cannot permanently delete an account (ADMIN-only, unlike the broader router gate)', async () => {
    mockUsersById({ [MODERATOR_ID]: actingUser(MODERATOR_ID, 'MODERATOR') });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(MODERATOR_ID, 'MODERATOR')}`)
      .send({ reason: 'Should never reach the handler' });

    expect(res.status).toBe(403);
    expect(userDeleteMock).not.toHaveBeenCalled();
  });

  it('a plain USER cannot permanently delete an account', async () => {
    mockUsersById({ [USER_ID]: actingUser(USER_ID, 'USER') });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(USER_ID, 'USER')}`)
      .send({ reason: 'Should never reach the handler' });

    expect(res.status).toBe(403);
    expect(userDeleteMock).not.toHaveBeenCalled();
  });

  it('an ADMIN cannot permanently delete their own account', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${ADMIN_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Accidental self-target, must be blocked' });

    expect(res.status).toBe(400);
    expect(userDeleteMock).not.toHaveBeenCalled();
    expect(listingUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects deletion with no reason', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({});

    expect(res.status).toBe(422);
    expect(userDeleteMock).not.toHaveBeenCalled();
  });

  it('404s for a target user that does not exist', async () => {
    mockUsersById({ [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN') });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Valid reason, missing target' });

    expect(res.status).toBe(404);
    expect(userDeleteMock).not.toHaveBeenCalled();
  });

  it('removes the target\'s listings from public visibility and deletes the User row in the same transaction, scoped only to the target', async () => {
    mockUsersById({
      [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN'),
      [TARGET_ID]: { id: TARGET_ID, email: 'target@example.com', avatarKey: null },
    });
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Confirmed scam account' });

    expect(res.status).toBe(200);
    expect(listingUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: TARGET_ID, status: { not: 'REMOVED' } },
      data:  { status: 'REMOVED', isActive: false },
    });
    expect(userDeleteMock).toHaveBeenCalledWith({ where: { id: TARGET_ID } });
    // Both writes went through the same $transaction call, not two
    // independent requests that could partially fail (e.g. listings hidden
    // but the account itself somehow left behind).
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(transactionMock.mock.calls[0][0]).toHaveLength(2);
    // Never touched any user other than the target.
    expect(listingUpdateManyMock).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: ADMIN_ID }) }));
  });

  it('force-disconnects the target\'s live Socket.IO session', async () => {
    mockUsersById({
      [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN'),
      [TARGET_ID]: { id: TARGET_ID, email: 'target@example.com', avatarKey: null },
    });
    const disconnectSockets = vi.fn();
    const io = { in: vi.fn(() => ({ disconnectSockets })) };
    const app = await buildApp(io);

    await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Confirmed scam account' });

    expect(io.in).toHaveBeenCalledWith(`user:${TARGET_ID}`);
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('best-effort deletes the target\'s avatar S3 object when one is set', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'k'; process.env.AWS_SECRET_ACCESS_KEY = 's'; process.env.AWS_S3_BUCKET = 'b';
    mockUsersById({
      [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN'),
      [TARGET_ID]: { id: TARGET_ID, email: 'target@example.com', avatarKey: 'avatars/target.jpg' },
    });
    s3SendMock.mockResolvedValue({});
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Confirmed scam account' });

    expect(res.status).toBe(200);
    expect(s3SendMock).toHaveBeenCalledTimes(1);
    expect(s3SendMock.mock.calls[0][0].input).toEqual({ Bucket: 'b', Key: 'avatars/target.jpg' });
  });

  it('a failed S3 avatar delete does not fail the whole deletion (best-effort, matching the self-service delete flow)', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'k'; process.env.AWS_SECRET_ACCESS_KEY = 's'; process.env.AWS_S3_BUCKET = 'b';
    mockUsersById({
      [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN'),
      [TARGET_ID]: { id: TARGET_ID, email: 'target@example.com', avatarKey: 'avatars/target.jpg' },
    });
    s3SendMock.mockRejectedValue(new Error('R2 unreachable'));
    const app = await buildApp();

    const res = await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Confirmed scam account' });

    expect(res.status).toBe(200);
    expect(userDeleteMock).toHaveBeenCalled();
  });

  it('skips the S3 call entirely when the account has no avatar', async () => {
    mockUsersById({
      [ADMIN_ID]: actingUser(ADMIN_ID, 'ADMIN'),
      [TARGET_ID]: { id: TARGET_ID, email: 'target@example.com', avatarKey: null },
    });
    const app = await buildApp();

    await request(app)
      .delete(`/api/v1/admin/users/${TARGET_ID}`)
      .set('Authorization', `Bearer ${signToken(ADMIN_ID, 'ADMIN')}`)
      .send({ reason: 'Confirmed scam account' });

    expect(s3SendMock).not.toHaveBeenCalled();
  });
});

describe('Post-deletion auth invalidation: old tokens stop working immediately', () => {
  it('a request bearing a still-unexpired access token for the now-deleted account 401s (authenticate() re-reads the DB every time and finds nothing)', async () => {
    // The deleted account no longer exists at all -- authenticate()'s own
    // findUnique now resolves null for it, exactly like any other
    // nonexistent user id. This proves the *mechanism*: since deletion is
    // a real row delete (not the anonymize-in-place self-service flow),
    // no explicit "invalidate token" step is needed -- there's simply
    // nothing left for authenticate() to find.
    mockUsersById({});
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${signToken(TARGET_ID, 'ADMIN')}`);

    expect(res.status).toBe(401);
  });
});

describe('Schema contract: the three FKs this feature depends on are SET NULL, not CASCADE', () => {
  // A permanent account delete only preserves listings/messages/reports
  // because Listing.userId, Message.senderId, and Report.reporterId are
  // nullable + onDelete: SetNull. If any of these ever silently reverted to
  // Cascade (or back to a required, non-nullable field), a real User row
  // delete would once again destroy another user's conversation history,
  // a still-relevant report, or the listing record itself -- exactly the
  // failure mode this whole feature was designed to avoid. This guards the
  // schema declaration directly, since no amount of route-level mocking
  // can exercise real Postgres FK/cascade behavior in this test suite.
  const schema = fs.readFileSync(
    path.resolve(__dirname, '../../prisma/schema.prisma'),
    'utf-8'
  );

  it('Listing.userId is nullable with onDelete: SetNull', () => {
    expect(schema).toMatch(/userId\s+String\?\s*\n\s*user\s+User\?\s+@relation\(fields: \[userId\], references: \[id\], onDelete: SetNull\)/);
  });

  it('Message.senderId is nullable with onDelete: SetNull', () => {
    expect(schema).toMatch(/senderId\s+String\?\s*\n\s*sender\s+User\?\s+@relation\("SentMessages", fields: \[senderId\], references: \[id\], onDelete: SetNull\)/);
  });

  it('Report.reporterId is nullable with onDelete: SetNull', () => {
    expect(schema).toMatch(/reporterId\s+String\?\s*\n\s*reporter\s+User\?\s+@relation\("ReportsFiled", fields: \[reporterId\], references: \[id\], onDelete: SetNull\)/);
  });
});
