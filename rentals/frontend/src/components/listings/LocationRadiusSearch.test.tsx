import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LocationRadiusSearch from './LocationRadiusSearch';
import { useFilterStore } from '@/store/filterStore';

const { geocodeSearchMock } = vi.hoisted(() => ({ geocodeSearchMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  geocodeApi: { search: geocodeSearchMock },
}));

const { requestUserLocationMock } = vi.hoisted(() => ({ requestUserLocationMock: vi.fn() }));
vi.mock('@/lib/geolocation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/geolocation')>();
  return { ...actual, requestUserLocation: requestUserLocationMock };
});

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

const DEFAULT_FILTERS = {
  keyword: '', city: '', audience: 'all' as const, minBeds: 0, minBaths: 0,
  maxPrice: 5000, radiusKm: 5, sort: 'newest' as const,
  furnished: false, parking: false, utilities: false, page: 1,
};

describe('LocationRadiusSearch', () => {
  beforeEach(() => {
    geocodeSearchMock.mockReset();
    requestUserLocationMock.mockReset();
    toastMock.mockReset();
    useFilterStore.setState({ filters: { ...DEFAULT_FILTERS }, mapCenter: [43.6532, -79.3832] });
  });

  it('does not show the radius slider or a resolved location before any search', () => {
    render(<LocationRadiusSearch />);
    expect(screen.queryByText(/radius/i)).not.toBeInTheDocument();
  });

  it('geocodes the typed location on submit and sets filters.lat/lng/radiusKm', async () => {
    geocodeSearchMock.mockResolvedValue({ data: { lat: 43.773, lng: -79.257 } });
    const user = userEvent.setup();
    render(<LocationRadiusSearch />);

    await user.type(screen.getByPlaceholderText(/Scarborough/i), 'Scarborough');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(useFilterStore.getState().filters.lat).toBe(43.773));
    expect(useFilterStore.getState().filters.lng).toBe(-79.257);
    expect(geocodeSearchMock).toHaveBeenCalledWith('Scarborough');
  });

  it('also updates the shared mapCenter so /map pans to the searched location', async () => {
    geocodeSearchMock.mockResolvedValue({ data: { lat: 43.773, lng: -79.257 } });
    const user = userEvent.setup();
    render(<LocationRadiusSearch />);

    await user.type(screen.getByPlaceholderText(/Scarborough/i), 'Scarborough');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(useFilterStore.getState().mapCenter).toEqual([43.773, -79.257]));
  });

  it('shows the radius slider (1-10km) and resolved label once a location is set', async () => {
    geocodeSearchMock.mockResolvedValue({ data: { lat: 43.773, lng: -79.257 } });
    const user = userEvent.setup();
    render(<LocationRadiusSearch />);

    await user.type(screen.getByPlaceholderText(/Scarborough/i), 'Scarborough');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByText('Scarborough', { exact: false })).toBeInTheDocument());
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('10');
  });

  it('moving the radius slider updates filters.radiusKm', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257 } }));
    render(<LocationRadiusSearch />);

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '8' } });

    expect(useFilterStore.getState().filters.radiusKm).toBe(8);
  });

  it('shows a destructive toast and sets no filters when the location cannot be found', async () => {
    geocodeSearchMock.mockRejectedValue(new Error('not found'));
    const user = userEvent.setup();
    render(<LocationRadiusSearch />);

    await user.type(screen.getByPlaceholderText(/Scarborough/i), 'Nonexistent Place');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(useFilterStore.getState().filters.lat).toBeUndefined();
  });

  it('"Use my location" sets filters.lat/lng from requestUserLocation, without any geocode call', async () => {
    requestUserLocationMock.mockResolvedValue({ lat: 45.4215, lng: -75.6972, accuracyM: 20 });
    const user = userEvent.setup();
    render(<LocationRadiusSearch />);

    await user.click(screen.getByRole('button', { name: /use my current location/i }));

    await waitFor(() => expect(useFilterStore.getState().filters.lat).toBe(45.4215));
    expect(geocodeSearchMock).not.toHaveBeenCalled();
  });

  it('shows a destructive toast when "Use my location" fails (e.g. permission denied)', async () => {
    requestUserLocationMock.mockRejectedValue({ reason: 'denied', message: 'Denied.' });
    const user = userEvent.setup();
    render(<LocationRadiusSearch />);

    await user.click(screen.getByRole('button', { name: /use my current location/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Location permission denied',
      variant: 'destructive',
    })));
  });

  it('Clear removes the location filter (and the slider/label) without touching other filters', async () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, keyword: 'basement', lat: 43.773, lng: -79.257 } }));
    const user = userEvent.setup();
    render(<LocationRadiusSearch />);

    await user.click(screen.getByRole('button', { name: /clear/i }));

    expect(useFilterStore.getState().filters.lat).toBeUndefined();
    expect(useFilterStore.getState().filters.lng).toBeUndefined();
    // Unrelated filters (e.g. an active keyword search) survive the clear.
    expect(useFilterStore.getState().filters.keyword).toBe('basement');
    expect(screen.queryByText(/radius/i)).not.toBeInTheDocument();
  });

  it('falls back to a generic label when filters.lat/lng were set by something other than this widget (e.g. the City picker)', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.6532, lng: -79.3832 } }));
    render(<LocationRadiusSearch />);

    expect(screen.getByText(/the selected location/i)).toBeInTheDocument();
  });
});
