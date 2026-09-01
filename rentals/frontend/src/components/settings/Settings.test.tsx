import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';
import { User } from '@/types';

const { uploadAvatarMock, removeAvatarMock, updateProfileMock, changePasswordMock } = vi.hoisted(() => ({
  uploadAvatarMock: vi.fn(),
  removeAvatarMock: vi.fn(),
  updateProfileMock: vi.fn(),
  changePasswordMock: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  usersApi: {
    uploadAvatar: uploadAvatarMock,
    removeAvatar: removeAvatarMock,
    updateProfile: updateProfileMock,
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

  it('shows the email as read-only with a not-yet-available note, not a change action', () => {
    render(<Settings />);
    expect(screen.getByText('u@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Change email')).not.toBeInTheDocument();
    expect(screen.getByText(/isn.t available yet/)).toBeInTheDocument();
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
