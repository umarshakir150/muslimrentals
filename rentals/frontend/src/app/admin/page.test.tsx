import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from './page';

const { getMock, patchMock, postMock, deleteMock, toastMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn().mockResolvedValue({}),
  postMock: vi.fn().mockResolvedValue({}),
  deleteMock: vi.fn().mockResolvedValue({}),
  toastMock: vi.fn(),
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
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

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
  toastMock.mockReset();
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

  it('renders "Deleted user" for the MESSAGE recipient when the backend could not derive one (or that account was since deleted)', async () => {
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
    expect(screen.getByText(/To: Deleted user/)).toBeInTheDocument();
  });

  it('Restrict user opens the in-app reason modal (not window.prompt) and calls the new narrow /restrict endpoint, resolving the report from Pending', async () => {
    mockReports([{
      id: 'r5',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { id: 'gina-1', name: 'Gina' },
      reporterId: 'gina-1',
      reportedUser: { id: 'u5', name: 'Hank', email: 'hank@example.com', isBanned: false },
    }]);
    // window.prompt/confirm must NOT be used any more -- they're the root
    // cause this modal replaced (some browsers permanently suppress further
    // confirm/prompt calls after a few fire on one page, which silently
    // no-ops them with no error and no network request). Spying and
    // asserting zero calls proves the modal path is what's actually used.
    const promptSpy = vi.spyOn(window, 'prompt');
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restrict user' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Restrict user' }));
    const dialog = await screen.findByRole('dialog', { name: /Restrict Hank from messaging Gina/ });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Kept messaging the reporter after the report was filed');
    await user.click(within(dialog).getByRole('button', { name: 'Restrict user' }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/users/u5/restrict', {
      protectedUserId: 'gina-1',
      reason: 'Kept messaging the reporter after the report was filed',
    }));
    expect(patchMock).not.toHaveBeenCalledWith('/admin/users/u5/ban', expect.anything());
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/r5', { status: 'RESOLVED', resolution: 'User restricted from messaging reporter' }));
    expect(promptSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Restrict Hank/ })).not.toBeInTheDocument());
  });

  it('the reason modal disables its confirm button until at least 5 characters are entered', async () => {
    mockReports([{
      id: 'r5b',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { id: 'gina-1b', name: 'Gina' },
      reporterId: 'gina-1b',
      reportedUser: { id: 'u5b', name: 'Hank', email: 'hank@example.com', isBanned: false },
    }]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restrict user' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Restrict user' }));
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Restrict user' });
    expect(confirmBtn).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'hi');
    expect(confirmBtn).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/), ' there now');
    expect(confirmBtn).not.toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(postMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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

  it('Ban user opens the in-app danger modal with a warning, requires a reason, then calls /ban and resolves the report from Pending', async () => {
    mockReports([{
      id: 'r7',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { id: 'gina-3', name: 'Gina' },
      reporterId: 'gina-3',
      reportedUser: { id: 'u7', name: 'Jake', email: 'jake@example.com', isBanned: false },
    }]);
    // Root-cause regression test: Ban previously used window.confirm() then
    // window.prompt(), which some browsers silently suppress after a few
    // fire on one page -- confirm() returns false, prompt() returns null,
    // with zero network requests and no visible error. Proving neither is
    // called any more, while the ban flow still completes end-to-end via
    // the in-app modal, is the actual regression coverage for that bug.
    const confirmSpy = vi.spyOn(window, 'confirm');
    const promptSpy = vi.spyOn(window, 'prompt');
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ban user' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Ban user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ban Jake?' });
    expect(within(dialog).getByText(/more serious than a restriction/)).toBeInTheDocument();
    // Accurately discloses the listing-hiding side effect introduced
    // alongside this feature, not just the account-suspension part.
    expect(within(dialog).getByText(/active listings will also be immediately hidden from public view/)).toBeInTheDocument();
    expect(within(dialog).getByText(/restored automatically if unbanned/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ban user' })).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Serious, repeated harassment');
    await user.click(within(dialog).getByRole('button', { name: 'Ban user' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/users/u7/ban', { reason: 'Serious, repeated harassment' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/r7', { status: 'RESOLVED', resolution: 'Account banned' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ban Jake?' })).not.toBeInTheDocument());
  });

  it('shows a destructive toast instead of failing silently when the ban request fails', async () => {
    mockReports([{
      id: 'r7b',
      targetType: 'USER',
      reason: 'Impersonation',
      reporter: { id: 'gina-3b', name: 'Gina' },
      reporterId: 'gina-3b',
      reportedUser: { id: 'u7b', name: 'Jake', email: 'jake@example.com', isBanned: false },
    }]);
    patchMock.mockImplementation((endpoint: string) =>
      endpoint === '/admin/users/u7b/ban' ? Promise.reject(new Error('Insufficient permissions.')) : Promise.resolve({}));
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ban user' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Ban user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ban Jake?' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Serious, repeated harassment');
    await user.click(within(dialog).getByRole('button', { name: 'Ban user' }));

    // The dialog stays open (the action didn't silently "succeed") and the
    // failure is surfaced via a destructive toast, rather than the button
    // just appearing to do nothing (the original bug's exact symptom).
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive',
      description: 'Insufficient permissions.',
    })));
    expect(screen.getByRole('dialog', { name: 'Ban Jake?' })).toBeInTheDocument();
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

  it('offers "Place retention hold" for a MESSAGE report with no hold yet, and places it with a reason via the in-app modal', async () => {
    mockReports([messageReport()]);
    const promptSpy = vi.spyOn(window, 'prompt');
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());

    expect(screen.queryByText(/Retention hold active/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Place retention hold' }));
    const dialog = await screen.findByRole('dialog', { name: 'Place retention hold' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Active police investigation');
    await user.click(within(dialog).getByRole('button', { name: 'Place hold' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/rm-hold', {
      retentionHold: true,
      retentionHoldReason: 'Active police investigation',
    }));
    await waitFor(() => expect(screen.getByText(/Retention hold active: Active police investigation/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Remove retention hold' })).toBeInTheDocument();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('does not place a hold if the moderator cancels or leaves too short a reason', async () => {
    mockReports([messageReport()]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Message')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Place retention hold' }));
    const dialog = await screen.findByRole('dialog', { name: 'Place retention hold' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'no');
    expect(within(dialog).getByRole('button', { name: 'Place hold' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(patchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Place retention hold' })).not.toBeInTheDocument());
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

  it('hides Dismiss (a report-only action) but keeps Remove listing available on the Resolved tab', async () => {
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
    // Remove listing acts on the listing itself, not the report -- like
    // Restrict/Ban, it stays available regardless of the report's own
    // status, since a listing can still need moderation well after its
    // report is closed.
    expect(screen.getByRole('button', { name: 'Remove listing' })).toBeInTheDocument();
  });
});

describe('Admin Reports panel: Remove/Restore listing', () => {
  it('Remove listing requires a reason via the in-app modal, then calls DELETE with the reason and resolves the report from Pending', async () => {
    mockReports([{
      id: 'r10', reason: 'Spam', reporter: { name: 'Alice' },
      listing: { id: 'l10', title: 'Cozy 2BR', status: 'ACTIVE', moderationRemovedAt: null, moderationRestoredAt: null },
    }]);
    const confirmSpy = vi.spyOn(window, 'confirm');
    const promptSpy = vi.spyOn(window, 'prompt');
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove listing' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Remove listing' }));
    const dialog = await screen.findByRole('dialog', { name: /Remove "Cozy 2BR" from public view\?/ });
    expect(within(dialog).getByRole('button', { name: 'Remove listing' })).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Duplicate scam listing');
    await user.click(within(dialog).getByRole('button', { name: 'Remove listing' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/admin/listings/l10', { reason: 'Duplicate scam listing' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/r10', { status: 'RESOLVED', resolution: 'Listing removed' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Remove listing on the Resolved tab does not re-resolve the (already closed) report', async () => {
    const resolvedReport = {
      id: 'r11', reason: 'Fraud', reporter: { name: 'Bob' },
      listing: { id: 'l11', title: 'Sunny Basement', status: 'ACTIVE', moderationRemovedAt: null, moderationRestoredAt: null },
      resolvedAt: '2026-06-05T00:00:00.000Z', resolution: 'Reviewed, no action',
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove listing' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Remove listing' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Found while reviewing a closed report');
    await user.click(within(dialog).getByRole('button', { name: 'Remove listing' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/admin/listings/l11', { reason: 'Found while reviewing a closed report' }));
    expect(patchMock).not.toHaveBeenCalledWith('/admin/reports/r11', expect.anything());
  });

  it('shows Restore listing (no reason required) once a listing has been removed by moderation, and calls PATCH restore', async () => {
    mockReports([{
      id: 'r12', reason: 'Spam', reporter: { name: 'Alice' },
      listing: {
        id: 'l12', title: 'Cozy 2BR', status: 'REMOVED',
        moderationRemovedAt: '2026-09-01T00:00:00.000Z', moderationRestoredAt: null,
        moderationRemovalReason: 'Duplicate scam listing', moderationRemovedBy: { name: 'Moderator' },
        user: { isBanned: false },
      },
    }]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore listing' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Remove listing' })).not.toBeInTheDocument();
    expect(screen.getByText(/Removed by moderation/)).toBeInTheDocument();
    expect(screen.getByText(/by Moderator/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicate scam listing/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore listing' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/listings/l12/restore', {}));
    // No confirmation dialog is required for Restore, unlike Remove.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables Restore listing while the listing\'s owner is currently banned', async () => {
    mockReports([{
      id: 'r13', reason: 'Spam', reporter: { name: 'Alice' },
      listing: {
        id: 'l13', title: 'Cozy 2BR', status: 'REMOVED',
        moderationRemovedAt: '2026-09-01T00:00:00.000Z', moderationRestoredAt: null,
        moderationRemovalReason: 'Duplicate scam listing', moderationRemovedBy: { name: 'Moderator' },
        user: { isBanned: true },
      },
    }]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore listing' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Restore listing' })).toBeDisabled();
  });
});

describe('Admin Reports panel: permanent Delete account (ADMIN-only, distinct from Ban)', () => {
  function userReport(overrides: Record<string, any> = {}) {
    return {
      id: 'r20', targetType: 'USER', reason: 'Fraud', reporter: { id: 'gina-4', name: 'Gina' }, reporterId: 'gina-4',
      reportedUser: { id: 'u20', name: 'Jake', email: 'jake@example.com', isBanned: false },
      ...overrides,
    };
  }

  it('is shown to ADMIN and visually distinct from Ban (a separate, non-red button)', async () => {
    mockReports([userReport()]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ban user' })).toBeInTheDocument());
    const deleteBtn = screen.getByRole('button', { name: 'Delete account' });
    const banBtn = screen.getByRole('button', { name: 'Ban user' });
    expect(deleteBtn).toBeInTheDocument();
    expect(deleteBtn.className).not.toBe(banBtn.className);
    expect(deleteBtn.className).toMatch(/bg-ink/);
  });

  it('is hidden from MODERATOR (ADMIN-only, unlike Restrict)', async () => {
    mockReports([userReport()]);
    useUserMock.mockReturnValue(MODERATOR_USER);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('Jake', { exact: false })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  });

  it('is hidden when the reported user is the logged-in admin themselves', async () => {
    mockReports([userReport({ reportedUser: { id: ADMIN_USER.id, name: 'SelfTarget', email: 'admin@example.com', isBanned: false } })]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText(/Reported user: SelfTarget/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  });

  it('stays available even while the account is already banned (alongside Unban)', async () => {
    mockReports([userReport({ reportedUser: { id: 'u20', name: 'Jake', email: 'jake@example.com', isBanned: true, banReason: 'Prior issue' } })]);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unban user' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('requires both a reason and typing the exact email before enabling the confirm button, then calls DELETE and resolves the report', async () => {
    mockReports([userReport()]);
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog', { name: "Permanently delete Jake's account?" });
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(within(dialog).getByText(/brand new signup/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Deleted user/)).toBeInTheDocument();
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete account permanently' });
    expect(confirmBtn).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Confirmed serial scam account');
    expect(confirmBtn).toBeDisabled(); // reason alone isn't enough -- still needs the typed email

    await user.type(within(dialog).getByLabelText(/Type/), 'not-the-right-email@example.com');
    expect(confirmBtn).toBeDisabled();

    await user.clear(within(dialog).getByLabelText(/Type/));
    await user.type(within(dialog).getByLabelText(/Type/), 'jake@example.com');
    expect(confirmBtn).not.toBeDisabled();

    await user.click(confirmBtn);
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/admin/users/u20', { reason: 'Confirmed serial scam account' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/reports/r20', { status: 'RESOLVED', resolution: 'Account permanently deleted' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a destructive toast instead of failing silently when the deletion request fails', async () => {
    mockReports([userReport()]);
    deleteMock.mockRejectedValue({ message: 'Server error' });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Confirmed serial scam account');
    await user.type(within(dialog).getByLabelText(/Type/), 'jake@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Delete account permanently' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Action failed', variant: 'destructive' })));
    // Dialog stays open on failure so the admin doesn't have to redo everything.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('User Search / User Management (ADMIN-only, separate from Reports)', () => {
  function mockAdminPage({ users = [] as any[] } = {}) {
    getMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/admin/stats') return Promise.resolve({ data: STATS });
      if (endpoint.startsWith('/admin/reports?status=')) return Promise.resolve({ data: [] });
      if (endpoint.startsWith('/admin/users?q=')) return Promise.resolve({ data: users });
      return Promise.resolve({ data: null });
    });
  }

  const JAKE = { id: 'u30', name: 'Jake Smith', email: 'jake@example.com', role: 'USER', isBanned: false, isActive: true, createdAt: '2026-01-01T00:00:00.000Z' };

  it('is hidden entirely for MODERATOR', async () => {
    mockAdminPage();
    useUserMock.mockReturnValue(MODERATOR_USER);
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('No pending reports')).toBeInTheDocument());
    expect(screen.queryByText('User Search')).not.toBeInTheDocument();
  });

  it('is shown to ADMIN, and searching calls the search endpoint with the typed query', async () => {
    mockAdminPage({ users: [JAKE] });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Search users by name or email'), 'Jake');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/admin/users?q=Jake'));
    expect(await screen.findByText('Jake Smith')).toBeInTheDocument();
    expect(screen.getByText('jake@example.com')).toBeInTheDocument();
  });

  it('cannot submit an empty search', async () => {
    mockAdminPage();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('shows a "No users found" state when the search returns nothing', async () => {
    mockAdminPage({ users: [] });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Search users by name or email'), 'nobody');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('No users found.')).toBeInTheDocument());
  });

  it('selecting a result shows name, email, account status, ban state, and join date, plus Ban + Delete actions', async () => {
    mockAdminPage({ users: [JAKE] });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Search users by name or email'), 'Jake');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByText('Jake Smith'));

    expect(screen.getByText(/Account status:/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Not banned')).toBeInTheDocument();
    expect(screen.getByText(/Joined/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ban user' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unban user' })).not.toBeInTheDocument();
    expect(screen.queryByText('Restrict user')).not.toBeInTheDocument();
  });

  it('shows the correct current ban state and Unban (not Ban) for an already-banned user', async () => {
    mockAdminPage({ users: [{ ...JAKE, isBanned: true, banReason: 'Prior scam' }] });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Search users by name or email'), 'Jake');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByText('Jake Smith'));

    expect(screen.getByText(/Banned: Prior scam/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unban user' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ban user' })).not.toBeInTheDocument();
    // The results list also flags banned users directly.
    expect(screen.getByText('Banned')).toBeInTheDocument();
  });

  it('bans a selected user via the shared reason-prompt modal and updates the panel', async () => {
    mockAdminPage({ users: [JAKE] });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Search users by name or email'), 'Jake');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByText('Jake Smith'));

    await user.click(screen.getByRole('button', { name: 'Ban user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ban Jake Smith?' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Confirmed scam activity');
    await user.click(within(dialog).getByRole('button', { name: 'Ban user' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/users/u30/ban', { reason: 'Confirmed scam activity' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unban user' })).toBeInTheDocument());
  });

  it('unbans a selected user directly, with no confirmation modal', async () => {
    mockAdminPage({ users: [{ ...JAKE, isBanned: true, banReason: 'Prior scam' }] });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Search users by name or email'), 'Jake');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByText('Jake Smith'));

    await user.click(screen.getByRole('button', { name: 'Unban user' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/admin/users/u30/unban', {}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ban user' })).toBeInTheDocument());
  });

  it('permanently deletes a selected user via the shared extreme confirmation modal, and the user disappears from the results', async () => {
    mockAdminPage({ users: [JAKE] });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Search users by name or email'), 'Jake');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByText('Jake Smith'));

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog', { name: "Permanently delete Jake Smith's account?" });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Confirmed scam account');
    await user.type(within(dialog).getByLabelText(/Type/), 'jake@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Delete account permanently' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/admin/users/u30', { reason: 'Confirmed scam account' }));
    await waitFor(() => expect(screen.queryByText('Jake Smith')).not.toBeInTheDocument());
  });

  it('does not offer Delete account when the selected user is the logged-in admin themselves', async () => {
    mockAdminPage({ users: [{ ...JAKE, id: ADMIN_USER.id, name: 'MyOwnAccount' }] });
    const user = userEvent.setup();
    render(<AdminPage />);
    await waitFor(() => expect(screen.getByText('User Search')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Search users by name or email'), 'my');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByText('MyOwnAccount'));

    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  });
});
