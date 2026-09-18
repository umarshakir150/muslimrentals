import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactPage from './page';

/**
 * Regression coverage: the form used to only build a mailto: link, which
 * silently does nothing without a configured default desktop email client
 * -- confirmed as the actual cause of a founder test where nothing arrived
 * at the real contact inbox. Fixed by submitting to POST /contact (backed
 * by the existing Resend transactional-email infrastructure), so success
 * and failure states here reflect what the backend actually confirmed,
 * not just what the browser attempted.
 */

const { submitMock } = vi.hoisted(() => ({ submitMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  contactApi: { submit: submitMock },
}));

beforeEach(() => {
  submitMock.mockReset();
});

describe('ContactPage', () => {
  it('submits the form to the real backend endpoint with the exact field values, and shows a genuine success confirmation', async () => {
    submitMock.mockResolvedValueOnce({ success: true, message: 'Message sent.' });
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.type(screen.getByPlaceholderText('Your name'), 'Amina');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.selectOptions(screen.getByRole('combobox'), 'safety');
    await user.type(screen.getByPlaceholderText('Describe your issue...'), 'Someone asked for a deposit before a viewing.');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(submitMock).toHaveBeenCalledWith({
      name: 'Amina',
      email: 'amina@example.com',
      subject: 'safety',
      message: 'Someone asked for a deposit before a viewing.',
    }));

    // Only claimed once the backend actually confirmed it -- not before.
    expect(await screen.findByText('Message sent')).toBeInTheDocument();
    expect(screen.getByText('Thank you for contacting Muslim Rentals.')).toBeInTheDocument();
  });

  it('never claims success when delivery actually fails -- shows the real error and keeps the form editable to retry', async () => {
    submitMock.mockRejectedValueOnce(new Error('Could not send your message right now. Please try again in a moment, or email us directly.'));
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.type(screen.getByPlaceholderText('Your name'), 'Amina');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.selectOptions(screen.getByRole('combobox'), 'other');
    await user.type(screen.getByPlaceholderText('Describe your issue...'), 'Just a question.');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Could not send your message right now. Please try again in a moment, or email us directly.')).toBeInTheDocument();
    expect(screen.queryByText('Message sent')).not.toBeInTheDocument();
    // The form is still there, with the visitor's own input intact, so they can retry.
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your name')).toHaveValue('Amina');
  });

  it('disables the form and shows a loading submit button while the request is in flight', async () => {
    let resolveSubmit!: (v: any) => void;
    submitMock.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));
    const user = userEvent.setup();
    render(<ContactPage />);

    await user.type(screen.getByPlaceholderText('Your name'), 'Amina');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'amina@example.com');
    await user.selectOptions(screen.getByRole('combobox'), 'other');
    await user.type(screen.getByPlaceholderText('Describe your issue...'), 'Just a question.');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByPlaceholderText('Your name')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send message/ })).toBeDisabled();

    resolveSubmit({ success: true, message: 'Message sent.' });
    await waitFor(() => expect(screen.getByText('Message sent')).toBeInTheDocument());
  });
});
