import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListingFilters from './ListingFilters';
import { useFilterStore } from '@/store/filterStore';

vi.mock('@/lib/api', () => ({
  citiesApi: {
    getAll: vi.fn().mockResolvedValue({
      data: [
        { name: 'Toronto', province: 'ON', lat: 43.6532, lng: -79.3832 },
        { name: 'Ottawa', province: 'ON', lat: 45.4215, lng: -75.6972 },
      ],
    }),
  },
}));

const DEFAULT_FILTERS = {
  keyword: '',
  city: '',
  audience: 'all' as const,
  minBeds: 0,
  minBaths: 0,
  maxPrice: 5000,
  radiusKm: 80,
  sort: 'newest' as const,
  furnished: false,
  parking: false,
  utilities: false,
  page: 1,
};

describe('ListingFilters', () => {
  beforeEach(() => {
    useFilterStore.setState({ filters: { ...DEFAULT_FILTERS }, mapCenter: [43.6532, -79.3832] });
  });

  it('updates the keyword filter as the user types', async () => {
    const user = userEvent.setup();
    render(<ListingFilters />);

    await user.type(screen.getByPlaceholderText('Search listings...'), 'basement');

    await waitFor(() => expect(useFilterStore.getState().filters.keyword).toBe('basement'));
  });

  it('sets the audience filter and resets the page when a pill is clicked', async () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, page: 3 } }));
    const user = userEvent.setup();
    render(<ListingFilters />);

    await user.click(screen.getByRole('button', { name: 'Sisters' }));

    expect(useFilterStore.getState().filters.audience).toBe('SISTERS');
    expect(useFilterStore.getState().filters.page).toBe(1);
  });

  it('changes sort order via the select', async () => {
    const user = userEvent.setup();
    render(<ListingFilters />);

    await user.selectOptions(screen.getByDisplayValue('Newest'), 'priceLow');

    expect(useFilterStore.getState().filters.sort).toBe('priceLow');
  });

  it('does not show the reset button when no filters are active', () => {
    render(<ListingFilters />);
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
  });

  it('shows more filters when "More" is toggled, and toggling an amenity updates the store', async () => {
    const user = userEvent.setup();
    render(<ListingFilters />);

    expect(screen.queryByText('Furnished')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByText('Furnished')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Furnished' }));
    expect(useFilterStore.getState().filters.furnished).toBe(true);
  });

  it('shows a reset button once a filter is active and resets state on click', async () => {
    const user = userEvent.setup();
    render(<ListingFilters />);

    await user.click(screen.getByRole('button', { name: 'Couples' }));
    const resetButton = await screen.findByRole('button', { name: /reset/i });

    await user.click(resetButton);

    expect(useFilterStore.getState().filters).toEqual(DEFAULT_FILTERS);
  });
});
