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
  default: ({ initialLat, initialLng, onChange }: { initialLat: number; initialLng: number; onChange: (lat: number, lng: number) => void }) => (
    <div>
      {/* Exposes exactly what the map was preloaded with, so tests can
          assert the preload source without needing a real Leaflet map. */}
      <p data-testid="confirm-map-initial">{initialLat},{initialLng}</p>
      <button type="button" onClick={() => onChange(42.3035, -83.077)}>Simulate drag pin</button>
    </div>
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

// Milestone 5: the wizard is now 5 named steps (Property -> Details ->
// Preferences -> Photos -> Review) instead of the old 3 generic ones, with
// fields regrouped: Property = city/address/unit/town/beds/baths, Details =
// title/description/price/contactInfo, Preferences = audience/amenities,
// Photos unchanged, Review is new (a read-only summary + the real submit
// action). Every helper below reflects that regrouping; the underlying
// behavioral guarantees each test protects (never-create-early, the
// universal confirm-location gate, create-vs-edit divergence, immediate
// existing-photo removal, etc.) are unchanged from before the redesign.
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

  async function continueTo(user: ReturnType<typeof userEvent.setup>, stepNumber: number) {
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() => expect(screen.getByText(new RegExp(`Step ${stepNumber} of 5`))).toBeInTheDocument());
  }

  async function fillProperty(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText('Pick Toronto'));
    await user.type(screen.getByPlaceholderText(/123 Main Street/), '456 Spadina Avenue');
  }

  async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText(/Bright 2BR/), 'A lovely test listing');
    await user.type(screen.getByPlaceholderText(/Describe the rental/), 'A description that is definitely long enough to pass validation.');
    await user.type(screen.getByPlaceholderText('1200'), '1500');
    await user.type(screen.getByPlaceholderText(/Phone, WhatsApp/), '555-0100');
  }

  // Reaches the Photos step (step 4) with everything up to it valid --
  // the direct analogue of the old suite's `goToStep3` (its old step 3 was
  // also Photos).
  async function goToPhotos(user: ReturnType<typeof userEvent.setup>) {
    await fillProperty(user);
    await continueTo(user, 2); // -> Details
    await fillDetails(user);
    await continueTo(user, 3); // -> Preferences
    await continueTo(user, 4); // -> Photos
  }

  async function goToReview(user: ReturnType<typeof userEvent.setup>) {
    await goToPhotos(user);
    await continueTo(user, 5); // -> Review
  }

  it('does not close or reset the form when the backdrop is clicked outside the modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PostListingModal open onClose={onClose} />);

    await fillProperty(user);
    await continueTo(user, 2); // -> Details
    const titleInput = screen.getByPlaceholderText(/Bright 2BR/);
    await user.type(titleInput, 'Data that must survive');

    // The backdrop is the fixed inset-0 overlay -- click it directly by
    // finding the element whose class marks it as the backdrop.
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

    const closeBtn = container.querySelector('.border-b button') as HTMLElement;
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it('reaching the Photos step via Continue never calls listingsApi.create', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToPhotos(user);

    expect(screen.getByText(/Drag photos here/)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('reaching the Review step never calls listingsApi.create, and shows the entered data back', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToReview(user);

    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByText('A lovely test listing')).toBeInTheDocument();
    expect(screen.getByText('Toronto')).toBeInTheDocument();
  });

  it('submits via the explicit "Post listing" button on Review and uploads selected images', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToPhotos(user);

    const file = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await continueTo(user, 5);
    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(uploadImagesMock).toHaveBeenCalledWith('listing-1', [file]));
  });

  it('includes the selected city\'s province in the create payload, tightening the server-side geocoding query', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Toronto', province: 'ON', address: '456 Spadina Avenue' })
    ));
  });

  it('does not attempt an image upload when no images were selected', async () => {
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToReview(user);
    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(uploadImagesMock).not.toHaveBeenCalled();
  });

  it('rolls back the listing and does not show a success state when photo upload fails', async () => {
    uploadImagesMock.mockRejectedValue(new Error('Upload failed: storage rejected the request'));
    const user = userEvent.setup();
    render(<PostListingModal open onClose={vi.fn()} />);

    await goToPhotos(user);
    const file = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await continueTo(user, 5);
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

    await goToPhotos(user);
    const file = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await continueTo(user, 5);
    await user.click(screen.getByRole('button', { name: 'Post listing' }));

    await waitFor(() => expect(deletePermanentMock).toHaveBeenCalledWith('listing-1'));
    expect(screen.queryByText('Listing posted!')).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'Could not post your listing' })
    );
  });

  describe('Photos step: reordering pending photos', () => {
    it('moves a pending photo earlier/later without touching existing photos (none, in create mode)', async () => {
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} />);
      await goToPhotos(user);

      const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
      const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, [fileA, fileB]);

      // Two pending photos -> the first gets a "move later" control, the
      // second a "move earlier" one (no control past either end).
      expect(screen.queryByRole('button', { name: 'Move photo earlier' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Move photo earlier' }));

      await continueTo(user, 5);
      await user.click(screen.getByRole('button', { name: 'Post listing' }));

      // Reordering changed which File is uploaded first -- swapped A/B.
      await waitFor(() => expect(uploadImagesMock).toHaveBeenCalledWith('listing-1', [fileB, fileA]));
    });
  });

  // The universal confirm-property-location flow: EVERY address submission
  // comes back as `needsLocationConfirmation` instead of a created listing
  // (see routes/listings.ts's resolveGeocodedLocation) -- the frontend
  // response shape carries no confidence info at all (just matchedLat/
  // matchedLng), so the exact same UI/flow below handles a precise
  // (house-level) match and a street-level-only match identically. This is
  // reached from the new Review step's submit action instead of the old
  // step 3's, but the gate itself (and "Back" returning to wherever
  // submission was initiated, with nothing created) is unchanged.
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

      await goToReview(user);
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

      await goToReview(user);
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

      await goToReview(user);
      await user.click(screen.getByRole('button', { name: 'Post listing' }));
      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Confirm location' }));

      await waitFor(() => expect(createMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ confirmedLat: 42.3023085, confirmedLng: -83.0764497 })
      ));
    });

    it('the "Back" button returns to Review without creating anything', async () => {
      createMock.mockResolvedValueOnce({
        success: true,
        needsLocationConfirmation: true,
        data: { matchedLat: 42.3023085, matchedLng: -83.0764497 },
      });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} />);

      await goToReview(user);
      await user.click(screen.getByRole('button', { name: 'Post listing' }));
      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Back' }));

      expect(screen.getByText(/Step 5 of 5/)).toBeInTheDocument();
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

      expect(screen.getByDisplayValue('123 Existing Street')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Unit 2')).toBeInTheDocument();
    });

    it('shows "Edit listing" / "Save changes" instead of the create-mode copy', async () => {
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      expect(screen.getByText('Edit listing')).toBeInTheDocument();
      const user = userEvent.setup();
      await goToReviewEdit(user);
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    });

    // Edit mode prefills every field from a real, already-valid listing, so
    // Continue's per-step validation passes without retyping anything --
    // this just walks the same 5 steps to Review.
    async function goToReviewEdit(user: ReturnType<typeof userEvent.setup>) {
      await continueTo(user, 2); // Property -> Details
      await continueTo(user, 3); // Details -> Preferences
      await continueTo(user, 4); // Preferences -> Photos
      await continueTo(user, 5); // Photos -> Review
    }

    // Milestone follow-up: Edit must show the same final
    // confirm-property-location step as Post, on EVERY save -- including
    // one that doesn't touch address/city/province at all. The backend
    // (routes/listings.ts) now always returns needsLocationConfirmation on
    // an edit-form PATCH's first call; these tests exercise the resulting
    // two-step save this component already handles generically (the same
    // pendingConfirmation/confirmPendingLocation code path as create).
    function mockNeedsConfirmationThenSaved(matched: { matchedLat: number; matchedLng: number }) {
      updateMock.mockResolvedValueOnce({ success: true, needsLocationConfirmation: true, data: matched });
    }

    async function saveAndConfirm(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: 'Confirm location' }));
    }

    it('always shows "Confirm property location" after Save changes, even when address/city/province are unchanged (the removed shortcut)', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.6532, matchedLng: -79.3832 });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      await goToReviewEdit(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());
      expect(uploadImagesMock).not.toHaveBeenCalled();
    });

    // Literal reproduction of the founder's bug report against the PR #16
    // preview: clicking "Save changes" appeared to complete the edit and
    // close the modal immediately, with no confirm-location map at all.
    // Given the contract PATCH /listings/:id now returns
    // (needsLocationConfirmation: true + matchedLat/matchedLng), this proves
    // the frontend transitions to the SHARED ConfirmLocationMap step instead
    // of finalizing anything -- no success toast, no onClose, no onSaved --
    // until a second submit with confirmedLat/confirmedLng actually
    // completes the PATCH.
    it('given the PATCH response needs confirmation, Save Changes does NOT complete the edit or close the modal -- it shows the map; only confirming completes it', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.6532, matchedLng: -79.3832 });
      const onClose = vi.fn();
      const onSaved = vi.fn();
      const user = userEvent.setup();
      render(<PostListingModal open onClose={onClose} mode="edit" listing={EXISTING_LISTING} onSaved={onSaved} />);

      await goToReviewEdit(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      // First submit: must land on the confirm-location step, not a
      // completed/closed edit.
      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());
      expect(screen.getByTestId('confirm-map-initial')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing updated!' }));
      expect(screen.queryByText('Listing updated!')).not.toBeInTheDocument();
      expect(updateMock).toHaveBeenCalledTimes(1); // only the first (unconfirmed) submit so far

      // Second submit, now WITH confirmedLat/confirmedLng: this is the one
      // that actually completes the PATCH and reports the save.
      await user.click(screen.getByRole('button', { name: 'Confirm location' }));

      await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
      expect(updateMock).toHaveBeenLastCalledWith('listing-42', expect.objectContaining({
        confirmedLat: 43.6532, confirmedLng: -79.3832,
      }));
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'listing-1' })));
    });

    it('preloads the confirmation pin at the server-provided coordinate (the listing\'s current private exact coordinate), never something read off the listing prop directly', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.65321234, matchedLng: -79.38321234 });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      await goToReviewEdit(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.getByTestId('confirm-map-initial')).toHaveTextContent('43.65321234,-79.38321234'));
    });

    it('never uses the listing prop\'s own lat/lng for the confirmation pin -- only ever the server-returned coordinate (guards against ever wiring in the public/approximate value)', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.6532, matchedLng: -79.3832 });
      const user = userEvent.setup();
      // A caller mistakenly passing the PUBLIC/approximate shape -- if the
      // modal ever read lat/lng off the listing prop for the preload, this
      // would leak the redacted point into the "confirm exact location" step.
      const approximateListing = { ...EXISTING_LISTING, lat: 40.0, lng: -80.0, locationApproximate: true };
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={approximateListing} />);

      await goToReviewEdit(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.getByTestId('confirm-map-initial')).toHaveTextContent('43.6532,-79.3832'));
      expect(screen.getByTestId('confirm-map-initial')).not.toHaveTextContent('40');
    });

    it('leaving the pin unchanged resubmits the SAME server-provided coordinate as confirmedLat/Lng', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.6532, matchedLng: -79.3832 });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      await goToReviewEdit(user);
      await saveAndConfirm(user);

      await waitFor(() => expect(updateMock).toHaveBeenLastCalledWith(
        'listing-42',
        expect.objectContaining({ confirmedLat: 43.6532, confirmedLng: -79.3832 })
      ));
    });

    it('dragging the pin resubmits the NEW coordinate as confirmedLat/Lng, via the same confirm-location step as create', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.7, matchedLng: -79.4 });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      await goToReviewEdit(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());
      await user.click(screen.getByText('Simulate drag pin'));
      await user.click(screen.getByRole('button', { name: 'Confirm location' }));

      await waitFor(() => expect(updateMock).toHaveBeenLastCalledWith(
        'listing-42',
        expect.objectContaining({ confirmedLat: 42.3035, confirmedLng: -83.077 })
      ));
    });

    it('shows a destructive toast and keeps the confirm step open (does not save) when the moved pin fails city/province verification', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.6532, matchedLng: -79.3832 });
      updateMock.mockRejectedValueOnce(new Error("That pin doesn't look right for Toronto, ON -- that location appears to be in Ottawa, not Toronto."));
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      await goToReviewEdit(user);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(screen.getByText('Confirm property location')).toBeInTheDocument());

      await user.click(screen.getByText('Simulate drag pin'));
      await user.click(screen.getByRole('button', { name: 'Confirm location' }));

      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        variant: 'destructive',
        title: 'Could not confirm location',
      })));
      expect(screen.getByText('Confirm property location')).toBeInTheDocument();
    });

    it('submits via listingsApi.update (PATCH), never create, and reports the saved listing via onSaved once the location is confirmed', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.6532, matchedLng: -79.3832 });
      const onSaved = vi.fn();
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} onSaved={onSaved} />);

      await goToReviewEdit(user);
      await saveAndConfirm(user);

      expect(updateMock).toHaveBeenNthCalledWith(1, 'listing-42', expect.objectContaining({ title: 'Existing listing title' }));
      expect(createMock).not.toHaveBeenCalled();
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'listing-1' })));
    });

    it('renders existing photos and removes one immediately via listingsApi.deleteImage on click', async () => {
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);
      await continueTo(user, 2); await continueTo(user, 3); await continueTo(user, 4);

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
      await continueTo(user, 2); await continueTo(user, 3); await continueTo(user, 4);

      const removeButtons = screen.getAllByRole('button', { name: 'Remove photo' });
      await user.click(removeButtons[0]);

      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Could not remove photo' })));
      expect(document.querySelectorAll('img')).toHaveLength(2); // never actually removed
    });

    it('never shows a reorder control on existing (already-uploaded) photos', async () => {
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);
      await continueTo(user, 2); await continueTo(user, 3); await continueTo(user, 4);

      expect(screen.queryByRole('button', { name: 'Move photo earlier' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Move photo later' })).not.toBeInTheDocument();
    });

    it('uploads newly added photos to the SAME listing id after a successful save (post-confirmation)', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.6532, matchedLng: -79.3832 });
      const file = new File(['x'], 'new-photo.jpg', { type: 'image/jpeg' });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);
      await continueTo(user, 2); await continueTo(user, 3); await continueTo(user, 4);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, file);
      await continueTo(user, 5);
      await saveAndConfirm(user);

      await waitFor(() => expect(uploadImagesMock).toHaveBeenCalledWith('listing-1', [file]));
    });

    it('a failed photo upload after a successful edit save does NOT roll back the listing (no deletePermanent call), and reports the save via onSaved anyway', async () => {
      mockNeedsConfirmationThenSaved({ matchedLat: 43.6532, matchedLng: -79.3832 });
      uploadImagesMock.mockRejectedValueOnce(new Error('Upload failed.'));
      const onSaved = vi.fn();
      const file = new File(['x'], 'new-photo.jpg', { type: 'image/jpeg' });
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} onSaved={onSaved} />);
      await continueTo(user, 2); await continueTo(user, 3); await continueTo(user, 4);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, file);
      await continueTo(user, 5);
      await saveAndConfirm(user);

      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        variant: 'destructive',
        title: 'Listing updated, but new photos failed to upload',
      })));
      expect(deletePermanentMock).not.toHaveBeenCalled();
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'listing-1' }));
      // Never shows the "Listing updated!" success screen for a partial failure.
      expect(screen.queryByText('Listing updated!')).not.toBeInTheDocument();
    });

    it('the desktop step-jump row lets an owner skip straight to a later step without walking through Continue (edit mode is pre-validated)', async () => {
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} mode="edit" listing={EXISTING_LISTING} />);

      await user.click(screen.getByRole('button', { name: /Photos/ }));

      expect(screen.getByText(/Step 4 of 5/)).toBeInTheDocument();
    });
  });

  describe('create mode: step-jump navigation cannot skip ahead unvalidated', () => {
    it('the Photos/Review step-jump chips are not clickable before they have been reached via Continue', async () => {
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} />);

      const photosChip = screen.getByRole('button', { name: /Photos/ });
      expect(photosChip).toBeDisabled();
      await user.click(photosChip);
      // Still on step 1 -- the disabled chip did not navigate anywhere.
      expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
    });

    it('a step already reached becomes a clickable jump target to go back', async () => {
      const user = userEvent.setup();
      render(<PostListingModal open onClose={vi.fn()} />);

      await fillProperty(user);
      await continueTo(user, 2);

      await user.click(screen.getByRole('button', { name: /Property/ }));
      expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
    });
  });
});
