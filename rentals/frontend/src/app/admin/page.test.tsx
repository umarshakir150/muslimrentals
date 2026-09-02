import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from './page';

const { getMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn().mockResolvedValue({}),
  deleteMock: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/api', () => ({
  api: { get: getMock, patch: patchMock, delete: deleteMock },
  messagesApi: { getUnreadCount: vi.fn().mockResolvedValue({ data: { count: 0 } }) },
  authApi: { logout: vi.fn() },
}));

vi.mock('@/store/authStore', () => ({
  useUser: () => ({ id: 'admin-1', name: 'Admin', role: 'ADMIN' }),
  useAuthStore: () => ({ clearAuth: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin' }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const STATS = { users: 10, activeListings: 5, pendingReports: 3, messages: 20 };

function mockReports(reports: any[]) {
  getMock.mockImplementation((endpoint: string) => {
    if (endpoint === '/admin/stats') return Promise.resolve({ data: STATS });
    if (endpoint === '/admin/reports') return Promise.resolve({ data: reports });
    return Promise.resolve({ data: null });
  });
}

beforeEach(() => {
  getMock.mockReset();
  patchMock.mockReset().mockResolvedValue({});
  deleteMock.mockReset().mockResolvedValue({});
});

describe('Admin Reports panel: targetType branching', () => {
  it('renders a legacy report with no targetType (pre-migration row) as a Listing report, not a crash', async () => {
    mockReports([{ id: 'r1', reason: 'Inappropriate content', reporter: { name: 'Alice' }, listing: { id: 'l1', title: 'Cozy 2BR' } }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Cozy 2BR', { exact: false })).toBeInTheDocument());
    expect(screen.getByText('Listing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove listing' })).toBeInTheDocument();
  });

  it('renders a USER report with reported-user identity and a Restrict user action, never "Listing: undefined"', async () => {
    mockReports([{
      id: 'r2',
      targetType: 'USER',
      reason: 'Harassment or abusive behavior',
      reporter: { name: 'Bob' },
      reportedUser: { id: 'u2', name: 'Carol', email: 'carol@example.com', isBanned: false },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User')).toBeInTheDocument());
    expect(screen.getByText(/Carol/)).toBeInTheDocument();
    expect(screen.getByText(/carol@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restrict user' })).toBeInTheDocument();
    expect(screen.queryByText(/Listing: undefined/)).not.toBeInTheDocument();
  });

  it('renders the reporter history anti-retaliation signal returned by the backend as reporterHistory', async () => {
    mockReports([{
      id: 'r2b',
      targetType: 'USER',
      reason: 'Harassment or abusive behavior',
      reporter: { name: 'Bob' },
      reportedUser: { id: 'u2b', name: 'Carol', email: 'carol@example.com', isBanned: false },
      reporterHistory: { totalFiled: 3, dismissed: 1 },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Carol/)).toBeInTheDocument());
    expect(screen.getByText(/filed 3 report\(s\) total/)).toBeInTheDocument();
    expect(screen.getByText(/1 dismissed/)).toBeInTheDocument();
  });

  it('hides the Restrict user action once the reported user is already banned', async () => {
    mockReports([{
      id: 'r3',
      targetType: 'USER',
      reason: 'Scam or fraud attempt',
      reporter: { name: 'Bob' },
      reportedUser: { id: 'u3', name: 'Dave', email: 'dave@example.com', isBanned: true },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Dave/)).toBeInTheDocument());
    expect(screen.getByText('Already restricted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restrict user' })).not.toBeInTheDocument();
  });

  it('renders a MESSAGE report with a "Full conversation" link and a "Reported message" action that reveals the frozen snapshot', async () => {
    mockReports([{
      id: 'r4',
      targetType: 'MESSAGE',
      reason: 'Spam',
      reporter: { name: 'Erin' },
      messageSnapshot: 'Buy crypto now!!',
      messageSender: { name: 'Frank' },
      conversationId: 'conv-99',
    }]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());
    expect(screen.getByText(/Frank/)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Full conversation' });
    expect(link).toHaveAttribute('href', '/messages?conv=conv-99');

    // The snapshot isn't shown inline any more -- it's behind the explicit
    // "Reported message" action, so a dense list of reports doesn't force
    // every message's full text into view at once.
    expect(screen.queryByText(/Buy crypto now/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reported message' }));
    expect(screen.getByText(/Buy crypto now/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Reported message' })).toBeInTheDocument();
  });

  it('renders a MESSAGE report with the recipient and sent timestamp the backend derives, for full moderation context', async () => {
    mockReports([{
      id: 'r4b',
      targetType: 'MESSAGE',
      reason: 'Spam',
      description: 'Asking to pay outside the app',
      reporter: { name: 'Erin' },
      messageSnapshot: 'Buy crypto now!!',
      message: { id: 'msg-1', conversationId: 'conv-99', createdAt: new Date(Date.now() - 60_000).toISOString(), sender: { name: 'Frank' } },
      messageSender: { name: 'Frank' },
      recipient: { id: 'u-recipient', name: 'Grace', email: 'grace@example.com' },
      conversationId: 'conv-99',
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());
    expect(screen.getByText(/From: Frank/)).toBeInTheDocument();
    expect(screen.getByText(/To: Grace/)).toBeInTheDocument();
    expect(screen.getByText(/Sent:/)).toBeInTheDocument();
    expect(screen.getByText(/Asking to pay outside the app/)).toBeInTheDocument();
  });

  it('renders "Unknown" for the MESSAGE recipient when the backend could not derive one', async () => {
    mockReports([{
      id: 'r4c',
      targetType: 'MESSAGE',
      reason: 'Spam',
      reporter: { name: 'Erin' },
      messageSnapshot: 'Buy crypto now!!',
      messageSender: { name: 'Frank' },
      recipient: null,
      conversationId: 'conv-99',
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());
    expect(screen.getByText(/To: Unknown/)).toBeInTheDocument();
  });

  it('Restrict user calls the existing ban endpoint and resolves the report, not a new privilege surface', async () => {
    mockReports([{
      id: 'r5',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { name: 'Gina' },
      reportedUser: { id: 'u5', name: 'Hank', email: 'hank@example.com', isBanned: false },
    }]);
    vi.spyOn(window, 'prompt').mockReturnValue('Confirmed impersonation of another landlord');
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restrict user' })).toBeInTheDocument());

    screen.getByRole('button', { name: 'Restrict user' }).click();

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/users/u5/ban', { reason: 'Confirmed impersonation of another landlord' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/r5', { status: 'RESOLVED', resolution: 'Account restricted' }));
  });
});
