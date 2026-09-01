import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SendMessageModal from './SendMessageModal';
import { Listing } from '@/types';

const { startConversationMock } = vi.hoisted(() => ({ startConversationMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  messagesApi: { startConversation: startConversationMock },
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

function baseListing(overrides: Partial<Listing> = {}): Listing {
  return { id: 'listing-1', title: 'Cozy 2BR near the mosque', ...overrides } as Listing;
}

describe('SendMessageModal', () => {
  beforeEach(() => {
    startConversationMock.mockReset();
    toastMock.mockReset();
  });

  it('shows the listing title and disables submit until a message is typed', () => {
    render(<SendMessageModal listing={baseListing()} onClose={vi.fn()} />);
    expect(screen.getByText(/Cozy 2BR near the mosque/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('starts a conversation, toasts, and closes on successful send', async () => {
    startConversationMock.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const onSent = vi.fn();
    const user = userEvent.setup();
    render(<SendMessageModal listing={baseListing()} onClose={onClose} onSent={onSent} />);

    await user.type(screen.getByPlaceholderText(/interested in your listing/), "I'm interested!");
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(startConversationMock).toHaveBeenCalledWith('listing-1', "I'm interested!"));
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Message sent!' }));
    expect(onSent).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error toast and stays open when sending fails', async () => {
    startConversationMock.mockRejectedValue(new Error('Network error'));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SendMessageModal listing={baseListing()} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText(/interested in your listing/), 'Hi there');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes without sending when Cancel is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SendMessageModal listing={baseListing()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(startConversationMock).not.toHaveBeenCalled();
  });
});
