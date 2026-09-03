/**
 * Regression coverage for the account dropdown's open/close behavior.
 * It used to close on plain onMouseLeave, so merely moving the mouse off
 * the menu (never clicking anything) dismissed it -- reported as unwanted.
 * It should now close only on an explicit outside click, Escape, the
 * trigger being clicked again, or selecting a menu item.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from './Navbar';

const USER = { id: 'user-1', name: 'Fatima', email: 'fatima@example.com', role: 'USER', avatarUrl: null };

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

const { clearAuthMock, logoutMock, getUnreadCountMock } = vi.hoisted(() => ({
  clearAuthMock: vi.fn(),
  logoutMock: vi.fn().mockResolvedValue({}),
  getUnreadCountMock: vi.fn().mockResolvedValue({ data: { count: 0 } }),
}));

vi.mock('@/store/authStore', () => ({
  useUser: () => USER,
  useAuthStore: () => ({ clearAuth: clearAuthMock, setAuth: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  authApi: { logout: logoutMock },
  messagesApi: { getUnreadCount: getUnreadCountMock },
}));

vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => {
  clearAuthMock.mockReset();
  logoutMock.mockReset().mockResolvedValue({});
  getUnreadCountMock.mockReset().mockResolvedValue({ data: { count: 0 } });
});

describe('Navbar: account dropdown open/close behavior', () => {
  it('clicking the profile trigger toggles the dropdown open, then closed', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    expect(screen.queryByText('fatima@example.com')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Fatima/ }));
    expect(screen.getByText('fatima@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Fatima/ }));
    await waitFor(() => expect(screen.queryByText('fatima@example.com')).not.toBeInTheDocument());
  });

  it('moving the mouse away from the open dropdown does NOT close it', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    await user.click(screen.getByRole('button', { name: /Fatima/ }));
    expect(screen.getByText('fatima@example.com')).toBeInTheDocument();

    // Simulate the mouse leaving both the dropdown panel and its trigger --
    // this alone used to close the menu.
    await user.hover(screen.getByText('fatima@example.com'));
    await user.unhover(screen.getByText('fatima@example.com'));

    // Still open: hovering away is no longer a close trigger.
    expect(screen.getByText('fatima@example.com')).toBeInTheDocument();
  });

  it('clicking outside the dropdown closes it', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    await user.click(screen.getByRole('button', { name: /Fatima/ }));
    expect(screen.getByText('fatima@example.com')).toBeInTheDocument();

    // An unrelated element well outside the trigger/panel.
    await user.click(screen.getByRole('link', { name: 'Browse' }));

    await waitFor(() => expect(screen.queryByText('fatima@example.com')).not.toBeInTheDocument());
  });

  it('pressing Escape closes the open dropdown', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    await user.click(screen.getByRole('button', { name: /Fatima/ }));
    expect(screen.getByText('fatima@example.com')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('fatima@example.com')).not.toBeInTheDocument());
  });

  it('selecting a menu item closes the dropdown', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    await user.click(screen.getByRole('button', { name: /Fatima/ }));
    await user.click(screen.getByRole('link', { name: 'Profile' }));

    await waitFor(() => expect(screen.queryByText('fatima@example.com')).not.toBeInTheDocument());
  });
});
