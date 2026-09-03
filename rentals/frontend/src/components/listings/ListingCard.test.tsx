import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ListingCard from './ListingCard';
import type { Listing } from '@/types';

/**
 * Regression coverage for a null `neighbourhood` -- routine now that new
 * listings are created via a real geocoded address rather than a
 * neighbourhood dropdown (see PostListingModal.tsx), so this is no longer
 * just a rare pre-existing-row edge case. ListingCard is the shared card
 * used by both /browse and /saved, so this one component's null-safety
 * covers both pages.
 */

vi.mock('@/lib/api', () => ({ listingsApi: { save: vi.fn() } }));
vi.mock('@/store/authStore', () => ({ useIsAuthenticated: () => true }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    title: 'Bright 2BR near the mosque',
    description: 'A lovely apartment.',
    price: 1500,
    currency: 'CAD',
    bedrooms: 2,
    bathrooms: 1,
    audience: 'ALL',
    city: 'Toronto',
    town: '',
    province: 'ON',
    neighbourhood: null,
    address: null,
    lat: 43.6532,
    lng: -79.3832,
    contactInfo: 'test info',
    status: 'ACTIVE',
    isActive: true,
    isFeatured: false,
    viewCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    images: [],
    amenities: [],
    user: { id: 'owner-1', name: 'Owner', avatarUrl: null },
    ...overrides,
  } as unknown as Listing;
}

const noop = { onView: vi.fn(), onMap: vi.fn(), onMessage: vi.fn() };

describe('ListingCard — location line with a null neighbourhood', () => {
  it('renders just the city, with no crash and no literal "null"/"undefined" text, when neighbourhood is null', () => {
    render(<ListingCard listing={makeListing({ neighbourhood: null })} {...noop} />);

    expect(screen.getByText('Toronto')).toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
    // No dangling leading comma/space from the `neighbourhood + ', '` template.
    expect(screen.queryByText(/^,\s*Toronto/)).not.toBeInTheDocument();
  });

  it('still shows "neighbourhood, city" when a neighbourhood is present (existing/legacy listings)', () => {
    render(<ListingCard listing={makeListing({ neighbourhood: 'Kensington Market' })} {...noop} />);

    expect(screen.getByText('Kensington Market, Toronto')).toBeInTheDocument();
  });

  it('renders without crashing for a listing carrying the new approximate-location fields alongside a null neighbourhood', () => {
    render(
      <ListingCard
        listing={makeListing({ neighbourhood: null, locationApproximate: true, locationPrecisionRadiusM: 200 } as Partial<Listing>)}
        {...noop}
      />
    );

    expect(screen.getByText('Bright 2BR near the mosque')).toBeInTheDocument();
    expect(screen.getByText('Toronto')).toBeInTheDocument();
  });
});
