/**
 * Unit coverage for the shared notification helper (src/utils/notifications.ts):
 * createNotification writes the DB row and pushes it over the recipient's
 * personal Socket.IO room, and tolerates a missing `io` (e.g. in contexts
 * where the socket server isn't wired up).
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

import { createNotification } from '../../src/utils/notifications';

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
