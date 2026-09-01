import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactPage from './page';

/**
 * Regression coverage: the form used to call setSent(true) directly with a
 * comment "In production, POST to /api/v1/contact" -- no such endpoint
 * exists, so every submission was silently discarded while the user saw a
 * fake "Message sent!" success screen. Fixed by handing off to a mailto:
 * link (the browser's own email client), which actually delivers the
 * message with no new backend needed.
 */

vi.mock('@/components/layout/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));

describe('ContactPage', () => {
  let originalHref: string;

  beforeEach(() => {
    originalHref = window.location.href;
  });

  it('builds a mailto: link to the real support address with the form contents, rather than silently discarding the submission', async () => {
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.type(screen.getByPlaceholderText('Your name'), 'Amina');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.selectOptions(screen.getByRole('combobox'), 'safety');
    await user.type(screen.getByPlaceholderText('Describe your issue...'), 'Someone asked for a deposit before a viewing.');

    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
      },
    });

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(capturedHref).toMatch(/^mailto:support@muslimrentals\.ca\?/);
    expect(decodeURIComponent(capturedHref)).toContain('Safety concern');
    expect(decodeURIComponent(capturedHref)).toContain('Someone asked for a deposit before a viewing.');
    expect(decodeURIComponent(capturedHref)).toContain('Amina');
    expect(decodeURIComponent(capturedHref)).toContain('amina@example.com');

    // Restore for other tests / the environment.
    Object.defineProperty(window, 'location', { configurable: true, value: { href: originalHref } });
  });

  it('shows honest "opening your email app" copy after submit, not a false claim the message was already received', async () => {
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.type(screen.getByPlaceholderText('Your name'), 'Amina');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.selectOptions(screen.getByRole('combobox'), 'other');
    await user.type(screen.getByPlaceholderText('Describe your issue...'), 'Just a question.');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByText(/Opening your email app/)).toBeInTheDocument();
    expect(screen.queryByText(/Message sent!/)).not.toBeInTheDocument();
  });

  it('does not claim success for a message long enough to risk mailto: truncation -- offers a copy-paste fallback instead', async () => {
    const user = userEvent.setup();
    const { container } = render(<ContactPage />);

    let capturedHref = '';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() { return capturedHref; },
        set href(v: string) { capturedHref = v; },
      },
    });

    await user.type(screen.getByPlaceholderText('Your name'), 'Amina');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.selectOptions(screen.getByRole('combobox'), 'safety');
    const longMessage = 'This is a detailed scam report. '.repeat(80); // well over the safe mailto: length
    fireEvent.change(screen.getByPlaceholderText('Describe your issue...'), { target: { value: longMessage } });
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByText(/a bit too long to pre-fill/)).toBeInTheDocument();
    expect(screen.queryByText(/Opening your email app/)).not.toBeInTheDocument();
    expect(capturedHref).toBe(''); // never navigated to a (possibly truncated) mailto: link
    // The full message is still available to copy, not lost.
    // eslint-disable-next-line testing-library/no-node-access
    const fallbackTextarea = container.querySelector('textarea[readonly]') as HTMLTextAreaElement;
    expect(fallbackTextarea.value).toBe(longMessage);

    Object.defineProperty(window, 'location', { configurable: true, value: { href: originalHref } });
  });
});
