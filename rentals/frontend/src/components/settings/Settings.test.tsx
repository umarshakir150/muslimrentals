import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';
import { User } from '@/types';

const { uploadAvatarMock, removeAvatarMock, updateProfileMock, changePasswordMock, requestEmailChangeMock } = vi.hoisted(() => ({
  uploadAvatarMock: vi.fn(),
  removeAvatarMock: vi.fn(),
  updateProfileMock: vi.fn(),
  changePasswordMock: vi.fn(),
  requestEmailChangeMock: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  usersApi: {
    uploadAvatar: uploadAvatarMock,
    removeAvatar: removeAvatarMock,
    updateProfile: updateProfileMock,
    changePassword: changePasswordMock,
    requestEmailChange: requestEmailChangeMock,
    deleteAccount: vi.fn(),
  },
}));

const { setUserMock } = vi.hoisted(() => ({ setUserMock: vi.fn() }));
let mockUser: User | null = null;
vi.mock('@/store/authStore', () => ({
  useUser: () => mockUser,
  useAuthStore: (selector: any) => selector({ setUser: setUserMock, clearAuth: vi.fn() }),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1', name: 'Test User', email: 'u@example.com', role: 'USER',
    avatarUrl: null, phone: null, bio: null, createdAt: new Date().toISOString(),
    hasPassword: true, ...overrides,
  };
}

describe('Settings', () => {
  beforeEach(() => {
    uploadAvatarMock.mockReset();
    removeAvatarMock.mockReset();
    updateProfileMock.mockReset();
    changePasswordMock.mockReset();
    requestEmailChangeMock.mockReset();
    setUserMock.mockReset();
    toastMock.mockReset();
    mockUser = baseUser();
  });

  it('renders nothing when there is no user', () => {
    mockUser = null;
    const { container } = render(<Settings />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the Upload photo button, and Remove photo only appears once an avatar exists', () => {
    mockUser = baseUser({ avatarUrl: null });
    const { rerender } = render(<Settings />);
    expect(screen.getByText('Upload photo')).toBeInTheDocument();
    expect(screen.queryByText('Remove photo')).not.toBeInTheDocument();

    mockUser = baseUser({ avatarUrl: 'https://pub-x.r2.dev/avatars/a.jpg' });
    rerender(<Settings />);
    expect(screen.getByText('Change photo')).toBeInTheDocument();
    expect(screen.getByText('Remove photo')).toBeInTheDocument();
  });

  it('removes the avatar and updates the store', async () => {
    mockUser = baseUser({ avatarUrl: 'https://pub-x.r2.dev/avatars/a.jpg' });
    removeAvatarMock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByText('Remove photo'));

    await waitFor(() => expect(removeAvatarMock).toHaveBeenCalled());
    expect(setUserMock).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: null }));
  });

  it('saves profile changes (name/phone/bio)', async () => {
    updateProfileMock.mockResolvedValue({ data: { name: 'New Name', phone: '4165550100', bio: 'Hi' } });
    const user = userEvent.setup();
    render(<Settings />);

    const nameInput = screen.getByDisplayValue('Test User');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Name' })
    ));
    expect(setUserMock).toHaveBeenCalled();
  });

  it('shows the current email plus a form to request a change, requiring the current password for a password account', async () => {
    requestEmailChangeMock.mockResolvedValue({ success: true, message: 'A confirmation link was sent to new@example.com.' });
    const user = userEvent.setup();
    render(<Settings />);

    expect(screen.getByText('u@example.com')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('your-new-email@example.com'), 'new@example.com');
    await user.type(screen.getByPlaceholderText("Confirm it's you"), 'mypassword');
    await user.click(screen.getByRole('button', { name: 'Send confirmation link' }));

    await waitFor(() => expect(requestEmailChangeMock).toHaveBeenCalledWith('new@example.com', 'mypassword'));
    expect(await screen.findByText(/A confirmation link was sent to/)).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
  });

  it('does not ask for a password to request an email change on a Google-only account', async () => {
    mockUser = baseUser({ hasPassword: false });
    requestEmailChangeMock.mockResolvedValue({ success: true, message: 'sent' });
    const user = userEvent.setup();
    render(<Settings />);

    expect(screen.queryByPlaceholderText("Confirm it's you")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('your-new-email@example.com'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send confirmation link' }));

    await waitFor(() => expect(requestEmailChangeMock).toHaveBeenCalledWith('new@example.com', undefined));
  });

  it('shows an error and keeps the form filled in when the email-change request fails', async () => {
    requestEmailChangeMock.mockRejectedValue(new Error('Current password is incorrect.'));
    const user = userEvent.setup();
    render(<Settings />);

    await user.type(screen.getByPlaceholderText('your-new-email@example.com'), 'new@example.com');
    await user.type(screen.getByPlaceholderText("Confirm it's you"), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Send confirmation link' }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    expect(screen.queryByText(/A confirmation link was sent to/)).not.toBeInTheDocument();
  });

  it('hides the Password section entirely for a Google-only account', () => {
    mockUser = baseUser({ hasPassword: false });
    render(<Settings />);
    expect(screen.queryByRole('heading', { name: 'Password' })).not.toBeInTheDocument();
  });

  it('changes password for a password account', async () => {
    changePasswordMock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { container } = render(<Settings />);

    await user.type(container.querySelector('input[name="currentPassword"]')!, 'oldpassword');
    await user.type(container.querySelector('input[name="newPassword"]')!, 'newpassword123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => expect(changePasswordMock).toHaveBeenCalledWith({ currentPassword: 'oldpassword', newPassword: 'newpassword123' }));
  });

  it('opens the delete-account dialog from the danger zone', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole('button', { name: /Delete my account/ }));
    expect(screen.getByText('Delete your account?')).toBeInTheDocument();
  });
});
