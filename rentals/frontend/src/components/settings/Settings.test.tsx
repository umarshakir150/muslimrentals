import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';
import { User } from '@/types';

const { uploadAvatarMock, removeAvatarMock, updateProfileMock, requestEmailChangeMock, changePasswordMock } = vi.hoisted(() => ({
  uploadAvatarMock: vi.fn(),
  removeAvatarMock: vi.fn(),
  updateProfileMock: vi.fn(),
  requestEmailChangeMock: vi.fn(),
  changePasswordMock: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  usersApi: {
    uploadAvatar: uploadAvatarMock,
    removeAvatar: removeAvatarMock,
    updateProfile: updateProfileMock,
    requestEmailChange: requestEmailChangeMock,
    changePassword: changePasswordMock,
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
    requestEmailChangeMock.mockReset();
    changePasswordMock.mockReset();
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

  it('shows a reauth password field in the email-change form for a password account', async () => {
    const user = userEvent.setup();
    const { container } = render(<Settings />);
    await user.click(screen.getByText('Change email'));
    expect(container.querySelector('input[name="emailChangePassword"]')).toBeInTheDocument();
  });

  it('omits the reauth password field in the email-change form for a Google-only account', async () => {
    mockUser = baseUser({ hasPassword: false });
    const user = userEvent.setup();
    const { container } = render(<Settings />);
    await user.click(screen.getByText('Change email'));
    expect(container.querySelector('input[name="emailChangePassword"]')).not.toBeInTheDocument();
  });

  it('requests an email change and shows the pending-confirmation message', async () => {
    requestEmailChangeMock.mockResolvedValue({ success: true, message: 'sent' });
    const user = userEvent.setup();
    const { container } = render(<Settings />);

    await user.click(screen.getByText('Change email'));
    await user.type(container.querySelector('input[name="newEmail"]')!, 'new@example.com');
    await user.type(container.querySelector('input[name="emailChangePassword"]')!, 'pw');
    await user.click(screen.getByRole('button', { name: 'Send confirmation link' }));

    await waitFor(() => expect(requestEmailChangeMock).toHaveBeenCalledWith('new@example.com', 'pw'));
    expect(screen.getByText(/Check/)).toBeInTheDocument();
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
