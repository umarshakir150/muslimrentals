import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PostListingModal from './PostListingModal';

const { createMock, updateMock, uploadImagesMock, deletePermanentMock, deleteImageMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  uploadImagesMock: vi.fn(),
  deletePermanentMock: vi.fn(),
  deleteImageMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  listingsApi: {
    create: createMock,
    update: updateMock,
    uploadImages: uploadImagesMock,
    deletePermanent: deletePermanentMock,
    deleteImage: deleteImageMock,
  },
  // Real implementation (not a mock) -- it's a pure discriminator over
  // whatever createMock/updateMock resolves to, same as production.
  needsLocationConfirmation: (res: any) => res?.needsLocationConfirmation === true,
}));

vi.mock('@/store/authStore', () => ({
  useIsAuthenticated: () => true,
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/components/auth/AuthModal', () => ({ default: () => null }));

// Stub the confirm-location map -- its own Leaflet wiring (draggable
// marker, centering, drag reporting) is covered by ConfirmLocationMap's
// own test file. Here we only need to simulate the landlord dragging the
// pin, exposed as a plain button so tests don't need a real map.
vi.mock('@/components/listings/ConfirmLocationMap', () => ({
  default: ({ onChange }: { initialLat: number; initialLng: number; onChange: (lat: number, lng: number) => void }) => (
    <button type="button" onClick={() => onChange(42.3035, -83.077)}>Simulate drag pin</button>
  ),
}));

// Stub the city autocomplete -- its own fetch/search behavior is covered by
// its own test file. Here we only need to simulate picking a value, exposed
// as a plain button so tests don't need a real backend.
vi.mock('@/components/ui/CityAutocomplete', () => ({
  default: ({ onChange }: { onChange: (city: string, coords?: [number, number], province?: string) => void }) => (
    <button type="button" onClick={() => onChange('Toronto', [43.6532, -79.3832], 'ON')}>
      Pick Toronto
    </button>
  ),
}));

describe('PostListingModal', () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
    uploadImagesMock.mockReset();
    deletePermanentMock.mockReset();
    deleteImageMock.mockReset();
    toastMock.mockReset();
    createMock.mockResolvedValue({ data: { id: 'listing-1', title: 'Test' } });
    updateMock.mockResolvedValue({ data: { id: 'listing-1', title: 'Test (edited)' } });
    uploadImagesMock.mockResolvedValue({ success: true, data: [] });
    deletePermanentMock.mockResolvedValue({ success: true, message: 'Listing permanently deleted.' });
    deleteImageMock.mockResolvedValue({ success: true, message: 'Image deleted.' });
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

  it('includes the selected city\'s province in the create payload, tightening the server-side geocoding query', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToStep3(user);
    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Toronto', province: 'ON', address: '456 Spadina Avenue' })
    ));
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

  // The universal confirm-property-location flow: EVERY address submission
  // comes back as `needsLocationConfirmation` instead of a created listing
  // (see routes/listings.ts's resolveGeocodedLocation) -- the frontend
  // response shape carries no confidence info at all (just matchedLat/
  // matchedLng), so the exact same UI/flow below handles a precise
  // (house-level) match and a street-level-only match identically.
  describe('universal confirm-property-location flow', () => {
    beforeEach(() => {
      createMock.mockReset();
    });

    it.each([
      ['a precise (house-level) match', { matchedLat: 43.5789, matchedLng: -79.6583 }],
      ['a street-level-only match', { matchedLat: 42.3023085, matchedLng: -83.0764497 }],
    ])('shows the "Confirm property location" step and creates nothing for %s', async (_label, matched) => {
      createMock.mockResolvedValueOnce({
        success: true,
        needsLocationConfirmation: true,
        data: matched,
      });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} />);

      await goToStep3(user);
      await user.click(screen.getByRole('button', { name: 'Post listing' }));

      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());
      expect(screen.getByText(/Make sure the pin is on the property\./)).toBeInTheDocument();
      expect(uploadImagesMock).not.toHaveBeenCalled();
    });

    it('resubmits with the dragged confirmedLat/confirmedLng and shows success once confirmed', async () => {
      createMock
        .mockResolvedValueOnce({
          success: true,
          needsLocationConfirmation: true,
          data: { matchedLat: 42.3023085, matchedLng: -83.0764497 },
        })
        .mockResolvedValueOnce({ data: { id: 'listing-confirmed', title: 'Test' } });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} />);

      await goToStep3(user);
      await user.click(screen.getByRole('button', { name: 'Post listing' }));
      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Simulate drag pin' }));
      await user.click(screen.getByRole('button', { name: 'Confirm location' }));

      await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
      expect(createMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ confirmedLat: 42.3035, confirmedLng: -83.077 })
      );
      await waitFor(() => expect(screen.getByText('Listing posted!')).toBeInTheDocument());
    });

    it('confirms with the geocoder-matched point unchanged if the landlord never drags the pin', async () => {
      createMock
        .mockResolvedValueOnce({
          success: true,
          needsLocationConfirmation: true,
          data: { matchedLat: 42.3023085, matchedLng: -83.0764497 },
        })
        .mockResolvedValueOnce({ data: { id: 'listing-confirmed', title: 'Test' } });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} />);

      await goToStep3(user);
      await user.click(screen.getByRole('button', { name: 'Post listing' }));
      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Confirm location' }));

      await waitFor(() => expect(createMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ confirmedLat: 42.3023085, confirmedLng: -83.0764497 })
      ));
    });

    it('the "Back" button returns to the form without creating anything', async () => {
      createMock.mockResolvedValueOnce({
        success: true,
        needsLocationConfirmation: true,
        data: { matchedLat: 42.3023085, matchedLng: -83.0764497 },
      });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} />);

      await goToStep3(user);
      await user.click(screen.getByRole('button', { name: 'Post listing' }));
      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Back' }));

      expect(screen.getByText('Post rental listing')).toBeInTheDocument();
      expect(createMock).toHaveBeenCalledTimes(1); // only the original attempt -- nothing further submitted
    });
  });

  describe('edit mode', () => {
    const EXISTING_LISTING = {
      id: 'listing-42',
      title: 'Existing listing title',
      description: 'An existing description that is definitely long enough to pass validation.',
      price: 1800,
      bedrooms: 2,
      bathrooms: 1,
      audience: 'ALL' as const,
      city: 'Toronto',
      province: 'ON',
      town: null,
      address: '123 Existing Street',
      unit: 'Unit 2',
      contactInfo: 'existing@example.com',
      amenities: ['Parking', 'Furnished'],
      images: [
        { id: 'img-1', url: 'https://example.com/1.jpg', alt: null, order: 0 },
        { id: 'img-2', url: 'https://example.com/2.jpg', alt: null, order: 1 },
      ],
    } as any;

    it('prefills every field from the listing prop', async () => {
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      expect(screen.getByDisplayValue('Existing listing title')).toBeInTheDocument();
      expect(screen.getByDisplayValue(EXISTING_LISTING.description)).toBeInTheDocument();
      expect(screen.getByDisplayValue('1800')).toBeInTheDocument();
    });

    it('shows "Edit listing" / "Save changes" instead of the create-mode copy', async () => {
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      expect(screen.getByText('Edit listing')).toBeInTheDocument();
      const user = userEvent.setup();
      await goToStep3(user, /* alreadyFilled */ true);
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    });

    // Reuses the same step-3 navigation helper, but the fields are already
    // prefilled in edit mode -- Continue just needs valid data, which the
    // prefilled listing already provides, so no re-typing is needed.
    async function goToStep3(user: ReturnType<typeof userEvent.setup>, _alreadyFilled = true) {
      await user.click(screen.getByRole('button', { name: /Continue/ }));
      await waitFor(() => expect(screen.getByText('Step 2 of 3')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /Continue/ }));
      await waitFor(() => expect(screen.getByText('Step 3 of 3')).toBeInTheDocument());
    }

    it('submits via listingsApi.update (PATCH), never create, and reports the saved listing via onSaved', async () => {
      const onSaved = vi.fn();
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} onSaved={onSaved} />);

      await goToStep3(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(updateMock).toHaveBeenCalledWith('listing-42', expect.objectContaining({ title: 'Existing listing title' })));
      expect(createMock).not.toHaveBeenCalled();
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'listing-1' })));
    });

    it('an address/city/province change that needs confirmation shows the SAME confirm-location step as create, and confirming resubmits via update with confirmedLat/Lng', async () => {
      updateMock.mockResolvedValueOnce({
        success: true,
        needsLocationConfirmation: true,
        data: { matchedLat: 43.7, matchedLng: -79.4 },
      });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      await goToStep3(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());
      await user.click(screen.getByText('Simulate drag pin'));
      await user.click(screen.getByRole('button', { name: 'Confirm location' }));

      await waitFor(() => expect(updateMock).toHaveBeenLastCalledWith(
        'listing-42',
        expect.objectContaining({ confirmedLat: 42.3035, confirmedLng: -83.077 })
      ));
    });

    it('an edit that does not need location confirmation never shows the confirm-location step at all', async () => {
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      await goToStep3(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(updateMock).toHaveBeenCalled());
      expect(screen.queryByText('Confirm property location')).not.toBeInTheDocument();
    });

    it('renders existing photos and removes one immediately via listingsApi.deleteImage on click', async () => {
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);
      await goToStep3(user);

      expect(document.querySelectorAll('img')).toHaveLength(2);

      const removeButtons = screen.getAllByRole('button', { name: 'Remove photo' });
      await user.click(removeButtons[0]);

      await waitFor(() => expect(deleteImageMock).toHaveBeenCalledWith('img-1'));
      await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(1));
    });

    it('restores the photo and shows a toast if removing an existing photo fails', async () => {
      deleteImageMock.mockRejectedValueOnce(new Error('Not authorized.'));
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);
      await goToStep3(user);

      const removeButtons = screen.getAllByRole('button', { name: 'Remove photo' });
      await user.click(removeButtons[0]);

      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Could not remove photo' })));
      expect(document.querySelectorAll('img')).toHaveLength(2); // never actually removed
    });

    it('uploads newly added photos to the SAME listing id after a successful save', async () => {
      const file = new File(['x'], 'new-photo.jpg', { type: 'image/jpeg' });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);
      await goToStep3(user);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, file);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(uploadImagesMock).toHaveBeenCalledWith('listing-1', [file]));
    });

    it('a failed photo upload after a successful edit save does NOT roll back the listing (no deletePermanent call), and reports the save via onSaved anyway', async () => {
      uploadImagesMock.mockRejectedValueOnce(new Error('Upload failed.'));
      const onSaved = vi.fn();
      const file = new File(['x'], 'new-photo.jpg', { type: 'image/jpeg' });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} onSaved={onSaved} />);
      await goToStep3(user);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, file);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        variant: 'destructive',
        title: 'Listing updated, but new photos failed to upload',
      })));
      expect(deletePermanentMock).not.toHaveBeenCalled();
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'listing-1' }));
      // Never shows the "Listing updated!" success screen for a partial failure.
      expect(screen.queryByText('Listing updated!')).not.toBeInTheDocument();
    });
  });
});
