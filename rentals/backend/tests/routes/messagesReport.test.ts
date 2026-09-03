/**
 * Coverage for POST /messages/:id/report: participant-only access,
 * self-report blocking, and atomic message-content snapshotting.
 * Prisma is mocked, matching the established pattern in messages.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const USER_A = '11111111-1111-4111-8111-111111111111'; // sender of the message
const USER_B = '22222222-2222-4222-8222-222222222222'; // the other participant / reporter
const USER_C = '33333333-3333-4333-8333-333333333333'; // unrelated third user
const CONV_ID = '55555555-5555-4555-8555-555555555555';
const MSG_ID  = '66666666-6666-4666-8666-666666666666';

const userFindUniqueMock = vi.fn();
const messageFindUniqueMock = vi.fn();
const reportCreateMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user:    { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
    message: { findUnique: (...args: any[]) => messageFindUniqueMock(...args) },
    report:  { create: (...args: any[]) => reportCreateMock(...args) },
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
  const { default: messagesRoutes } = await import('../../src/routes/messages');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.set('io', { to: () => ({ emit: vi.fn() }) });
  app.use('/api/v1/messages', messagesRoutes);
  app.use(errorHandler);
  return app;
}

function messageRow(overrides: Record<string, any> = {}) {
  return {
    id: MSG_ID,
    body: 'Send me your bank info off-platform',
    senderId: USER_A,
    conversation: { participants: [{ userId: USER_A }, { userId: USER_B }] },
    ...overrides,
  };
}

beforeEach(() => {
  userFindUniqueMock.mockReset();
  messageFindUniqueMock.mockReset();
  reportCreateMock.mockReset();
});

describe('POST /messages/:id/report', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await request(app).post(`/api/v1/messages/${MSG_ID}/report`).send({ reason: 'Scam or fraud attempt' });
    expect(res.status).toBe(401);
  });

  it('404s a message that does not exist', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_B));
    messageFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/messages/${MSG_ID}/report`)
      .set('Authorization', `Bearer ${signToken(USER_B)}`)
      .send({ reason: 'Scam or fraud attempt' });

    expect(res.status).toBe(404);
    expect(reportCreateMock).not.toHaveBeenCalled();
  });

  it('403s a non-participant (OWASP A01)', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_C));
    messageFindUniqueMock.mockResolvedValue(messageRow());
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/messages/${MSG_ID}/report`)
      .set('Authorization', `Bearer ${signToken(USER_C)}`)
      .send({ reason: 'Spam' });

    expect(res.status).toBe(403);
    expect(reportCreateMock).not.toHaveBeenCalled();
  });

  it('blocks a self-report (sender reporting their own message)', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    messageFindUniqueMock.mockResolvedValue(messageRow());
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/messages/${MSG_ID}/report`)
      .set('Authorization', `Bearer ${signToken(USER_A)}`)
      .send({ reason: 'Spam' });

    expect(res.status).toBe(400);
    expect(reportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an off-taxonomy reason', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_B));
    messageFindUniqueMock.mockResolvedValue(messageRow());
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/messages/${MSG_ID}/report`)
      .set('Authorization', `Bearer ${signToken(USER_B)}`)
      .send({ reason: 'Misleading or fraudulent listing' }); // listing-only reason

    expect(res.status).toBe(422);
    expect(reportCreateMock).not.toHaveBeenCalled();
  });

  it('lets a real participant report the other side\'s message, snapshotting body + sender atomically and returning no report id', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_B));
    messageFindUniqueMock.mockResolvedValue(messageRow());
    reportCreateMock.mockResolvedValue({ id: 'report-1' });
    const app = await buildApp();

    const res = await request(app)
      .post(`/api/v1/messages/${MSG_ID}/report`)
      .set('Authorization', `Bearer ${signToken(USER_B)}`)
      .send({ reason: 'Scam or fraud attempt', description: 'Asked me to pay outside the app' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: expect.any(String) });
    expect(res.body.data).toBeUndefined();
    expect(reportCreateMock).toHaveBeenCalledWith({
      data: {
        reporterId:      USER_B,
        targetType:      'MESSAGE',
        messageId:       MSG_ID,
        messageSnapshot: 'Send me your bank info off-platform',
        reportedUserId:  USER_A,
        reason:          'Scam or fraud attempt',
        description:     'Asked me to pay outside the app',
      },
    });
  });
});
