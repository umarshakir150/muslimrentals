/**
 * Coverage for POST /users/:id/report: the mandatory prior-interaction gate
 * (shared-conversation path, listing-interaction path, and the rejection
 * case with no qualifying interaction), plus self-report blocking.
 * Prisma is mocked, matching the established pattern in messages.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const REPORTER = '11111111-1111-4111-8111-111111111111';
const TARGET   = '22222222-2222-4222-8222-222222222222';

const userFindUniqueMock = vi.fn(); // both authenticate()'s lookup and the target-existence lookup
const conversationFindFirstMock = vi.fn();
const listingFindFirstMock = vi.fn();
const reportCreateMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user:         { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
    conversation: { findFirst: (...args: any[]) => conversationFindFirstMock(...args) },
    listing:      { findFirst: (...args: any[]) => listingFindFirstMock(...args) },
    report:       { create: (...args: any[]) => reportCreateMock(...args) },
  },
}));

function signToken(userId: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role: 'USER' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function activeUser(id: string) {
  return { id, email: `${id}@example.com`, role: 'USER', name: `User ${id.slice(0, 4)}`, isActive: true, isBanned: false };
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
  userFindUniqueMock.mockReset();
  conversationFindFirstMock.mockReset();
  listingFindFirstMock.mockReset();
  reportCreateMock.mockReset();
});

describe('POST /users/:id/report', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).post(`/api/v1/users/${TARGET}/report`).send({ reason: 'Spam' });
    expect(res.status).toBe(401);
  });

  it('blocks a self-report', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(REPORTER));
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/users/${REPORTER}/report`)
      .set('Authorization', `Bearer ${signToken(REPORTER)}`)
      .send({ reason: 'Spam' });

    expect(res.status).toBe(400);
    expect(reportCreateMock).not.toHaveBeenCalled();
  });

  it('404s a target user that does not exist', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser(REPORTER)) // authenticate()
      .mockResolvedValueOnce(null);                // target lookup
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/users/${TARGET}/report`)
      .set('Authorization', `Bearer ${signToken(REPORTER)}`)
      .send({ reason: 'Spam' });

    expect(res.status).toBe(404);
    expect(reportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects (403) when no qualifying prior interaction exists', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser(REPORTER))
      .mockResolvedValueOnce({ id: TARGET });
    conversationFindFirstMock.mockResolvedValue(null);
    listingFindFirstMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/users/${TARGET}/report`)
      .set('Authorization', `Bearer ${signToken(REPORTER)}`)
      .send({ reason: 'Harassment or abusive behavior' });

    expect(res.status).toBe(403);
    expect(reportCreateMock).not.toHaveBeenCalled();
  });

  it('allows the report when the reporter and target share an existing conversation', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser(REPORTER))
      .mockResolvedValueOnce({ id: TARGET });
    conversationFindFirstMock.mockResolvedValue({ id: 'conv-1' });
    listingFindFirstMock.mockResolvedValue(null);
    reportCreateMock.mockResolvedValue({ id: 'report-1' });
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/users/${TARGET}/report`)
      .set('Authorization', `Bearer ${signToken(REPORTER)}`)
      .send({ reason: 'Harassment or abusive behavior' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: expect.any(String) });
    expect(reportCreateMock).toHaveBeenCalledWith({
      data: {
        reporterId:     REPORTER,
        targetType:     'USER',
        reportedUserId: TARGET,
        reason:         'Harassment or abusive behavior',
        description:    undefined,
      },
    });
  });

  it('allows the report via a listing-interaction path even with no shared conversation', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser(REPORTER))
      .mockResolvedValueOnce({ id: TARGET });
    conversationFindFirstMock.mockResolvedValue(null);
    listingFindFirstMock.mockResolvedValue({ id: 'listing-1' }); // reporter saved / messaged about target's listing
    reportCreateMock.mockResolvedValue({ id: 'report-2' });
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/users/${TARGET}/report`)
      .set('Authorization', `Bearer ${signToken(REPORTER)}`)
      .send({ reason: 'Scam or fraud attempt' });

    expect(res.status).toBe(200);
    expect(listingFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: TARGET,
        OR: expect.arrayContaining([
          expect.objectContaining({ conversations: expect.anything() }),
          expect.objectContaining({ savedBy: expect.anything() }),
        ]),
      }),
    }));
    expect(reportCreateMock).toHaveBeenCalled();
  });

  it('rejects an off-taxonomy reason (e.g. a listing-only reason)', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(activeUser(REPORTER))
      .mockResolvedValueOnce({ id: TARGET });
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/users/${TARGET}/report`)
      .set('Authorization', `Bearer ${signToken(REPORTER)}`)
      .send({ reason: 'Misleading or fraudulent listing' });

    expect(res.status).toBe(422);
    expect(reportCreateMock).not.toHaveBeenCalled();
  });
});
