/**
 * Unit coverage for the shared notification helpers (src/utils/notifications.ts):
 *  - createNotification writes the DB row and pushes it over the
 *    recipient's personal Socket.IO room, and tolerates a missing `io`
 *    (e.g. in contexts where the socket server isn't wired up).
 *  - isUserViewingConversation reads live Socket.IO room membership rather
 *    than any client-supplied claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const notificationCreateMock = vi.fn();

vi.mock('../../src/prisma/client', () => ({
  prisma: {
    notification: {
      create: (...args: any[]) => notificationCreateMock(...args),
    },
  },
}));

import { createNotification, isUserViewingConversation } from '../../src/utils/notifications';

beforeEach(() => {
  notificationCreateMock.mockReset();
});

describe('createNotification', () => {
  it('creates the DB row with the given fields and emits it over the recipient\'s personal room', async () => {
    const created = { id: 'n1', userId: 'u1', type: 'NEW_MESSAGE', title: 'New message', body: 'hi', data: { conversationId: 'c1' } };
    notificationCreateMock.mockResolvedValue(created);
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));

    const result = await createNotification({
      io: { to },
      userId: 'u1',
      type: 'NEW_MESSAGE',
      title: 'New message',
      body: 'hi',
      data: { conversationId: 'c1' },
    });

    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { userId: 'u1', type: 'NEW_MESSAGE', title: 'New message', body: 'hi', data: { conversationId: 'c1' } },
    });
    expect(to).toHaveBeenCalledWith('user:u1');
    expect(emit).toHaveBeenCalledWith('notification:new', created);
    expect(result).toBe(created);
  });

  it('still creates the DB row when io is missing (never throws)', async () => {
    notificationCreateMock.mockResolvedValue({ id: 'n2' });

    await expect(createNotification({
      io: undefined,
      userId: 'u1',
      type: 'LISTING_SAVED',
      title: 'Listing saved',
      body: 'Someone saved your listing',
    })).resolves.toEqual({ id: 'n2' });
  });
});

describe('isUserViewingConversation', () => {
  function fakeIo(rooms: Record<string, string[]>) {
    const roomsMap = new Map<string, Set<string>>();
    const socketsMap = new Map<string, { userId: string }>();
    let i = 0;
    for (const [room, userIds] of Object.entries(rooms)) {
      const set = new Set<string>();
      for (const userId of userIds) {
        const id = `s${i++}`;
        socketsMap.set(id, { userId });
        set.add(id);
      }
      roomsMap.set(room, set);
    }
    return { sockets: { adapter: { rooms: roomsMap }, sockets: socketsMap } };
  }

  it('returns true when the user has a socket joined to the conversation room', () => {
    const io = fakeIo({ 'conv:c1': ['u1', 'u2'] });
    expect(isUserViewingConversation(io, 'u1', 'c1')).toBe(true);
  });

  it('returns false when the user is not in the room', () => {
    const io = fakeIo({ 'conv:c1': ['u2'] });
    expect(isUserViewingConversation(io, 'u1', 'c1')).toBe(false);
  });

  it('returns false when the room does not exist at all', () => {
    const io = fakeIo({});
    expect(isUserViewingConversation(io, 'u1', 'c1')).toBe(false);
  });

  it('returns false when io itself is missing, rather than throwing', () => {
    expect(isUserViewingConversation(undefined, 'u1', 'c1')).toBe(false);
  });
});
