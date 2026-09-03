import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListingDetail from './ListingDetail';
import { Listing, ListingImage } from '@/types';

const { getByIdMock, reportMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  reportMock: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/api', () => ({
  listingsApi: { save: vi.fn(), report: reportMock, deletePermanent: vi.fn(), getById: getByIdMock },
}));

vi.mock('@/store/authStore', () => ({
  useIsAuthenticated: () => true,
  useUser: () => ({ id: 'user-1' }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Real image rows pulled directly from production (Supabase project
// mxpoenfnqrfwznquaibd, listing af96127c-2b38-4d53-9367-f63870bfdb72,
// "testing photos") on 2026-09-01, while diagnosing why the gallery never
// showed arrows in production despite this exact listing having 4 real
// uploaded photos. Used verbatim (not a hand-rolled shape) so this test
// actually exercises the real response shape, real R2 host, and real key
// format -- not an approximation of it.
const REAL_PROD_IMAGES: ListingImage[] = [
  { id: '6396895d-8ea0-49c1-8199-4fdff63d6f90', alt: null, order: 0,
    url: 'https://pub-960f6265cad24490a2783e6d4836656e.r2.dev/listings/b75a51b6-c4b1-471a-8615-8a2f8bf992eb.png' },
  { id: '781c44b5-797a-4951-9d88-e0dbda29f5a8', alt: null, order: 1,
    url: 'https://pub-960f6265cad24490a2783e6d4836656e.r2.dev/listings/2bc55f69-b8f6-42fb-b71a-ca321de91635.png' },
  { id: 'fb7827c8-0f36-4ad6-980e-20cc9f2cc2a4', alt: null, order: 2,
    url: 'https://pub-960f6265cad24490a2783e6d4836656e.r2.dev/listings/85a81118-c58d-4973-b170-cb9aa2c119cc.png' },
  { id: 'a6e65a79-049f-4626-953b-e8398c07ad93', alt: null, order: 3,
    url: 'https://pub-960f6265cad24490a2783e6d4836656e.r2.dev/listings/3fba781a-9e21-4fca-ad69-71e1eacf3c0a.png' },
];

function makeListing(images: ListingImage[]): Listing {
  return {
    id: 'listing-1',
    title: 'testing photos',
    description: 'testing multiple photos',
    price: 3,
    currency: 'CAD',
    bedrooms: 2,
    bathrooms: 4,
    audience: 'COUPLES',
    city: 'Mississauga',
    town: '',
    province: null,
    neighbourhood: 'City Centre',
    address: null,
    lat: 43.5932,
    lng: -79.6421,
    contactInfo: 'test info',
    status: 'ACTIVE',
    isActive: true,
    isFeatured: false,
    viewCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    images,
    amenities: ['Laundry in-unit', 'Air conditioning', 'Backyard access'],
    user: { id: 'owner-1', name: 'Umar Admin', avatarUrl: null },
  };
}

/**
 * GET /listings (the list endpoint every browse/map/saved/my-listings page
 * actually calls) caps `images` to 1 via Prisma's `take: 1` -- it is NOT the
 * shape ListingDetail should render from. Only GET /listings/:id (what
 * listingsApi.getById hits) returns the full array. This mocks that real
 * split: `propImages` is what the list endpoint would have handed the
 * `listing` prop, `detailImages` is what getById resolves with.
 */
function mockDetailFetch(detailImages: ListingImage[], listing = makeListing(detailImages)) {
  getByIdMock.mockImplementation((id: string) =>
    Promise.resolve({ data: { ...listing, id, images: detailImages } })
  );
}

describe('ListingDetail image gallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always fetches the full listing detail (GET /listings/:id) on open, never relying on the list-shape prop alone', async () => {
    mockDetailFetch(REAL_PROD_IMAGES);
    const propListing = makeListing([REAL_PROD_IMAGES[0]]); // list endpoint's take:1-truncated shape
    render(<ListingDetail listing={propListing} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalledWith('listing-1'));
  });

  it('REGRESSION: a list-truncated prop (1 image) still shows all real photos, arrows, and a counter once the detail fetch resolves', async () => {
    mockDetailFetch(REAL_PROD_IMAGES);
    const propListing = makeListing([REAL_PROD_IMAGES[0]]); // what GET /listings actually hands the modal
    render(<ListingDetail listing={propListing} onClose={vi.fn()} onMessage={vi.fn()} />);

    // This is the exact production bug: without the getById fetch, imgs.length
    // stays 1 forever and no arrows/counter ever appear.
    await waitFor(() => expect(screen.getByText('1 / 4')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeInTheDocument();
  });

  it('shows the placeholder and no arrows/counter when the real detail response has no images', async () => {
    mockDetailFetch([]);
    render(<ListingDetail listing={makeListing([])} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    expect(screen.getByText('🏠')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next photo' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
  });

  it('shows a single real image with no arrows/counter when the detail response genuinely has only one', async () => {
    mockDetailFetch([REAL_PROD_IMAGES[0]]);
    render(<ListingDetail listing={makeListing([REAL_PROD_IMAGES[0]])} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Next photo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous photo' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
  });

  it('shows arrows and a 1/N counter for multiple real images, and arrows navigate (with wraparound)', async () => {
    mockDetailFetch(REAL_PROD_IMAGES);
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(REAL_PROD_IMAGES)} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('1 / 4')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByText('2 / 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByText('1 / 4')).toBeInTheDocument();

    // wraps around backwards from the first photo
    await user.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByText('4 / 4')).toBeInTheDocument();
  });

  it('resets the selected image and re-fetches when switching to a different listing', async () => {
    const listingA = makeListing(REAL_PROD_IMAGES);
    const listingB = { ...makeListing(REAL_PROD_IMAGES.slice(0, 2)), id: 'listing-2' };
    getByIdMock.mockImplementation((id: string) =>
      Promise.resolve({
        data: { ...(id === 'listing-2' ? listingB : listingA), images: id === 'listing-2' ? REAL_PROD_IMAGES.slice(0, 2) : REAL_PROD_IMAGES },
      })
    );
    const user = userEvent.setup();
    const { rerender } = render(<ListingDetail listing={listingA} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('1 / 4')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByText('2 / 4')).toBeInTheDocument();

    rerender(<ListingDetail listing={listingB} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
  });

  it('opens the lightbox on clicking the main photo, with working arrows, counter, and Escape-to-close', async () => {
    mockDetailFetch(REAL_PROD_IMAGES.slice(0, 3));
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(REAL_PROD_IMAGES.slice(0, 3))} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument());

    const mainPhoto = screen.getAllByAltText('testing photos')[0];
    await user.click(mainPhoto);

    await waitFor(() => expect(screen.getByLabelText('Close')).toBeInTheDocument());
    // Both the inline gallery and the lightbox show a counter, sharing the same index.
    expect(screen.getAllByText('1 / 3')).toHaveLength(2);

    // Two "Next photo" buttons exist (inline gallery + lightbox); the lightbox's
    // is rendered last since it mounts after the gallery in the component tree.
    const nextButtons = screen.getAllByLabelText('Next photo');
    await user.click(nextButtons[nextButtons.length - 1]);
    await waitFor(() => expect(screen.getAllByText('2 / 3')).toHaveLength(2));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Close')).not.toBeInTheDocument());
  });

  it('closes the lightbox via the X button', async () => {
    mockDetailFetch(REAL_PROD_IMAGES.slice(0, 2));
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(REAL_PROD_IMAGES.slice(0, 2))} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    const mainPhoto = screen.getAllByAltText('testing photos')[0];
    await user.click(mainPhoto);
    await waitFor(() => expect(screen.getByLabelText('Close')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Close'));

    await waitFor(() => expect(screen.queryByLabelText('Close')).not.toBeInTheDocument());
  });

  it('closes the lightbox when clicking the backdrop outside the image', async () => {
    mockDetailFetch(REAL_PROD_IMAGES.slice(0, 2));
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(REAL_PROD_IMAGES.slice(0, 2))} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    const mainPhoto = screen.getAllByAltText('testing photos')[0];
    await user.click(mainPhoto);
    const closeButton = await screen.findByLabelText('Close');

    // The backdrop is the close button's direct parent -- clicking it directly
    // (not a descendant like the image) should close, same as clicking outside.
    const backdrop = closeButton.parentElement as HTMLElement;
    await user.click(backdrop);

    await waitFor(() => expect(screen.queryByLabelText('Close')).not.toBeInTheDocument());
  });

  it('does not close the lightbox when clicking the enlarged image itself', async () => {
    mockDetailFetch(REAL_PROD_IMAGES.slice(0, 2));
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(REAL_PROD_IMAGES.slice(0, 2))} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    const mainPhoto = screen.getAllByAltText('testing photos')[0];
    await user.click(mainPhoto);
    await screen.findByLabelText('Close');

    const enlargedImage = screen.getAllByAltText('testing photos')[1];
    await user.click(enlargedImage);

    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });

  it('does not crash and shows no lightbox trigger when there are no images', async () => {
    mockDetailFetch([]);
    render(<ListingDetail listing={makeListing([])} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('keeps showing the prop thumbnail without crashing if the detail fetch fails', async () => {
    getByIdMock.mockRejectedValue(new Error('network error'));
    render(<ListingDetail listing={makeListing([REAL_PROD_IMAGES[0]])} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    expect(screen.getAllByAltText('testing photos')[0]).toBeInTheDocument();
  });
});

describe('ListingDetail approximate-location disclosure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the "approximate location" caption when the listing carries locationApproximate', async () => {
    mockDetailFetch([]);
    const listing = { ...makeListing([]), locationApproximate: true, locationPrecisionRadiusM: 200 };
    render(<ListingDetail listing={listing} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    expect(screen.getByText(/approximate location/i)).toBeInTheDocument();
    expect(screen.getByText(/exact address hidden for privacy/i)).toBeInTheDocument();
  });

  it('does not show the approximate-location caption for a listing without it (owner/staff view)', async () => {
    mockDetailFetch([]);
    const listing = makeListing([]); // locationApproximate left unset, as the owner/staff response shape does
    render(<ListingDetail listing={listing} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    expect(screen.queryByText(/approximate location/i)).not.toBeInTheDocument();
  });

  it('renders cleanly on a null neighbourhood (routine now that new listings are address-based, not neighbourhood-based), falling back to city + the approximate-location caption', async () => {
    mockDetailFetch([]);
    // makeListing's own city/province ('Mississauga' / null) -- with
    // neighbourhood also null, the location line should fall back to just
    // the city, never a literal "null" or a dangling comma.
    const listing = {
      ...makeListing([]),
      neighbourhood: null,
      locationApproximate: true,
      locationPrecisionRadiusM: 200,
    };
    render(<ListingDetail listing={listing} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    expect(screen.getByText('Mississauga')).toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
    expect(screen.getByText(/approximate location/i)).toBeInTheDocument();
  });

  it('never renders a street address, even if one were present on the listing object (defense in depth -- this modal has no address UI for any viewer)', async () => {
    const listingWithAddress = { ...makeListing([]), address: '123 Real Street, Unit 4', locationApproximate: true, locationPrecisionRadiusM: 200 };
    mockDetailFetch([], listingWithAddress);
    render(<ListingDetail listing={listingWithAddress} onClose={vi.fn()} onMessage={vi.fn()} />);

    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());
    expect(screen.queryByText('123 Real Street, Unit 4')).not.toBeInTheDocument();
  });
});

describe('ListingDetail report flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportMock.mockResolvedValue({ success: true });
  });

  it('opens the shared ReportModal (LISTING target) from the flag button and submits via listingsApi.report', async () => {
    mockDetailFetch([]);
    const listing = makeListing([]);
    const user = userEvent.setup();
    render(<ListingDetail listing={listing} onClose={vi.fn()} onMessage={vi.fn()} />);
    await waitFor(() => expect(getByIdMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Report listing' }));
    expect(screen.getByText('Report this listing')).toBeInTheDocument();
    expect(screen.getAllByText(listing.title).length).toBeGreaterThan(0);

    await user.click(screen.getByText('Misleading or fraudulent listing'));
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() =>
      expect(reportMock).toHaveBeenCalledWith(listing.id, 'Misleading or fraudulent listing', undefined)
    );
  });
});
