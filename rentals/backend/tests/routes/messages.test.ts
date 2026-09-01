/**
 * Regression + end-to-end coverage for the messaging REST endpoints
 * (messages.ts): starting a conversation from a listing, replying,
 * unread counts, and participant-only access control -- exercised with
 * two distinct real, signed JWTs going through the real `authenticate`
 * middleware, not just unit-level route logic.
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

const USER_A = '11111111-1111-4111-8111-111111111111'; // the tenant, messaging in
const USER_B = '22222222-2222-4222-8222-222222222222'; // the landlord, owns the listing
const USER_C = '33333333-3333-4333-8333-333333333333'; // unrelated third user
const LISTING_ID = '44444444-4444-4444-8444-444444444444';
const CONV_ID    = '55555555-5555-4555-8555-555555555555';

const userFindUniqueMock  = vi.fn(); // authenticate() middleware's own lookup
const listingFindUniqueMock  = vi.fn();
const conversationFindFirstMock  = vi.fn();
const conversationFindUniqueMock = vi.fn();
const conversationFindManyMock   = vi.fn();
const conversationCreateMock     = vi.fn();
const conversationUpdateMock     = vi.fn();
const messageCreateMock          = vi.fn();
const messageCountMock           = vi.fn();
const messageUpdateManyMock      = vi.fn();
const participantUpdateManyMock  = vi.fn();
const notificationCreateMock     = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user:     { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
    listing:  { findUnique: (...args: any[]) => listingFindUniqueMock(...args) },
    conversation: {
      findFirst:  (...args: any[]) => conversationFindFirstMock(...args),
      findUnique: (...args: any[]) => conversationFindUniqueMock(...args),
      findMany:   (...args: any[]) => conversationFindManyMock(...args),
      create:     (...args: any[]) => conversationCreateMock(...args),
      update:     (...args: any[]) => conversationUpdateMock(...args),
    },
    message: {
      create:     (...args: any[]) => messageCreateMock(...args),
      count:      (...args: any[]) => messageCountMock(...args),
      updateMany: (...args: any[]) => messageUpdateManyMock(...args),
    },
    conversationParticipant: {
      updateMany: (...args: any[]) => participantUpdateManyMock(...args),
    },
    notification: { create: (...args: any[]) => notificationCreateMock(...args) },
  },
}));

function signToken(userId: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role: 'USER' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

function activeUser(id: string, overrides: Record<string, any> = {}) {
  return { id, email: `${id}@example.com`, role: 'USER', name: `User ${id.slice(0, 4)}`, isActive: true, isBanned: false, ...overrides };
}

// Fake Socket.IO server attached to the app the same way index.ts does
// (`app.set('io', server)`), so the route handlers' `req.app.get('io')`
// calls resolve to something real-shaped without booting an actual
// Socket.IO server for these REST-only tests.
function fakeIo() {
  const to = vi.fn(() => ({ emit: vi.fn() }));
  return { to, __to: to };
}

async function buildApp(io: ReturnType<typeof fakeIo>) {
  vi.resetModules();
  const { default: messagesRoutes } = await import('../../src/routes/messages');
  const { errorHandler } = await import('../../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.set('io', io);
  app.use('/api/v1/messages', messagesRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  userFindUniqueMock.mockReset();
  listingFindUniqueMock.mockReset();
  conversationFindFirstMock.mockReset();
  conversationFindUniqueMock.mockReset();
  conversationFindManyMock.mockReset();
  conversationCreateMock.mockReset();
  conversationUpdateMock.mockReset();
  messageCreateMock.mockReset();
  messageCountMock.mockReset();
  messageUpdateManyMock.mockReset();
  participantUpdateManyMock.mockReset();
  notificationCreateMock.mockReset();
});

describe('POST /messages/conversations (start a conversation)', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp(fakeIo());
    const res = await request(app).post('/api/v1/messages/conversations').send({ listingId: LISTING_ID, body: 'hi' });
    expect(res.status).toBe(401);
  });

  it('rejects messaging your own listing', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_B));
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, userId: USER_B, title: 'My place' });
    const app = await buildApp(fakeIo());

    const res = await request(app)
      .post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${signToken(USER_B)}`)
      .send({ listingId: LISTING_ID, body: 'hi' });

    expect(res.status).toBe(400);
  });

  it('rejects a listing that does not exist', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    listingFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp(fakeIo());

    const res = await request(app)
      .post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${signToken(USER_A)}`)
      .send({ listingId: LISTING_ID, body: 'hi' });

    expect(res.status).toBe(404);
  });

  it('rejects an oversized message body', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    const app = await buildApp(fakeIo());

    const res = await request(app)
      .post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${signToken(USER_A)}`)
      .send({ listingId: LISTING_ID, body: 'x'.repeat(2001) });

    expect(res.status).toBe(422);
  });

  it('user A (tenant) starts a new conversation with user B (landlord): creates the conversation, notifies B, and emits over the landlord\'s personal room', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, userId: USER_B, title: 'Cozy 2BR' });
    conversationFindFirstMock.mockResolvedValue(null); // no existing thread yet
    conversationCreateMock.mockResolvedValue({
      id: CONV_ID,
      listingId: LISTING_ID,
      messages: [{ id: 'm1', body: "I'm interested!", senderId: USER_A }],
      participants: [{ userId: USER_A }, { userId: USER_B }],
    });
    notificationCreateMock.mockResolvedValue({ id: 'n1' });

    const io = fakeIo();
    const app = await buildApp(io);

    const res = await request(app)
      .post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${signToken(USER_A)}`)
      .send({ listingId: LISTING_ID, body: "I'm interested!" });

    expect(res.status).toBe(201);
    expect(res.body.data.conversationId).toBe(CONV_ID);
    expect(conversationCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        listingId: LISTING_ID,
        participants: { create: [{ userId: USER_A }, { userId: USER_B }] },
      }),
    }));
    // Real-time: the landlord (not the sender) is notified over their own room.
    expect(io.__to).toHaveBeenCalledWith(`user:${USER_B}`);
    expect(notificationCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: USER_B, type: 'NEW_MESSAGE' }),
    }));
  });

  it('a second message to the same listing appends to the existing conversation instead of creating a duplicate', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    listingFindUniqueMock.mockResolvedValue({ id: LISTING_ID, userId: USER_B, title: 'Cozy 2BR' });
    conversationFindFirstMock.mockResolvedValue({ id: CONV_ID });
    messageCreateMock.mockResolvedValue({ id: 'm2', conversationId: CONV_ID, senderId: USER_A, body: 'follow-up' });
    conversationUpdateMock.mockResolvedValue({});

    const io = fakeIo();
    const app = await buildApp(io);

    const res = await request(app)
      .post('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${signToken(USER_A)}`)
      .send({ listingId: LISTING_ID, body: 'follow-up' });

    expect(res.status).toBe(200);
    expect(res.body.data.conversationId).toBe(CONV_ID);
    expect(conversationCreateMock).not.toHaveBeenCalled();
    expect(io.__to).toHaveBeenCalledWith(`conv:${CONV_ID}`);
  });
});

describe('POST /messages/conversations/:id/messages (reply)', () => {
  it('lets a real participant (user B, the landlord) reply, and broadcasts to the conversation room', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_B));
    conversationFindUniqueMock.mockResolvedValue({
      id: CONV_ID,
      participants: [{ userId: USER_A }, { userId: USER_B }],
    });
    messageCreateMock.mockResolvedValue({ id: 'm3', conversationId: CONV_ID, senderId: USER_B, body: 'Sure, come by Friday' });
    conversationUpdateMock.mockResolvedValue({});

    const io = fakeIo();
    const app = await buildApp(io);

    const res = await request(app)
      .post(`/api/v1/messages/conversations/${CONV_ID}/messages`)
      .set('Authorization', `Bearer ${signToken(USER_B)}`)
      .send({ body: 'Sure, come by Friday' });

    expect(res.status).toBe(201);
    expect(res.body.data.senderId).toBe(USER_B);
    expect(io.__to).toHaveBeenCalledWith(`conv:${CONV_ID}`);
  });

  it('rejects a reply from a user who is not a participant (OWASP A01)', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_C));
    conversationFindUniqueMock.mockResolvedValue({
      id: CONV_ID,
      participants: [{ userId: USER_A }, { userId: USER_B }],
    });
    const app = await buildApp(fakeIo());

    const res = await request(app)
      .post(`/api/v1/messages/conversations/${CONV_ID}/messages`)
      .set('Authorization', `Bearer ${signToken(USER_C)}`)
      .send({ body: 'let me in' });

    expect(res.status).toBe(403);
    expect(messageCreateMock).not.toHaveBeenCalled();
  });

  it('404s for a conversation that does not exist', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    conversationFindUniqueMock.mockResolvedValue(null);
    const app = await buildApp(fakeIo());

    const res = await request(app)
      .post(`/api/v1/messages/conversations/${CONV_ID}/messages`)
      .set('Authorization', `Bearer ${signToken(USER_A)}`)
      .send({ body: 'hello?' });

    expect(res.status).toBe(404);
  });

  it('rejects an invalid conversation id', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    const app = await buildApp(fakeIo());

    const res = await request(app)
      .post('/api/v1/messages/conversations/not-a-uuid/messages')
      .set('Authorization', `Bearer ${signToken(USER_A)}`)
      .send({ body: 'hello?' });

    expect(res.status).toBe(400);
  });
});

describe('GET /messages/conversations/:id (open a thread)', () => {
  it('403s a non-participant, never leaking the thread', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_C));
    conversationFindUniqueMock.mockResolvedValue({
      id: CONV_ID,
      participants: [{ userId: USER_A }, { userId: USER_B }],
      messages: [],
    });
    const app = await buildApp(fakeIo());

    const res = await request(app)
      .get(`/api/v1/messages/conversations/${CONV_ID}`)
      .set('Authorization', `Bearer ${signToken(USER_C)}`);

    expect(res.status).toBe(403);
  });

  it('a real participant opening the thread marks the other side\'s messages read (read receipts)', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    conversationFindUniqueMock.mockResolvedValue({
      id: CONV_ID,
      participants: [{ userId: USER_A }, { userId: USER_B }],
      messages: [{ id: 'm1', senderId: USER_B, body: 'hi', isRead: false }],
    });
    messageUpdateManyMock.mockResolvedValue({ count: 1 });
    participantUpdateManyMock.mockResolvedValue({ count: 1 });

    const app = await buildApp(fakeIo());
    const res = await request(app)
      .get(`/api/v1/messages/conversations/${CONV_ID}`)
      .set('Authorization', `Bearer ${signToken(USER_A)}`);

    expect(res.status).toBe(200);
    expect(messageUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ conversationId: CONV_ID, senderId: { not: USER_A }, isRead: false }),
      data:  { isRead: true },
    }));
    expect(participantUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: CONV_ID, userId: USER_A },
    }));
  });
});

describe('GET /messages/conversations (inbox list)', () => {
  it('only returns conversations the caller participates in, with a per-conversation unread count', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    conversationFindManyMock.mockResolvedValue([
      { id: CONV_ID, participants: [{ userId: USER_A, lastReadAt: null }, { userId: USER_B, lastReadAt: null }], messages: [] },
    ]);
    messageCountMock.mockResolvedValue(2);

    const app = await buildApp(fakeIo());
    const res = await request(app)
      .get('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${signToken(USER_A)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].unreadCount).toBe(2);
    expect(conversationFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { participants: { some: { userId: USER_A } } },
    }));
  });
});

describe('GET /messages/unread-count', () => {
  it('counts only unread messages from the other side, across all of the caller\'s conversations', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_B));
    messageCountMock.mockResolvedValue(3);
    const app = await buildApp(fakeIo());

    const res = await request(app)
      .get('/api/v1/messages/unread-count')
      .set('Authorization', `Bearer ${signToken(USER_B)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(messageCountMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        conversation: { participants: { some: { userId: USER_B } } },
        senderId: { not: USER_B },
        isRead: false,
      }),
    }));
  });
});
