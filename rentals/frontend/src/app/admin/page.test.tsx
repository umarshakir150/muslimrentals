import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from './page';

const { getMock, patchMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn().mockResolvedValue({}),
  postMock: vi.fn().mockResolvedValue({}),
  deleteMock: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/api', () => ({
  api: { get: getMock, patch: patchMock, post: postMock, delete: deleteMock },
  messagesApi: { getUnreadCount: vi.fn().mockResolvedValue({ data: { count: 0 } }) },
  authApi: { logout: vi.fn() },
}));

// Stable references, matching the real useUser (a Zustand selector, which
// only changes identity when the underlying user actually changes) -- a
// fresh object literal here would make AdminPage's `useEffect(..., [user])`
// re-fire on every render (including ones caused by this test file's own
// setReports() calls after a moderator action), silently re-fetching and
// reverting any local state update mid-test. useUserMock defaults to
// ADMIN_USER in beforeEach; a single test overrides it to MODERATOR_USER to
// exercise the ADMIN-only Ban gate, without needing vi.resetModules().
const ADMIN_USER = { id: 'admin-1', name: 'Admin', role: 'ADMIN' };
const MODERATOR_USER = { id: 'mod-1', name: 'Moderator', role: 'MODERATOR' };
const { useUserMock } = vi.hoisted(() => ({ useUserMock: vi.fn() }));
vi.mock('@/store/authStore', () => ({
  useUser: useUserMock,
  useAuthStore: () => ({ clearAuth: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin' }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const STATS = { users: 10, activeListings: 5, pendingReports: 3, messages: 20 };

function mockReports(reports: any[]) {
  getMock.mockImplementation((endpoint: string) => {
    if (endpoint === '/admin/stats') return Promise.resolve({ data: STATS });
    if (endpoint.startsWith('/admin/reports?status=')) return Promise.resolve({ data: reports });
    return Promise.resolve({ data: null });
  });
}

beforeEach(() => {
  getMock.mockReset();
  patchMock.mockReset().mockResolvedValue({});
  postMock.mockReset().mockResolvedValue({});
  deleteMock.mockReset().mockResolvedValue({});
  useUserMock.mockReset().mockReturnValue(ADMIN_USER);
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

  it('shows "Unban user" instead of Restrict/Ban once the reported user is already banned', async () => {
    mockReports([{
      id: 'r3',
      targetType: 'USER',
      reason: 'Scam or fraud attempt',
      reporter: { name: 'Bob' },
      reportedUser: { id: 'u3', name: 'Dave', email: 'dave@example.com', isBanned: true, banReason: 'Repeated scam listings' },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Dave/)).toBeInTheDocument());
    expect(screen.getByText(/Moderation status:/)).toBeInTheDocument();
    expect(screen.getByText(/Banned: Repeated scam listings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unban user' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restrict user' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ban user' })).not.toBeInTheDocument();
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

  it('Restrict user calls the new narrow /restrict endpoint (not /ban) and resolves the report from Pending', async () => {
    mockReports([{
      id: 'r5',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { id: 'gina-1', name: 'Gina' },
      reporterId: 'gina-1',
      reportedUser: { id: 'u5', name: 'Hank', email: 'hank@example.com', isBanned: false },
    }]);
    vi.spyOn(window, 'prompt').mockReturnValue('Kept messaging the reporter after the report was filed');
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restrict user' })).toBeInTheDocument());

    screen.getByRole('button', { name: 'Restrict user' }).click();

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/users/u5/restrict', {
      protectedUserId: 'gina-1',
      reason: 'Kept messaging the reporter after the report was filed',
    }));
    expect(patchMock).not.toHaveBeenCalledWith('/admin/users/u5/ban', expect.anything());
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/r5', { status: 'RESOLVED', resolution: 'User restricted from messaging reporter' }));
  });

  it('shows "Unrestrict user" once a restriction is already active, and lifting it calls /unrestrict', async () => {
    mockReports([{
      id: 'r6',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { id: 'gina-2', name: 'Gina' },
      reporterId: 'gina-2',
      reportedUser: { id: 'u6', name: 'Ike', email: 'ike@example.com', isBanned: false },
      restriction: { reason: 'Kept messaging after being reported', createdAt: '2026-08-01T00:00:00.000Z' },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Restricted from messaging Gina/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Restrict user' })).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Unrestrict user' }).click();

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/users/u6/unrestrict', { protectedUserId: 'gina-2' }));
  });

  it('Ban user requires confirmation, then calls /ban and resolves the report from Pending', async () => {
    mockReports([{
      id: 'r7',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { id: 'gina-3', name: 'Gina' },
      reporterId: 'gina-3',
      reportedUser: { id: 'u7', name: 'Jake', email: 'jake@example.com', isBanned: false },
    }]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(window, 'prompt').mockReturnValue('Serious, repeated harassment');
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ban user' })).toBeInTheDocument());

    screen.getByRole('button', { name: 'Ban user' }).click();
    expect(confirmSpy).toHaveBeenCalled();
    await Promise.resolve();
    expect(patchMock).not.toHaveBeenCalledWith('/admin/users/u7/ban', expect.anything());

    confirmSpy.mockReturnValue(true);
    screen.getByRole('button', { name: 'Ban user' }).click();

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/users/u7/ban', { reason: 'Serious, repeated harassment' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/r7', { status: 'RESOLVED', resolution: 'Account banned' }));
  });

  it('a MODERATOR sees Restrict/Unrestrict but not Ban (ADMIN-only)', async () => {
    useUserMock.mockReturnValue(MODERATOR_USER);
    mockReports([{
      id: 'r8',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { id: 'gina-4', name: 'Gina' },
      reporterId: 'gina-4',
      reportedUser: { id: 'u8', name: 'Kim', email: 'kim@example.com', isBanned: false },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restrict user' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Ban user' })).not.toBeInTheDocument();
  });
});

describe('Admin Reports panel: emails shown alongside names for unambiguous identity', () => {
  it('shows the reporter\'s email on a LISTING report -- the only identity a LISTING report displays', async () => {
    mockReports([{
      id: 'rl1',
      targetType: 'LISTING',
      reason: 'Spam',
      reporter: { name: 'Ivan', email: 'ivan@example.com' },
      listing: { id: 'l9', title: 'Cozy 2BR' },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Listing')).toBeInTheDocument());
    expect(screen.getByText(/By: Ivan/)).toBeInTheDocument();
    expect(screen.getByText(/ivan@example\.com/)).toBeInTheDocument();
  });

  it('shows both the reporter\'s and the reported user\'s email on a USER report', async () => {
    mockReports([{
      id: 'ru1',
      targetType: 'USER',
      reason: 'Harassment or abusive behavior',
      reporter: { name: 'Bob', email: 'bob@example.com' },
      reportedUser: { id: 'u2', name: 'Carol', email: 'carol@example.com', isBanned: false },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Carol/)).toBeInTheDocument());
    expect(screen.getByText(/By: Bob/)).toBeInTheDocument();
    expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/carol@example\.com/)).toBeInTheDocument();
  });

  it('shows the reporter\'s, sender\'s, and recipient\'s email on a MESSAGE report, both inline and in the "Reported message" dialog', async () => {
    mockReports([{
      id: 'rm1',
      targetType: 'MESSAGE',
      reason: 'Spam',
      reporter: { name: 'Erin', email: 'erin@example.com' },
      messageSnapshot: 'Buy crypto now!!',
      message: { id: 'msg-1', conversationId: 'conv-99', createdAt: new Date().toISOString(), sender: { name: 'Frank', email: 'frank@example.com' } },
      messageSender: { name: 'Frank', email: 'frank@example.com' },
      recipient: { id: 'u-recipient', name: 'Grace', email: 'grace@example.com' },
      conversationId: 'conv-99',
    }]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());

    // Inline summary
    expect(screen.getByText(/By: Erin/)).toBeInTheDocument();
    expect(screen.getByText(/erin@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/From: Frank/)).toBeInTheDocument();
    expect(screen.getByText(/frank@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/To: Grace/)).toBeInTheDocument();
    expect(screen.getByText(/grace@example\.com/)).toBeInTheDocument();

    // The "Reported message" dialog repeats sender/recipient/reporter with email
    await user.click(screen.getByRole('button', { name: 'Reported message' }));
    const dialog = screen.getByRole('dialog', { name: 'Reported message' });
    expect(within(dialog).getByText(/frank@example\.com/)).toBeInTheDocument();
    expect(within(dialog).getByText(/grace@example\.com/)).toBeInTheDocument();
    expect(within(dialog).getByText(/erin@example\.com/)).toBeInTheDocument();
  });
});

describe('Admin Reports panel: messageSnapshot retention hold', () => {
  function messageReport(overrides: any = {}) {
    return {
      id: 'rm-hold',
      targetType: 'MESSAGE',
      reason: 'Spam',
      reporter: { name: 'Erin', email: 'erin@example.com' },
      messageSnapshot: 'Buy crypto now!!',
      messageSender: { name: 'Frank', email: 'frank@example.com' },
      recipient: { id: 'u-recipient', name: 'Grace', email: 'grace@example.com' },
      conversationId: 'conv-99',
      ...overrides,
    };
  }

  it('offers "Place retention hold" for a MESSAGE report with no hold yet, and places it with a reason', async () => {
    mockReports([messageReport()]);
    vi.spyOn(window, 'prompt').mockReturnValue('Active police investigation');
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());

    expect(screen.queryByText(/Retention hold active/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Place retention hold' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/rm-hold', {
      retentionHold: true,
      retentionHoldReason: 'Active police investigation',
    }));
    await waitFor(() => expect(screen.getByText(/Retention hold active: Active police investigation/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Remove retention hold' })).toBeInTheDocument();
  });

  it('does not place a hold if the moderator cancels or leaves too short a reason', async () => {
    mockReports([messageReport()]);
    vi.spyOn(window, 'prompt').mockReturnValue('no');
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Place retention hold' }));
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('shows the existing hold and lets a moderator remove it', async () => {
    mockReports([messageReport({ retentionHold: true, retentionHoldReason: 'Active dispute' })]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Retention hold active: Active dispute/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Remove retention hold' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/rm-hold', { retentionHold: false }));
    await waitFor(() => expect(screen.queryByText(/Retention hold active/)).not.toBeInTheDocument());
  });

  it('shows a redacted-content notice in the "Reported message" dialog once the snapshot has been cleared by the retention job', async () => {
    mockReports([messageReport({ messageSnapshot: null, snapshotRedactedAt: '2026-06-01T00:00:00.000Z' })]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Reported message' }));
    const dialog = screen.getByRole('dialog', { name: 'Reported message' });
    expect(within(dialog).getByText(/redacted per the retention policy/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Message content unavailable/)).not.toBeInTheDocument();
  });
});

describe('Admin Reports panel: Pending/Resolved status tabs', () => {
  it('has only Pending and Resolved tabs -- no separate Dismissed tab', async () => {
    mockReports([]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('No pending reports')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolved' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismissed' })).not.toBeInTheDocument();
  });

  it('defaults to Pending, and fetches both RESOLVED and DISMISSED (merged) when switching to Resolved', async () => {
    mockReports([{ id: 'r1', reason: 'Spam', reporter: { name: 'Alice' }, listing: { id: 'l1', title: 'Cozy 2BR' } }]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Cozy 2BR', { exact: false })).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/admin/reports?status=PENDING');

    await user.click(screen.getByRole('button', { name: 'Resolved' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/admin/reports?status=RESOLVED'));
    expect(getMock).toHaveBeenCalledWith('/admin/reports?status=DISMISSED');
  });

  it('a DISMISSED report appears in the Resolved tab (with its outcome) and is gone from Pending', async () => {
    const dismissedReport = {
      id: 'r-dismissed',
      status: 'DISMISSED',
      reason: 'Spam',
      reporter: { name: 'Alice' },
      listing: { id: 'l1', title: 'Cozy 2BR' },
      resolvedAt: '2026-06-01T00:00:00.000Z',
      resolution: 'Reviewed and dismissed',
    };
    getMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/admin/stats') return Promise.resolve({ data: STATS });
      if (endpoint === '/admin/reports?status=PENDING') return Promise.resolve({ data: [] });
      if (endpoint === '/admin/reports?status=RESOLVED') return Promise.resolve({ data: [] });
      if (endpoint === '/admin/reports?status=DISMISSED') return Promise.resolve({ data: [dismissedReport] });
      return Promise.resolve({ data: null });
    });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('No pending reports')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Resolved' }));
    await waitFor(() => expect(screen.getByText('Cozy 2BR', { exact: false })).toBeInTheDocument());
    expect(screen.getByText(/Outcome: Reviewed and dismissed/)).toBeInTheDocument();
    expect(screen.getByText(/Dismissed/)).toBeInTheDocument();
  });

  it('a RESOLVED report also appears in the Resolved tab, sorted alongside dismissed ones', async () => {
    const resolvedReport = {
      id: 'r-resolved',
      status: 'RESOLVED',
      reason: 'Fraud',
      reporter: { name: 'Bob' },
      listing: { id: 'l2', title: 'Sunny Basement' },
      resolvedAt: '2026-06-05T00:00:00.000Z',
      resolution: 'Listing removed',
    };
    getMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/admin/stats') return Promise.resolve({ data: STATS });
      if (endpoint === '/admin/reports?status=PENDING') return Promise.resolve({ data: [] });
      if (endpoint === '/admin/reports?status=RESOLVED') return Promise.resolve({ data: [resolvedReport] });
      if (endpoint === '/admin/reports?status=DISMISSED') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('No pending reports')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Resolved' }));
    await waitFor(() => expect(screen.getByText('Sunny Basement', { exact: false })).toBeInTheDocument());
    expect(screen.getByText(/Outcome: Listing removed/)).toBeInTheDocument();
  });

  it('hides Dismiss/Restrict/Remove-listing actions once viewing the Resolved tab', async () => {
    const resolvedReport = {
      id: 'r1',
      reason: 'Spam',
      reporter: { name: 'Alice' },
      listing: { id: 'l1', title: 'Cozy 2BR' },
      resolvedAt: '2026-06-01T00:00:00.000Z',
      resolution: 'Reviewed and dismissed',
    };
    getMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/admin/stats') return Promise.resolve({ data: STATS });
      if (endpoint === '/admin/reports?status=PENDING') return Promise.resolve({ data: [resolvedReport] });
      if (endpoint === '/admin/reports?status=RESOLVED') return Promise.resolve({ data: [resolvedReport] });
      if (endpoint === '/admin/reports?status=DISMISSED') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Cozy 2BR', { exact: false })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Resolved' }));
    await waitFor(() => expect(screen.getByText(/Outcome: Reviewed and dismissed/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove listing' })).not.toBeInTheDocument();
  });
});
