import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteListingDialog from './DeleteListingDialog';

const { deletePermanentMock } = vi.hoisted(() => ({
  deletePermanentMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  listingsApi: { deletePermanent: deletePermanentMock },
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe('DeleteListingDialog', () => {
  beforeEach(() => {
    deletePermanentMock.mockReset();
    toastMock.mockReset();
  });

  function setup() {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <DeleteListingDialog
        listingId="listing-1"
        listingTitle="Cozy room near mosque"
        open
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
    return { onClose, onDeleted };
  }

  it('renders the listing title in the confirmation copy', () => {
    setup();
    expect(screen.getByText(/Cozy room near mosque/)).toBeInTheDocument();
  });

  it('does not call the API when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deletePermanentMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls deletePermanent with the listing id and onDeleted on success', async () => {
    deletePermanentMock.mockResolvedValue({ success: true, message: 'Listing permanently deleted.' });
    const user = userEvent.setup();
    const { onDeleted } = setup();

    await user.click(screen.getByRole('button', { name: /Delete permanently/ }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('listing-1'));
    expect(deletePermanentMock).toHaveBeenCalledWith('listing-1');
  });

  it('shows an inline error and keeps the dialog open on failure', async () => {
    deletePermanentMock.mockRejectedValue(new Error('Not authorized.'));
    const user = userEvent.setup();
    const { onDeleted, onClose } = setup();

    await user.click(screen.getByRole('button', { name: /Delete permanently/ }));

    await waitFor(() => expect(screen.getByText('Not authorized.')).toBeInTheDocument());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when open is false', () => {
    render(
      <DeleteListingDialog
        listingId="listing-1"
        listingTitle="Cozy room near mosque"
        open={false}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />
    );
    expect(screen.queryByText('Delete this listing?')).not.toBeInTheDocument();
  });
});
