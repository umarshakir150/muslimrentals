/**
 * Regression coverage for the notification bell (PR E): unread badge,
 * dropdown of recent notifications, mark one/all as read, live updates via
 * the existing authenticated Socket.IO connection's 'notification:new'
 * event, and per-type deep-linking (with a graceful fallback when the
 * referenced entity's id is missing from the payload).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from './NotificationBell';
import { Notification } from '@/types';

// Same minimal real event-registration fake Inbox.test.tsx uses, so this
// exercises the actual .on()/.off()/handler-invocation contract, not just
// that the functions were called.
class FakeSocket {
  listeners: Record<string, Array<(...args: any[]) => void>> = {};
  on(event: string, handler: (...args: any[]) => void) {
    (this.listeners[event] ||= []).push(handler);
  }
  off(event: string, handler?: (...args: any[]) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = handler ? this.listeners[event].filter(h => h !== handler) : [];
  }
  serverPush(event: string, payload?: any) {
    [...(this.listeners[event] || [])].forEach(h => h(payload));
  }
}

const { connectSocketMock } = vi.hoisted(() => ({ connectSocketMock: vi.fn() }));
vi.mock('@/lib/socket', () => ({ connectSocket: connectSocketMock }));

const {
  getNotificationsMock,
  getNotificationsUnreadCountMock,
  markNotificationReadMock,
  markAllNotificationsReadMock,
} = vi.hoisted(() => ({
  getNotificationsMock: vi.fn(),
  getNotificationsUnreadCountMock: vi.fn(),
  markNotificationReadMock: vi.fn().mockResolvedValue({ data: {} }),
  markAllNotificationsReadMock: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/api', () => ({
  usersApi: {
    getNotifications: getNotificationsMock,
    getNotificationsUnreadCount: getNotificationsUnreadCountMock,
    markNotificationRead: markNotificationReadMock,
    markAllNotificationsRead: markAllNotificationsReadMock,
  },
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const USER = { id: 'user-1', name: 'Fatima', email: 'fatima@example.com', role: 'USER' };
let mockUser: typeof USER | null = USER;
vi.mock('@/store/authStore', () => ({ useUser: () => mockUser }));

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    type: 'NEW_MESSAGE',
    title: 'New message',
    body: 'Someone messaged about your listing: Cozy 2BR',
    isRead: false,
    data: { conversationId: 'conv-1' },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

let fakeSocket: FakeSocket;

beforeEach(() => {
  mockUser = USER;
  pushMock.mockReset();
  markNotificationReadMock.mockReset().mockResolvedValue({ data: {} });
  markAllNotificationsReadMock.mockReset().mockResolvedValue({ success: true });
  getNotificationsMock.mockReset().mockResolvedValue({ data: [] });
  getNotificationsUnreadCountMock.mockReset().mockResolvedValue({ data: { count: 0 } });
  fakeSocket = new FakeSocket();
  connectSocketMock.mockReset().mockReturnValue(fakeSocket);
});

describe('NotificationBell', () => {
  it('renders nothing when logged out', () => {
    mockUser = null;
    const { container } = render(<NotificationBell />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the unread count badge from the initial fetch', async () => {
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 3 } });
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('shows no badge when unread count is zero', async () => {
    render(<NotificationBell />);
    await waitFor(() => expect(getNotificationsUnreadCountMock).toHaveBeenCalled());
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('caps the badge display at "9+"', async () => {
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 14 } });
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('9+')).toBeInTheDocument());
  });

  it('opening the dropdown fetches and lists recent notifications', async () => {
    getNotificationsMock.mockResolvedValue({
      data: [makeNotification({ id: 'n1', title: 'New message' }), makeNotification({ id: 'n2', title: 'Listing saved', type: 'LISTING_SAVED', data: { listingId: 'l1' } })],
    });
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    await waitFor(() => expect(screen.getByText('New message')).toBeInTheDocument());
    expect(screen.getByText('Listing saved')).toBeInTheDocument();
  });

  it('shows an empty state when there are no notifications', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    await waitFor(() => expect(screen.getByText('No notifications yet.')).toBeInTheDocument());
  });

  it('clicking a NEW_MESSAGE notification marks it read and deep-links to that conversation', async () => {
    getNotificationsMock.mockResolvedValue({ data: [makeNotification({ id: 'n1', type: 'NEW_MESSAGE', data: { conversationId: 'conv-42' } })] });
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 1 } });
    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('New message')).toBeInTheDocument());
    await user.click(screen.getByText('New message'));

    expect(markNotificationReadMock).toHaveBeenCalledWith('n1');
    expect(pushMock).toHaveBeenCalledWith('/messages?conv=conv-42');
    // Optimistically cleared immediately, not waiting on the API call.
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument());
  });

  it.each([
    ['LISTING_SAVED', { listingId: 'l1' }, '/my-listings?listingId=l1'],
    ['LISTING_REMOVED', { listingId: 'l2' }, '/my-listings?listingId=l2'],
    ['LISTING_RESTORED', { listingId: 'l3' }, '/my-listings?listingId=l3'],
  ])('clicking a %s notification deep-links to that listing on My Listings', async (type, data, expectedHref) => {
    getNotificationsMock.mockResolvedValue({ data: [makeNotification({ id: 'n1', type, title: 'Listing update', data })] });
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('Listing update')).toBeInTheDocument());

    await user.click(screen.getByText('Listing update'));
    expect(pushMock).toHaveBeenCalledWith(expectedHref);
  });

  it('falls back to /my-listings when a listing notification is missing its listingId', async () => {
    getNotificationsMock.mockResolvedValue({ data: [makeNotification({ id: 'n1', type: 'LISTING_REMOVED', title: 'Listing removed', data: {} })] });
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('Listing removed')).toBeInTheDocument());

    await user.click(screen.getByText('Listing removed'));
    expect(pushMock).toHaveBeenCalledWith('/my-listings');
  });

  it('does not navigate anywhere for an unrecognized notification type, but still marks it read', async () => {
    getNotificationsMock.mockResolvedValue({ data: [makeNotification({ id: 'n1', type: 'SOMETHING_FUTURE', title: 'Future thing' })] });
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('Future thing')).toBeInTheDocument());

    await user.click(screen.getByText('Future thing'));
    expect(markNotificationReadMock).toHaveBeenCalledWith('n1');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not re-call mark-read for a notification that is already read', async () => {
    getNotificationsMock.mockResolvedValue({ data: [makeNotification({ id: 'n1', isRead: true, title: 'Already read' })] });
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('Already read')).toBeInTheDocument());

    await user.click(screen.getByText('Already read'));
    expect(markNotificationReadMock).not.toHaveBeenCalled();
  });

  it('"Mark all read" clears the badge and marks every listed notification read', async () => {
    getNotificationsUnreadCountMock.mockResolvedValue({ data: { count: 2 } });
    getNotificationsMock.mockResolvedValue({
      data: [makeNotification({ id: 'n1', isRead: false }), makeNotification({ id: 'n2', isRead: false, title: 'Second' })],
    });
    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(markAllNotificationsReadMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('2')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument();
  });

  it('live "notification:new" over the socket increments the badge and prepends to an already-loaded list', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(connectSocketMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('No notifications yet.')).toBeInTheDocument());

    fakeSocket.serverPush('notification:new', makeNotification({ id: 'live-1', title: 'Live notification' }));

    await waitFor(() => expect(screen.getByText('Live notification')).toBeInTheDocument());
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('a live notification for an id already in the list is not duplicated', async () => {
    getNotificationsMock.mockResolvedValue({ data: [makeNotification({ id: 'n1', title: 'Existing' })] });
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByText('Existing')).toBeInTheDocument());

    fakeSocket.serverPush('notification:new', makeNotification({ id: 'n1', title: 'Existing' }));

    expect(screen.getAllByText('Existing')).toHaveLength(1);
  });

  it('detaches the socket listener on unmount', async () => {
    const { unmount } = render(<NotificationBell />);
    await waitFor(() => expect(connectSocketMock).toHaveBeenCalled());
    expect(fakeSocket.listeners['notification:new']?.length).toBe(1);

    unmount();
    expect(fakeSocket.listeners['notification:new']?.length).toBe(0);
  });
});
