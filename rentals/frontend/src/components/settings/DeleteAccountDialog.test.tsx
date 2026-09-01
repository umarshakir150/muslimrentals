import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteAccountDialog from './DeleteAccountDialog';

const { deleteAccountMock } = vi.hoisted(() => ({ deleteAccountMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  usersApi: { deleteAccount: deleteAccountMock },
}));

const { clearAuthMock } = vi.hoisted(() => ({ clearAuthMock: vi.fn() }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ clearAuth: clearAuthMock }),
}));

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe('DeleteAccountDialog', () => {
  beforeEach(() => {
    deleteAccountMock.mockReset();
    clearAuthMock.mockReset();
    pushMock.mockReset();
    toastMock.mockReset();
  });

  it('renders nothing when closed', () => {
    render(<DeleteAccountDialog open={false} onClose={vi.fn()} hasPassword userEmail="u@example.com" />);
    expect(screen.queryByText('Delete your account?')).not.toBeInTheDocument();
  });

  it('for a password account: requires a password, disables submit until entered, and sends currentPassword', async () => {
    deleteAccountMock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<DeleteAccountDialog open onClose={vi.fn()} hasPassword userEmail="u@example.com" />);

    const submit = screen.getByRole('button', { name: 'Delete my account' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Current password'), 'my-password');
    expect(submit).not.toBeDisabled();

    await user.click(submit);

    await waitFor(() => expect(deleteAccountMock).toHaveBeenCalledWith({ currentPassword: 'my-password' }));
    expect(clearAuthMock).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith('/');
  });

  it('for a Google-only account: requires typing the exact email, and sends confirmEmail', async () => {
    deleteAccountMock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<DeleteAccountDialog open onClose={vi.fn()} hasPassword={false} userEmail="u@example.com" />);

    expect(screen.queryByPlaceholderText('Current password')).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Delete my account' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText('u@example.com'), 'u@example.com');
    await user.click(submit);

    await waitFor(() => expect(deleteAccountMock).toHaveBeenCalledWith({ confirmEmail: 'u@example.com' }));
  });

  it('shows an inline error and does not clear auth if deletion fails', async () => {
    deleteAccountMock.mockRejectedValue(new Error('Current password is incorrect.'));
    const user = userEvent.setup();
    render(<DeleteAccountDialog open onClose={vi.fn()} hasPassword userEmail="u@example.com" />);

    await user.type(screen.getByPlaceholderText('Current password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    await waitFor(() => expect(screen.getByText('Current password is incorrect.')).toBeInTheDocument());
    expect(clearAuthMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('closes via Cancel without calling the API', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DeleteAccountDialog open onClose={onClose} hasPassword userEmail="u@example.com" />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteAccountMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
