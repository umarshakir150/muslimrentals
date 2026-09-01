import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ConfirmEmailPage from './page';

const { confirmEmailChangeMock } = vi.hoisted(() => ({ confirmEmailChangeMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  usersApi: { confirmEmailChange: confirmEmailChangeMock },
}));

let mockToken: string | null = 'x'.repeat(64);
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'token' ? mockToken : null) }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: null, setUser: vi.fn() }),
}));

vi.mock('@/components/layout/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));

describe('ConfirmEmailPage', () => {
  beforeEach(() => {
    confirmEmailChangeMock.mockReset();
    mockToken = 'x'.repeat(64);
  });

  it('shows the success state on a valid token', async () => {
    confirmEmailChangeMock.mockResolvedValue({ data: { email: 'new@example.com' } });
    render(<ConfirmEmailPage />);

    await waitFor(() => expect(screen.getByText('Email confirmed')).toBeInTheDocument());
    expect(confirmEmailChangeMock).toHaveBeenCalledWith('x'.repeat(64));
  });

  it('shows an error state on an invalid/expired token', async () => {
    confirmEmailChangeMock.mockRejectedValue(new Error('Invalid or expired confirmation link.'));
    render(<ConfirmEmailPage />);

    await waitFor(() => expect(screen.getByText('Link invalid or expired')).toBeInTheDocument());
  });

  it('shows an error state immediately when the URL has no token, without calling the API', async () => {
    mockToken = null;
    render(<ConfirmEmailPage />);

    await waitFor(() => expect(screen.getByText('Link invalid or expired')).toBeInTheDocument());
    expect(confirmEmailChangeMock).not.toHaveBeenCalled();
  });
});
