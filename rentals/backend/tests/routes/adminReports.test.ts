/**
 * Coverage for GET /admin/reports' targetType branching: LISTING reports
 * keep their existing shape, USER reports include the reported user's
 * identity/restriction history plus the reporter's own report-history
 * stats, and MESSAGE reports include the frozen messageSnapshot + sender +
 * conversation link. Prisma is mocked, matching this repo's established
 * pattern (see messages.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-at-least-32-chars';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

const userFindUniqueMock = vi.fn();
const reportFindManyMock = vi.fn();
const reportGroupByMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user:   { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
    report: {
      findMany: (...args: any[]) => reportFindManyMock(...args),
      groupBy:  (...args: any[]) => reportGroupByMock(...args),
    },
  },
}));

function signToken(userId: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role: 'ADMIN' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function adminUser() {
  return { id: ADMIN_ID, email: 'admin@example.com', role: 'ADMIN', name: 'Admin', isActive: true, isBanned: false };
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
  reportFindManyMock.mockReset();
  reportGroupByMock.mockReset();
});

describe('GET /admin/reports', () => {
  it('rejects a non-admin/moderator role', async () => {
    userFindUniqueMock.mockResolvedValue({ id: 'u1', email: 'u1@example.com', role: 'USER', name: 'U', isActive: true, isBanned: false });
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 'u1', email: 'u1@example.com', role: 'USER' }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '15m' })}`);

    expect(res.status).toBe(403);
  });

  it('returns a LISTING report with its listing context, unchanged from before', async () => {
    userFindUniqueMock.mockResolvedValue(adminUser());
    reportFindManyMock.mockResolvedValue([
      {
        id: 'r1', targetType: 'LISTING', reporterId: 'reporter-1', status: 'PENDING',
        reporter: { id: 'reporter-1', name: 'Rep', email: 'rep@example.com' },
        listing:  { id: 'listing-1', title: 'Cozy place' },
        reportedUser: null, message: null,
      },
    ]);
    reportGroupByMock.mockResolvedValue([]);
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].listing).toEqual({ id: 'listing-1', title: 'Cozy place' });
    expect(res.body.data[0].reporterHistory).toBeUndefined();
  });

  it('returns a USER report with the reported user\'s identity/restriction history and the reporter\'s own report-history stats', async () => {
    userFindUniqueMock.mockResolvedValue(adminUser());
    reportFindManyMock.mockResolvedValue([
      {
        id: 'r2', targetType: 'USER', reporterId: 'reporter-2', status: 'PENDING',
        reporter: { id: 'reporter-2', name: 'Rep2', email: 'rep2@example.com' },
        listing: null, message: null,
        reportedUser: { id: 'target-1', name: 'Target', email: 'target@example.com', isBanned: false, banReason: null, createdAt: new Date() },
      },
    ]);
    reportGroupByMock.mockResolvedValue([
      { reporterId: 'reporter-2', status: 'PENDING', _count: { _all: 2 } },
      { reporterId: 'reporter-2', status: 'DISMISSED', _count: { _all: 1 } },
    ]);
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].reportedUser).toEqual(expect.objectContaining({ id: 'target-1', isBanned: false }));
    expect(res.body.data[0].reporterHistory).toEqual({ totalFiled: 3, dismissed: 1 });
  });

  it('returns a MESSAGE report with the frozen snapshot, sender identity, derived recipient, timestamp, and conversation id', async () => {
    userFindUniqueMock.mockResolvedValue(adminUser());
    const messageCreatedAt = new Date('2026-09-01T12:00:00.000Z');
    reportFindManyMock.mockResolvedValue([
      {
        id: 'r3', targetType: 'MESSAGE', reporterId: 'reporter-3', status: 'PENDING',
        reporter: { id: 'reporter-3', name: 'Rep3', email: 'rep3@example.com' },
        listing: null, reportedUser: null,
        message: {
          id: 'msg-1',
          conversationId: 'conv-1',
          createdAt: messageCreatedAt,
          senderId: 'sender-1',
          sender: { id: 'sender-1', name: 'Sender', email: 'sender@example.com' },
          conversation: {
            participants: [
              { userId: 'sender-1', user: { id: 'sender-1', name: 'Sender', email: 'sender@example.com' } },
              { userId: 'recipient-1', user: { id: 'recipient-1', name: 'Recipient', email: 'recipient@example.com' } },
            ],
          },
        },
        messageSnapshot: 'Pay me outside the app',
      },
    ]);
    reportGroupByMock.mockResolvedValue([]);
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].message).toEqual(
      expect.objectContaining({ conversationId: 'conv-1', createdAt: messageCreatedAt.toISOString(), sender: expect.objectContaining({ id: 'sender-1' }) })
    );
    // The raw nested conversation/participants payload is an implementation
    // detail for deriving `recipient` below -- it must not leak to the client.
    expect(res.body.data[0].message.conversation).toBeUndefined();
    expect(res.body.data[0].recipient).toEqual(expect.objectContaining({ id: 'recipient-1', name: 'Recipient' }));
    expect(res.body.data[0].messageSnapshot).toBe('Pay me outside the app');
  });

  it('derives a null recipient for a MESSAGE report when conversation context is unavailable', async () => {
    userFindUniqueMock.mockResolvedValue(adminUser());
    reportFindManyMock.mockResolvedValue([
      {
        id: 'r4', targetType: 'MESSAGE', reporterId: 'reporter-4', status: 'PENDING',
        reporter: { id: 'reporter-4', name: 'Rep4', email: 'rep4@example.com' },
        listing: null, reportedUser: null,
        message: {
          id: 'msg-2', conversationId: 'conv-2', createdAt: new Date(), senderId: 'sender-2',
          sender: { id: 'sender-2', name: 'Sender2', email: 'sender2@example.com' },
          conversation: null,
        },
        messageSnapshot: 'deleted message content',
      },
    ]);
    reportGroupByMock.mockResolvedValue([]);
    const app = await buildApp();

    const res = await request(app)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${signToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].recipient).toBeNull();
  });
});
