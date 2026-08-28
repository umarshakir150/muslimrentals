import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthModal from './AuthModal';

const { loginMock, registerMock, forgotPasswordMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  registerMock: vi.fn(),
  forgotPasswordMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  authApi: {
    login: loginMock,
    register: registerMock,
    forgotPassword: forgotPasswordMock,
  },
}));

const setAuthMock = vi.fn();
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ setAuth: setAuthMock }),
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

// The tab-switch button and the form's submit button share the same visible
// label ("Log in" / "Sign up"), so submit clicks must be scoped to the <form>
// to avoid an ambiguous getByRole match.
function submitButton(container: HTMLElement, name: string) {
  const form = container.querySelector('form');
  if (!form) throw new Error('expected a form to be rendered');
  return within(form).getByRole('button', { name });
}

// The login form also has a "No account? Sign up" link with the same label
// as the tab switcher, so scope tab clicks to the tab bar (the first match
// in document order) to avoid an ambiguous getByRole match.
function tabButton(name: string) {
  return screen.getAllByRole('button', { name })[0];
}

describe('AuthModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    render(<AuthModal open={false} onClose={onClose} />);
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('renders the login tab by default with email and password fields', () => {
    render(<AuthModal open onClose={onClose} />);
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  it('rejects an invalid email on login without calling the API', async () => {
    const user = userEvent.setup();
    const { container } = render(<AuthModal open onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('your@email.com'), 'not-an-email');
    await user.type(screen.getByPlaceholderText('••••••••'), 'somepassword');
    await user.click(submitButton(container, 'Log in'));

    await waitFor(() => expect(loginMock).not.toHaveBeenCalled());
  });

  it('logs in with valid credentials and closes the modal', async () => {
    loginMock.mockResolvedValue({
      data: { user: { id: '1', name: 'Amina' }, accessToken: 'tok123' },
    });
    const user = userEvent.setup();
    const { container } = render(<AuthModal open onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'correcthorse');
    await user.click(submitButton(container, 'Log in'));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({
      email: 'amina@example.com',
      password: 'correcthorse',
    }));
    expect(setAuthMock).toHaveBeenCalledWith({ id: '1', name: 'Amina' }, 'tok123');
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to the register tab and enforces the password rules', async () => {
    const user = userEvent.setup();
    const { container } = render(<AuthModal open onClose={onClose} />);

    await user.click(tabButton('Sign up'));
    expect(screen.getByText('Create account')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Your name'), 'Bilal');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'bilal@example.com');
    await user.type(screen.getByPlaceholderText('Min. 8 characters'), 'short');
    await user.type(screen.getByPlaceholderText('Repeat password'), 'short');
    await user.click(submitButton(container, 'Sign up'));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords on register', async () => {
    const user = userEvent.setup();
    const { container } = render(<AuthModal open onClose={onClose} />);

    await user.click(tabButton('Sign up'));
    await user.type(screen.getByPlaceholderText('Your name'), 'Bilal');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'bilal@example.com');
    await user.type(screen.getByPlaceholderText('Min. 8 characters'), 'longenoughpw');
    await user.type(screen.getByPlaceholderText('Repeat password'), 'doesnotmatch');
    await user.click(submitButton(container, 'Sign up'));

    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('registers with valid input and strips confirmPassword from the payload', async () => {
    registerMock.mockResolvedValue({
      data: { user: { id: '2', name: 'Bilal' }, accessToken: 'tok456' },
    });
    const user = userEvent.setup();
    const { container } = render(<AuthModal open onClose={onClose} />);

    await user.click(tabButton('Sign up'));
    await user.type(screen.getByPlaceholderText('Your name'), 'Bilal');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'bilal@example.com');
    await user.type(screen.getByPlaceholderText('Min. 8 characters'), 'longenoughpw');
    await user.type(screen.getByPlaceholderText('Repeat password'), 'longenoughpw');
    await user.click(submitButton(container, 'Sign up'));

    await waitFor(() => expect(registerMock).toHaveBeenCalledWith({
      name: 'Bilal',
      email: 'bilal@example.com',
      password: 'longenoughpw',
    }));
    expect(setAuthMock).toHaveBeenCalledWith({ id: '2', name: 'Bilal' }, 'tok456');
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to the forgot-password tab and submits an email', async () => {
    forgotPasswordMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<AuthModal open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText('Reset password')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(forgotPasswordMock).toHaveBeenCalledWith('amina@example.com'));
  });

  it('surfaces a friendly message instead of raw HTML/JSON parse errors on login failure', async () => {
    loginMock.mockRejectedValue(new Error('<!DOCTYPE html><html>not found</html>'));
    const user = userEvent.setup();
    const { container } = render(<AuthModal open onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'correcthorse');
    await user.click(submitButton(container, 'Log in'));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Login failed',
        description: 'Account not found. Please sign up first.',
      })
    ));
  });
});
