import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListingDetail from './ListingDetail';
import { Listing } from '@/types';

vi.mock('@/lib/api', () => ({
  listingsApi: { save: vi.fn(), report: vi.fn(), deletePermanent: vi.fn() },
}));

vi.mock('@/store/authStore', () => ({
  useIsAuthenticated: () => true,
  useUser: () => ({ id: 'user-1' }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function makeListing(imageCount: number): Listing {
  return {
    id: 'listing-1',
    title: 'Cozy room near mosque',
    description: 'A lovely room.',
    price: 1200,
    currency: 'CAD',
    bedrooms: 1,
    bathrooms: 1,
    audience: 'BROTHERS',
    city: 'Toronto',
    town: null,
    province: 'ON',
    neighbourhood: 'Downtown',
    address: null,
    lat: 43.6,
    lng: -79.4,
    contactInfo: '555-0100',
    status: 'ACTIVE',
    isActive: true,
    isFeatured: false,
    viewCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    images: Array.from({ length: imageCount }, (_, i) => ({
      id: `img-${i}`,
      url: `https://example.com/${i}.jpg`,
      alt: null,
      order: i,
    })),
    amenities: [],
    user: { id: 'owner-1', name: 'Owner', avatarUrl: null },
  };
}

describe('ListingDetail image gallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the placeholder and no arrows/counter when there are no images', () => {
    render(<ListingDetail listing={makeListing(0)} onClose={vi.fn()} onMessage={vi.fn()} />);

    expect(screen.getByText('🏠')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next photo' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
  });

  it('shows a single image with no arrows/counter', () => {
    render(<ListingDetail listing={makeListing(1)} onClose={vi.fn()} onMessage={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Next photo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous photo' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
  });

  it('shows arrows and a 1/N counter for multiple images, and arrows navigate', async () => {
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(4)} onClose={vi.fn()} onMessage={vi.fn()} />);

    expect(screen.getByText('1 / 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByText('2 / 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByText('1 / 4')).toBeInTheDocument();

    // wraps around backwards from the first photo
    await user.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByText('4 / 4')).toBeInTheDocument();
  });

  it('resets the selected image when switching to a different listing', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ListingDetail listing={makeListing(4)} onClose={vi.fn()} onMessage={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByText('2 / 4')).toBeInTheDocument();

    const other = { ...makeListing(2), id: 'listing-2' };
    rerender(<ListingDetail listing={other} onClose={vi.fn()} onMessage={vi.fn()} />);

    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('opens the lightbox on clicking the main photo, with working arrows, counter, and Escape-to-close', async () => {
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(3)} onClose={vi.fn()} onMessage={vi.fn()} />);

    const mainPhoto = screen.getAllByAltText('Cozy room near mosque')[0];
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
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(2)} onClose={vi.fn()} onMessage={vi.fn()} />);

    const mainPhoto = screen.getAllByAltText('Cozy room near mosque')[0];
    await user.click(mainPhoto);
    await waitFor(() => expect(screen.getByLabelText('Close')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Close'));

    await waitFor(() => expect(screen.queryByLabelText('Close')).not.toBeInTheDocument());
  });

  it('closes the lightbox when clicking the backdrop outside the image', async () => {
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(2)} onClose={vi.fn()} onMessage={vi.fn()} />);

    const mainPhoto = screen.getAllByAltText('Cozy room near mosque')[0];
    await user.click(mainPhoto);
    const closeButton = await screen.findByLabelText('Close');

    // The backdrop is the close button's direct parent -- clicking it directly
    // (not a descendant like the image) should close, same as clicking outside.
    const backdrop = closeButton.parentElement as HTMLElement;
    await user.click(backdrop);

    await waitFor(() => expect(screen.queryByLabelText('Close')).not.toBeInTheDocument());
  });

  it('does not close the lightbox when clicking the enlarged image itself', async () => {
    const user = userEvent.setup();
    render(<ListingDetail listing={makeListing(2)} onClose={vi.fn()} onMessage={vi.fn()} />);

    const mainPhoto = screen.getAllByAltText('Cozy room near mosque')[0];
    await user.click(mainPhoto);
    await screen.findByLabelText('Close');

    const enlargedImage = screen.getAllByAltText('Cozy room near mosque')[1];
    await user.click(enlargedImage);

    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });

  it('does not render a lightbox trigger crash when there are no images', () => {
    render(<ListingDetail listing={makeListing(0)} onClose={vi.fn()} onMessage={vi.fn()} />);
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
  });
});
