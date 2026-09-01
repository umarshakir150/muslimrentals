/**
 * End-to-end coverage for the Socket.IO real-time layer (socketServer.ts):
 * a real HTTP server + real `Server` + two real `socket.io-client`
 * connections, each authenticated as a distinct user with a genuinely
 * signed JWT going through the real `io.use()` auth middleware -- not a
 * mocked event emitter. Only Prisma is mocked (no test database wired up
 * in this repo yet, same established pattern as the REST route tests).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333'; // not a participant
const CONV_ID = '55555555-5555-4555-8555-555555555555';

const userFindUniqueMock = vi.fn();
const participantFindUniqueMock = vi.fn();
const messageUpdateManyMock = vi.fn();
const participantUpdateManyMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    user:  { findUnique: (...args: any[]) => userFindUniqueMock(...args) },
    conversationParticipant: {
      findUnique: (...args: any[]) => participantFindUniqueMock(...args),
      updateMany: (...args: any[]) => participantUpdateManyMock(...args),
    },
    message: { updateMany: (...args: any[]) => messageUpdateManyMock(...args) },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function activeUser(id: string, overrides: Record<string, any> = {}) {
  return { id, name: `User ${id.slice(0, 4)}`, isActive: true, isBanned: false, ...overrides };
}

function signToken(userId: string) {
  return jwt.sign({ userId, email: `${userId}@example.com`, role: 'USER' }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

let httpServer: HttpServer;
let io: SocketIOServer;
let port: number;

async function connectClient(token: string): Promise<ClientSocket> {
  const socket = ioClient(`http://localhost:${port}`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err) => reject(err));
  });
  return socket;
}

function waitForEvent(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

beforeEach(async () => {
  vi.resetModules();
  userFindUniqueMock.mockReset();
  participantFindUniqueMock.mockReset();
  messageUpdateManyMock.mockReset();
  participantUpdateManyMock.mockReset();

  const { setupSocketIO } = await import('../../src/socket/socketServer');
  httpServer = createServer();
  io = new SocketIOServer(httpServer);
  setupSocketIO(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('Socket.IO authentication', () => {
  it('rejects a connection with no token', async () => {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    await expect(new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    })).rejects.toThrow(/Authentication required/);
    socket.close();
  });

  it('rejects a banned account even with a structurally valid token', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A, { isBanned: true }));
    const socket = ioClient(`http://localhost:${port}`, {
      auth: { token: signToken(USER_A) },
      transports: ['websocket'],
      forceNew: true,
    });
    await expect(new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    })).rejects.toThrow(/Account not available/);
    socket.close();
  });

  it('accepts a real, active user with a genuinely signed token', async () => {
    userFindUniqueMock.mockResolvedValue(activeUser(USER_A));
    const socket = await connectClient(signToken(USER_A));
    expect(socket.connected).toBe(true);
    socket.close();
  });
});

describe('Two real authenticated users messaging in real time', () => {
  it('user A can join a conversation they participate in; a stranger (user C) is rejected', async () => {
    userFindUniqueMock.mockImplementation((args: any) =>
      Promise.resolve(activeUser(args.where.id))
    );
    participantFindUniqueMock.mockImplementation((args: any) => {
      const { conversationId, userId } = args.where.conversationId_userId;
      const isParticipant = conversationId === CONV_ID && [USER_A, USER_B].includes(userId);
      return Promise.resolve(isParticipant ? { id: 'p1', conversationId, userId } : null);
    });

    const clientA = await connectClient(signToken(USER_A));
    const clientC = await connectClient(signToken(USER_C));

    // A stranger's join attempt is rejected with an explicit error, not silently ignored.
    const cErrorPromise = waitForEvent(clientC, 'error');
    clientC.emit('conversation:join', CONV_ID);
    await expect(cErrorPromise).resolves.toEqual({ message: 'Not authorized.' });

    // The real participant's join succeeds -- no error event fires for them.
    let aGotError = false;
    clientA.once('error', () => { aGotError = true; });
    clientA.emit('conversation:join', CONV_ID);
    await new Promise((r) => setTimeout(r, 150));
    expect(aGotError).toBe(false);

    clientA.close();
    clientC.close();
  });

  it('typing indicators travel from user A to user B in real time, but never echo back to the sender', async () => {
    userFindUniqueMock.mockImplementation((args: any) => Promise.resolve(activeUser(args.where.id)));
    participantFindUniqueMock.mockResolvedValue({ id: 'p1', conversationId: CONV_ID, userId: USER_A });

    const clientA = await connectClient(signToken(USER_A));
    const clientB = await connectClient(signToken(USER_B));
    clientA.emit('conversation:join', CONV_ID);
    clientB.emit('conversation:join', CONV_ID);
    await new Promise((r) => setTimeout(r, 150));

    let aReceivedOwnTyping = false;
    clientA.once('typing:start', () => { aReceivedOwnTyping = true; });

    const bTypingPromise = waitForEvent(clientB, 'typing:start');
    clientA.emit('typing:start', { conversationId: CONV_ID });

    const payload = await bTypingPromise;
    expect(payload.userId).toBe(USER_A);

    const bStopPromise = waitForEvent(clientB, 'typing:stop');
    clientA.emit('typing:stop', { conversationId: CONV_ID });
    await expect(bStopPromise).resolves.toEqual({ userId: USER_A });

    await new Promise((r) => setTimeout(r, 100));
    expect(aReceivedOwnTyping).toBe(false); // socket.to() excludes the sender's own socket

    clientA.close();
    clientB.close();
  });

  it('marking messages read updates the DB and notifies the other participant in real time (read receipts)', async () => {
    userFindUniqueMock.mockImplementation((args: any) => Promise.resolve(activeUser(args.where.id)));
    participantFindUniqueMock.mockImplementation((args: any) => {
      const { userId } = args.where.conversationId_userId;
      return Promise.resolve([USER_A, USER_B].includes(userId) ? { id: 'p1', conversationId: CONV_ID, userId } : null);
    });
    messageUpdateManyMock.mockResolvedValue({ count: 2 });
    participantUpdateManyMock.mockResolvedValue({ count: 1 });

    const clientA = await connectClient(signToken(USER_A));
    const clientB = await connectClient(signToken(USER_B));
    clientA.emit('conversation:join', CONV_ID);
    clientB.emit('conversation:join', CONV_ID);
    await new Promise((r) => setTimeout(r, 150));

    const bReadPromise = waitForEvent(clientB, 'messages:read');
    clientA.emit('messages:read', { conversationId: CONV_ID });

    const payload = await bReadPromise;
    expect(payload).toEqual({ userId: USER_A, conversationId: CONV_ID });
    expect(messageUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ conversationId: CONV_ID, senderId: { not: USER_A }, isRead: false }),
    }));
    expect(participantUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: CONV_ID, userId: USER_A },
    }));

    clientA.close();
    clientB.close();
  });

  it('a non-participant cannot mark another conversation\'s messages as read', async () => {
    userFindUniqueMock.mockImplementation((args: any) => Promise.resolve(activeUser(args.where.id)));
    participantFindUniqueMock.mockResolvedValue(null); // USER_C is not in this conversation

    const clientC = await connectClient(signToken(USER_C));
    clientC.emit('messages:read', { conversationId: CONV_ID });
    await new Promise((r) => setTimeout(r, 150));

    expect(messageUpdateManyMock).not.toHaveBeenCalled();
    expect(participantUpdateManyMock).not.toHaveBeenCalled();

    clientC.close();
  });
});
