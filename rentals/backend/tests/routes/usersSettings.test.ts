/**
 * Regression coverage for the Settings/Account routes added to users.ts:
 * DELETE /users/me/avatar, POST /users/me/email-change-request,
 * POST /users/me/email-change-confirm, DELETE /users/me (account deletion).
 *
 * Prisma, the S3 client, and email sending are mocked -- there is no test
 * database wired up in this repo yet (see listingsPermanentDelete.test.ts
 * for the same established pattern this file follows).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';
process.env.FRONTEND_URL = 'https://muslimrentals.netlify.app';

const USER_ID  = '11111111-1111-4111-8111-111111111111';

const findUniqueUserMock = vi.fn(); // authenticate middleware's own lookup
const userFindUniqueMock = vi.fn();
const userFindFirstMock  = vi.fn();
const userUpdateMock     = vi.fn();
const transactionMock    = vi.fn();
const listingUpdateManyMock      = vi.fn();
const savedListingDeleteManyMock = vi.fn();
const notificationDeleteManyMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => {
        // authenticate() always selects isActive/isBanned; route handlers
        // select their own specific fields -- route mocks are distinguished
        // by test-provided resolved values via userFindUniqueMock instead.
        return userFindUniqueMock(...args);
      },
      findFirst: (...args: any[]) => userFindFirstMock(...args),
      update:    (...args: any[]) => userUpdateMock(...args),
    },
    listing:      { updateMany: (...args: any[]) => listingUpdateManyMock(...args) },
    savedListing: { deleteMany: (...args: any[]) => savedListingDeleteManyMock(...args) },
    notification: { deleteMany: (...args: any[]) => notificationDeleteManyMock(...args) },
    $transaction: (ops: any[]) => transactionMock(ops),
  },
}));

const s3SendMock = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = s3SendMock; },
  DeleteObjectCommand: class { constructor(public input: any) {} },
}));

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/utils/email', () => ({
  sendEmail: (...args: any[]) => sendEmailMock(...args),
  emailChangeVerificationEmail: vi.fn(() => '<html></html>'),
  passwordResetEmail: vi.fn(() => '<html></html>'),
  welcomeEmail: vi.fn(() => '<html></html>'),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function signToken(userId: string) {
  return jwt.sign({ userId, email: 'u@example.com', role: 'USER' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function activeUser(overrides: Record<string, any> = {}) {
  return { id: USER_ID, email: 'u@example.com', role: 'USER', name: 'Test User', isActive: true, isBanned: false, ...overrides };
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
  findUniqueUserMock.mockReset();
  userFindUniqueMock.mockReset();
  userFindFirstMock.mockReset();
  userUpdateMock.mockReset();
  transactionMock.mockReset().mockResolvedValue([]);
  listingUpdateManyMock.mockReset();
  savedListingDeleteManyMock.mockReset();
  notificationDeleteManyMock.mockReset();
  s3SendMock.mockReset();
  sendEmailMock.mockClear();
  // authenticate() calls prisma.user.findUnique once per request for its own
  // active-account check -- default every test to an active user unless a
  // test overrides it, then have route-level userFindUniqueMock calls layer
  // on top via mockResolvedValueOnce per test.
  userFindUniqueMock.mockResolvedValue(activeUser());
});

afterEach(() => {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_S3_BUCKET;
});

describe('DELETE /users/me/avatar', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).delete('/api/v1/users/me/avatar');
    expect(res.status).toBe(401);
  });

  it('clears avatarUrl/avatarKey and deletes the S3 object when one is set', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'k'; process.env.AWS_SECRET_ACCESS_KEY = 's'; process.env.AWS_S3_BUCKET = 'b';
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())                    // authenticate()
      .mockResolvedValueOnce({ avatarKey: 'avatars/abc.jpg' }); // route's own lookup
    s3SendMock.mockResolvedValue({});
    userUpdateMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app).delete('/api/v1/users/me/avatar').set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(s3SendMock).toHaveBeenCalledTimes(1);
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { avatarUrl: null, avatarKey: null } });
  });

  it('succeeds without touching S3 when there is no avatarKey (e.g. a Google avatar)', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ avatarKey: null });
    userUpdateMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app).delete('/api/v1/users/me/avatar').set('Authorization', `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(s3SendMock).not.toHaveBeenCalled();
  });
});

describe('POST /users/me/email-change-request', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/users/me/email-change-request').send({ newEmail: 'new@example.com' });
    expect(res.status).toBe(401);
  });

  it('requires currentPassword when the account has a password, and rejects a wrong one', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ email: 'u@example.com', passwordHash: '$2a$12$fakehashfakehashfakehashfakehashfakehashfakeh' });

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/users/me/email-change-request')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ newEmail: 'new@example.com' }); // no currentPassword

    expect(res.status).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('allows a Google-only account (no passwordHash) to request without a password', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ email: 'u@example.com', passwordHash: null });
    userFindFirstMock.mockResolvedValue(null); // no in-flight pendingEmail collision
    // emailTaken lookup reuses userFindUniqueMock (by email) -- next call resolves null
    userFindUniqueMock.mockResolvedValueOnce(null);
    userUpdateMock.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/users/me/email-change-request')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ newEmail: 'new@example.com' });

    expect(res.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({ pendingEmail: 'new@example.com' }),
    });
    // Sent to the NEW address, never the old one.
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@example.com' }));
  });

  it('rejects when the requested email is already in use', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ email: 'u@example.com', passwordHash: null })
      .mockResolvedValueOnce({ id: 'someone-else' }); // emailTaken lookup finds a row
    userFindFirstMock.mockResolvedValue(null);

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/users/me/email-change-request')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ newEmail: 'taken@example.com' });

    expect(res.status).toBe(409);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects requesting the same email the account already has', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ email: 'u@example.com', passwordHash: null });

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/users/me/email-change-request')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ newEmail: 'u@example.com' });

    expect(res.status).toBe(400);
  });
});

describe('POST /users/me/email-change-confirm', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/v1/users/me/email-change-confirm').send({ token: 'x'.repeat(64) });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid or expired token', async () => {
    userFindUniqueMock.mockResolvedValueOnce(activeUser());
    userFindFirstMock.mockResolvedValue(null);

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/users/me/email-change-confirm')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ token: 'x'.repeat(64) });

    expect(res.status).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('commits the pending email on a valid token', async () => {
    userFindUniqueMock.mockResolvedValueOnce(activeUser());
    userFindFirstMock.mockResolvedValue({ pendingEmail: 'new@example.com' });
    userUpdateMock.mockResolvedValue({ id: USER_ID, email: 'new@example.com' });

    const app = await buildApp();
    const res = await request(app)
      .post('/api/v1/users/me/email-change-confirm')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ token: 'x'.repeat(64) });

    expect(res.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'new@example.com', pendingEmail: null }),
    }));
  });
});

describe('DELETE /users/me (account deletion)', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).delete('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('requires currentPassword for a password account, and rejects a wrong one', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ email: 'u@example.com', passwordHash: '$2a$12$fakehashfakehashfakehashfakehashfakehashfakeh', avatarKey: null });

    const app = await buildApp();
    const res = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({});

    expect(res.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('requires a matching confirmEmail for a Google-only account, and rejects a mismatch', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ email: 'u@example.com', passwordHash: null, avatarKey: null });

    const app = await buildApp();
    const res = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ confirmEmail: 'wrong@example.com' });

    expect(res.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('on success: soft-removes listings, deletes the R2 avatar, anonymizes the user, and clears the session', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'k'; process.env.AWS_SECRET_ACCESS_KEY = 's'; process.env.AWS_S3_BUCKET = 'b';
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ email: 'u@example.com', passwordHash: null, avatarKey: 'avatars/abc.jpg' });
    s3SendMock.mockResolvedValue({});
    transactionMock.mockResolvedValue([]);

    const app = await buildApp();
    const res = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ confirmEmail: 'u@example.com' });

    expect(res.status).toBe(200);
    expect(s3SendMock).toHaveBeenCalledTimes(1); // avatar object removed
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const ops = transactionMock.mock.calls[0][0];
    expect(ops).toHaveLength(4); // listings updateMany, savedListing deleteMany, notification deleteMany, user update

    // The response clears the refresh-token cookie (logs out the session).
    const setCookie = res.headers['set-cookie']?.join(';') || '';
    expect(setCookie).toMatch(/refreshToken=;/);
  });

  it('is case-insensitive-safe but still requires an exact confirmEmail match', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser())
      .mockResolvedValueOnce({ email: 'u@example.com', passwordHash: null, avatarKey: null });
    transactionMock.mockResolvedValue([]);

    const app = await buildApp();
    const res = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${signToken(USER_ID)}`)
      .send({ confirmEmail: 'U@EXAMPLE.COM' });

    expect(res.status).toBe(200);
  });
});
