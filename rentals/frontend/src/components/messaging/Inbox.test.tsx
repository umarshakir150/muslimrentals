import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Inbox from './Inbox';
import { Message, Conversation } from '@/types';

/**
 * Regression coverage for the "my own message appears twice" bug reported
 * on PR #4's preview: sending a message inserted it once from the REST
 * response (no id dedup) and, because the sender is already in the
 * conversation's Socket.IO room from opening it, the server's broadcast of
 * that same row could arrive around the same time via 'message:new' and
 * get inserted a second time. Fixed by id-deduping both insertion paths,
 * fixing a stale-closure bug in the socket handlers (they captured
 * `activeConv` at mount time, always `null`), and adding proper .off()
 * listener cleanup so remounting Inbox doesn't stack duplicate handlers on
 * the persistent socket singleton.
 */

// A minimal, real event-registration fake -- not a jest.fn() stub -- so
// these tests exercise the actual .on()/.off()/handler-invocation contract
// Inbox.tsx relies on, the same way the real socket.io-client would.
class FakeSocket {
  listeners: Record<string, Array<(...args: any[]) => void>> = {};
  emitted: { event: string; payload?: any }[] = [];
  connected = true;

  on(event: string, handler: (...args: any[]) => void) {
    (this.listeners[event] ||= []).push(handler);
  }
  off(event: string, handler?: (...args: any[]) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = handler ? this.listeners[event].filter(h => h !== handler) : [];
  }
  emit(event: string, payload?: any) {
    this.emitted.push({ event, payload });
  }
  // Test helper only: simulate the server pushing an event to this client,
  // exactly like a real socket.io-client firing a registered handler.
  serverPush(event: string, payload?: any) {
    [...(this.listeners[event] || [])].forEach(h => h(payload));
  }
}

const { connectSocketMock } = vi.hoisted(() => ({ connectSocketMock: vi.fn() }));
vi.mock('@/lib/socket', () => ({
  connectSocket: connectSocketMock,
  disconnectSocket: vi.fn(),
}));

const { getConversationsMock, getConversationMock, sendMessageMock, reportMessageMock, reportUserMock } = vi.hoisted(() => ({
  getConversationsMock: vi.fn(),
  getConversationMock: vi.fn(),
  sendMessageMock: vi.fn(),
  reportMessageMock: vi.fn().mockResolvedValue({ success: true }),
  reportUserMock: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/api', () => ({
  messagesApi: {
    getConversations: getConversationsMock,
    getConversation: getConversationMock,
    startConversation: vi.fn(),
    sendMessage: sendMessageMock,
    getUnreadCount: vi.fn().mockResolvedValue({ data: { count: 0 } }),
    report: reportMessageMock,
  },
  usersApi: {
    report: reportUserMock,
  },
}));

const ME = { id: 'me-1', name: 'Me' };
const OTHER = { id: 'them-1', name: 'Them' };
vi.mock('@/store/authStore', () => ({ useUser: () => ({ id: ME.id, name: ME.name }) }));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    listing: { id: 'listing-1', title: 'Cozy 2BR', price: 1500, city: 'Toronto', audience: 'ANY' as any, images: [] },
    participants: [
      { userId: ME.id, user: { ...ME, avatarUrl: null } },
      { userId: OTHER.id, user: { ...OTHER, avatarUrl: null } },
    ],
    messages: [],
    unreadCount: 0,
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    body: 'Hello there',
    isRead: false,
    createdAt: new Date().toISOString(),
    sender: { ...ME, avatarUrl: null },
    ...overrides,
  };
}

beforeEach(() => {
  connectSocketMock.mockReset();
  getConversationsMock.mockReset();
  getConversationMock.mockReset();
  sendMessageMock.mockReset();
  toastMock.mockReset();
  reportMessageMock.mockReset().mockResolvedValue({ success: true });
  reportUserMock.mockReset().mockResolvedValue({ success: true });
});

describe('Inbox: sending a message never shows a client-side duplicate', () => {
  it('the sender sees their own sent message exactly once, even when the socket broadcast of that same row races the REST response', async () => {
    const socket = new FakeSocket();
    connectSocketMock.mockReturnValue(socket);
    getConversationsMock.mockResolvedValue({ data: [conversation()] });
    getConversationMock.mockResolvedValue({ data: { ...conversation(), messages: [] } });

    // Hold the REST response open so the socket push can arrive first --
    // this is the exact race that produced the reported duplicate.
    let resolveSend!: (v: any) => void;
    sendMessageMock.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));

    const user = userEvent.setup();
    const { container } = render(<Inbox initialConvId="conv-1" />);

    await waitFor(() => expect(screen.getByPlaceholderText('Write a message...')).toBeInTheDocument());

    const sentMessage = message({ id: 'msg-race', body: "I'm interested!" });
    await user.type(screen.getByPlaceholderText('Write a message...'), "I'm interested!");
    // eslint-disable-next-line testing-library/no-node-access
    await user.click(container.querySelector('form button[type="submit"]')!);

    // 1. REST/socket flow: the server's broadcast reaches this same client
    //    (it's in the room) before the HTTP response resolves.
    socket.serverPush('message:new', sentMessage);
    // 2. Now let the REST call resolve with the identical row.
    resolveSend({ data: sentMessage });

    // 3. Sender's UI contains that message exactly once.
    // Scoped to the open thread, not the whole document: the conversations
    // sidebar's own "last message" preview legitimately shows this same
    // text too (that's correct UI behavior, not the bug under test).
    await waitFor(() => expect(within(screen.getByTestId('message-thread')).getAllByText("I'm interested!")).toHaveLength(1));
  });

  it('a recipient who only ever receives the message via the socket (never sent it) also sees it exactly once, even if the event is redelivered', async () => {
    const socket = new FakeSocket();
    connectSocketMock.mockReturnValue(socket);
    getConversationsMock.mockResolvedValue({ data: [conversation()] });
    getConversationMock.mockResolvedValue({ data: { ...conversation(), messages: [] } });

    render(<Inbox initialConvId="conv-1" />);
    await waitFor(() => expect(screen.getByPlaceholderText('Write a message...')).toBeInTheDocument());

    const incoming = message({ id: 'msg-from-other', body: 'Sure, come by Friday', sender: { ...OTHER, avatarUrl: null } });
    // 4. Recipient receives it exactly once -- push it twice (simulating a
    //    redelivered/duplicate event) to prove the dedup, not just a
    //    single-push happy path.
    socket.serverPush('message:new', incoming);
    socket.serverPush('message:new', incoming);

    await waitFor(() => expect(within(screen.getByTestId('message-thread')).getAllByText('Sure, come by Friday')).toHaveLength(1));
  });

  it('5. after a refresh (fresh mount re-fetching from the server), exactly one persisted copy is shown -- the duplicate was never written twice', async () => {
    const socket = new FakeSocket();
    connectSocketMock.mockReturnValue(socket);
    getConversationsMock.mockResolvedValue({ data: [conversation()] });
    // The server only ever had one row for this message, matching the
    // founder's own diagnosis that this was a client-side render issue.
    getConversationMock.mockResolvedValue({ data: { ...conversation(), messages: [message({ id: 'msg-persisted', body: 'Persisted once' })] } });

    render(<Inbox initialConvId="conv-1" />);

    await waitFor(() => expect(within(screen.getByTestId('message-thread')).getAllByText('Persisted once')).toHaveLength(1));
  });
});

describe('Inbox: messages stay in the conversation they belong to', () => {
  it('a message for a conversation other than the one currently open does not leak into the open thread, but does update that conversation\'s sidebar preview', async () => {
    const socket = new FakeSocket();
    connectSocketMock.mockReturnValue(socket);
    const convA = conversation({ id: 'conv-1', listing: { ...conversation().listing, title: 'Conv A listing' } });
    const convB = conversation({ id: 'conv-2', listing: { ...conversation().listing, title: 'Conv B listing' } });
    getConversationsMock.mockResolvedValue({ data: [convA, convB] });
    getConversationMock.mockImplementation((id: string) =>
      Promise.resolve({ data: { ...(id === 'conv-1' ? convA : convB), messages: [] } })
    );

    render(<Inbox initialConvId="conv-1" />);
    await waitFor(() => expect(screen.getByPlaceholderText('Write a message...')).toBeInTheDocument());

    // A message arrives for conv-2 while conv-1 is open (e.g. the other
    // party replied there, or this socket hadn't finished leaving conv-2's
    // room yet from an earlier switch).
    socket.serverPush('message:new', message({ id: 'off-thread', conversationId: 'conv-2', body: 'Off-thread ping' }));

    // It must never show up in the currently-open thread...
    await new Promise((r) => setTimeout(r, 50));
    expect(within(screen.getByTestId('message-thread')).queryByText('Off-thread ping')).not.toBeInTheDocument();

    // ...but conv-2's own sidebar row should still reflect it as its latest message.
    const convBRow = screen.getByText('Conv B listing').closest('button')!;
    await waitFor(() => expect(within(convBRow).getByText(/Off-thread ping/)).toBeInTheDocument());
  });

  it('a slow send does not land in a different conversation the user switched to before the response arrived', async () => {
    const socket = new FakeSocket();
    connectSocketMock.mockReturnValue(socket);
    const convA = conversation({ id: 'conv-1', listing: { ...conversation().listing, title: 'Conv A listing' } });
    const convB = conversation({ id: 'conv-2', listing: { ...conversation().listing, title: 'Conv B listing' } });
    getConversationsMock.mockResolvedValue({ data: [convA, convB] });
    getConversationMock.mockImplementation((id: string) =>
      Promise.resolve({ data: { ...(id === 'conv-1' ? convA : convB), messages: [] } })
    );

    let resolveSend!: (v: any) => void;
    sendMessageMock.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));

    const user = userEvent.setup();
    const { container } = render(<Inbox initialConvId="conv-1" />);
    await waitFor(() => expect(screen.getByPlaceholderText('Write a message...')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Write a message...'), 'meant for conv-1');
    // eslint-disable-next-line testing-library/no-node-access
    await user.click(container.querySelector('form button[type="submit"]')!);

    // Switch to conv-2 before the send resolves. "Conv B listing" now
    // legitimately appears twice once switched (sidebar row + thread
    // header), so assert presence via count rather than a single match.
    await user.click(screen.getByText('Conv B listing'));
    await waitFor(() => expect(screen.getAllByText('Conv B listing').length).toBeGreaterThan(0));

    // The slow response for the conv-1 send now arrives.
    resolveSend({ data: message({ id: 'late-send', conversationId: 'conv-1', body: 'meant for conv-1' }) });

    await new Promise((r) => setTimeout(r, 50));
    expect(within(screen.getByTestId('message-thread')).queryByText('meant for conv-1')).not.toBeInTheDocument();
  });
});

describe('Inbox: socket listener lifecycle', () => {
  it('does not accumulate duplicate listeners on the persistent socket when Inbox unmounts and remounts (e.g. navigating away and back)', async () => {
    const socket = new FakeSocket();
    connectSocketMock.mockReturnValue(socket);
    getConversationsMock.mockResolvedValue({ data: [conversation()] });
    getConversationMock.mockResolvedValue({ data: { ...conversation(), messages: [] } });

    const { unmount } = render(<Inbox initialConvId="conv-1" />);
    await waitFor(() => expect(socket.listeners['message:new']?.length).toBe(1));

    unmount();
    expect(socket.listeners['message:new']?.length).toBe(0); // cleanup actually ran

    render(<Inbox initialConvId="conv-1" />);
    await waitFor(() => expect(screen.getByPlaceholderText('Write a message...')).toBeInTheDocument());
    expect(socket.listeners['message:new']?.length).toBe(1); // not 2

    // Belt and suspenders: even a single delivered event only renders once.
    socket.serverPush('message:new', message({ id: 'post-remount', body: 'still just once' }));
    await waitFor(() => expect(within(screen.getByTestId('message-thread')).getAllByText('still just once')).toHaveLength(1));
  });
});

describe('Inbox: reporting a user or a message', () => {
  it('offers a "Report {name}" action in the thread header that reports the other participant, never the current user', async () => {
    const socket = new FakeSocket();
    connectSocketMock.mockReturnValue(socket);
    getConversationsMock.mockResolvedValue({ data: [conversation()] });
    getConversationMock.mockResolvedValue({ data: { ...conversation(), messages: [] } });

    const user = userEvent.setup();
    render(<Inbox initialConvId="conv-1" />);
    await waitFor(() => expect(screen.getByPlaceholderText('Write a message...')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: `Report ${OTHER.name}` }));
    await user.click(screen.getByText('Harassment or abusive behavior'));
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => expect(reportUserMock).toHaveBeenCalledWith(OTHER.id, 'Harassment or abusive behavior', undefined));
  });

  it('offers a tap-triggered "Report message" action only on the other participant\'s messages, never on the user\'s own', async () => {
    const socket = new FakeSocket();
    connectSocketMock.mockReturnValue(socket);
    getConversationsMock.mockResolvedValue({ data: [conversation()] });
    getConversationMock.mockResolvedValue({
      data: {
        ...conversation(),
        messages: [
          message({ id: 'mine', body: 'my own message', sender: { ...ME, avatarUrl: null } }),
          message({ id: 'theirs', body: 'their message', sender: { ...OTHER, avatarUrl: null } }),
        ],
      },
    });

    const user = userEvent.setup();
    render(<Inbox initialConvId="conv-1" />);
    await waitFor(() => expect(screen.getByText('their message')).toBeInTheDocument());

    // Exactly one "Report message" action exists -- for the other participant's
    // message -- never one attached to the user's own message.
    const reportButtons = screen.getAllByRole('button', { name: 'Report message' });
    expect(reportButtons).toHaveLength(1);

    await user.click(reportButtons[0]);
    expect(screen.getByText('their message', { selector: 'p' })).toBeInTheDocument();
    await user.click(screen.getByText('Spam'));
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => expect(reportMessageMock).toHaveBeenCalledWith('theirs', 'Spam', undefined));
  });
});
