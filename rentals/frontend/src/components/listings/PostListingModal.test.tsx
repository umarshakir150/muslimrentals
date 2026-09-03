import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostListingModal from './PostListingModal';

const { createMock, uploadImagesMock, deletePermanentMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  uploadImagesMock: vi.fn(),
  deletePermanentMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  listingsApi: { create: createMock, uploadImages: uploadImagesMock, deletePermanent: deletePermanentMock },
}));

vi.mock('@/store/authStore', () => ({
  useIsAuthenticated: () => true,
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/components/auth/AuthModal', () => ({ default: () => null }));

// Stub the city autocomplete -- its own fetch/search behavior is covered by
// its own test file. Here we only need to simulate picking a value, exposed
// as a plain button so tests don't need a real backend.
vi.mock('@/components/ui/CityAutocomplete', () => ({
  default: ({ onChange }: { onChange: (city: string) => void }) => (
    <button type="button" onClick={() => onChange('Toronto')}>
      Pick Toronto
    </button>
  ),
}));

describe('PostListingModal', () => {
  beforeEach(() => {
    createMock.mockReset();
    uploadImagesMock.mockReset();
    deletePermanentMock.mockReset();
    toastMock.mockReset();
    createMock.mockResolvedValue({ data: { id: 'listing-1', title: 'Test' } });
    uploadImagesMock.mockResolvedValue({ success: true, data: [] });
    deletePermanentMock.mockResolvedValue({ success: true, message: 'Listing permanently deleted.' });
  });

  async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText(/Bright 2BR/), 'A lovely test listing');
    await user.type(screen.getByPlaceholderText(/Describe the rental/), 'A description that is definitely long enough to pass validation.');
    await user.type(screen.getByPlaceholderText('1200'), '1500');
  }

  async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() => expect(screen.getByText('Step 2 of 3')).toBeInTheDocument());
  }

  async function goToStep3(user: ReturnType<typeof userEvent.setup>) {
    await goToStep2(user);
    await user.click(screen.getByText('Pick Toronto'));
    await user.type(screen.getByPlaceholderText(/123 Main Street/), '456 Spadina Avenue');
    await user.type(screen.getByPlaceholderText(/Phone, WhatsApp/), '555-0100');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() => expect(screen.getByText('Step 3 of 3')).toBeInTheDocument());
  }

  it('does not close or reset the form when the backdrop is clicked outside the modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PostListingModal open onClose={onClose} />);

    const titleInput = screen.getByPlaceholderText(/Bright 2BR/);
    await user.type(titleInput, 'Data that must survive');

    // The backdrop is the fixed inset-0 overlay -- click it directly by
    // finding the element whose class marks it as the backdrop.
    // eslint-disable-next-line testing-library/no-node-access
    const backdrop = titleInput.closest('.fixed.inset-0') as HTMLElement;
    await user.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Post rental listing')).toBeInTheDocument();
    expect(titleInput).toHaveValue('Data that must survive');
  });

  it('closes via the header close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<PostListingModal open onClose={onClose} />);

    // eslint-disable-next-line testing-library/no-node-access
    const closeBtn = container.querySelector('.border-b button') as HTMLElement;
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it('reaching step 3 via Continue never calls listingsApi.create', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToStep3(user);

    expect(screen.getByText(/Drag photos here/)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('submits via the explicit "Post listing" button and uploads selected images', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToStep3(user);

    const file = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(uploadImagesMock).toHaveBeenCalledWith('listing-1', [file]));
  });

  it('does not attempt an image upload when no images were selected', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToStep3(user);
    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(uploadImagesMock).not.toHaveBeenCalled();
  });

  it('rolls back the listing and does not show a success state when photo upload fails', async () => {
    uploadImagesMock.mockRejectedValue(new Error('Upload failed: storage rejected the request'));
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToStep3(user);
    const file = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(uploadImagesMock).toHaveBeenCalledWith('listing-1', [file]));
    await waitFor(() => expect(deletePermanentMock).toHaveBeenCalledWith('listing-1'));

    // Must not show the success state for a listing that was just rolled back.
    expect(screen.queryByText('Listing posted!')).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'Could not post your listing' })
    );
    // The form (with the entered data) should still be there for a retry,
    // not reset/closed as if this were a normal successful submit.
    expect(screen.getByText('Post rental listing')).toBeInTheDocument();
  });

  it('still shows a destructive error if the rollback delete itself fails, rather than a success state', async () => {
    uploadImagesMock.mockRejectedValue(new Error('Upload failed'));
    deletePermanentMock.mockRejectedValue(new Error('Delete failed'));
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToStep3(user);
    const file = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(deletePermanentMock).toHaveBeenCalledWith('listing-1'));
    expect(screen.queryByText('Listing posted!')).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'Could not post your listing' })
    );
  });
});
