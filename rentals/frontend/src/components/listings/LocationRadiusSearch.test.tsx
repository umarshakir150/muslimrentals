import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LocationRadiusSearch from './LocationRadiusSearch';
import { useFilterStore } from '@/store/filterStore';

const { geocodeSuggestionsMock } = vi.hoisted(() => ({ geocodeSuggestionsMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  geocodeApi: { suggestions: geocodeSuggestionsMock },
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

const TOLDO_LANCER_CENTRE = {
  label: 'Toldo Lancer Centre, Windsor, Ontario',
  lat: 42.30569,
  lng: -83.06437,
};

async function typeQuery(input: HTMLElement, text: string) {
  const user = userEvent.setup();
  await user.type(input, text);
  // Suggestions fetch on a debounce timer -- advance past it inside act()
  // so the resulting state update is flushed before assertions run.
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
}

describe('LocationRadiusSearch (place/address autocomplete)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    geocodeSuggestionsMock.mockReset();
    requestUserLocationMock.mockReset();
    toastMock.mockReset();
    useFilterStore.setState({ filters: { ...DEFAULT_FILTERS }, mapCenter: [43.6532, -79.3832] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show the radius slider or a resolved location before any search', () => {
    render(<LocationRadiusSearch />);
    expect(screen.queryByText(/radius/i)).not.toBeInTheDocument();
  });

  it('does not fire a suggestions request for a query shorter than 2 characters', async () => {
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'a' } });
      vi.advanceTimersByTime(400);
    });

    expect(geocodeSuggestionsMock).not.toHaveBeenCalled();
  });

  it('debounces the suggestions request, firing once after typing settles', async () => {
    geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'T' } });
      fireEvent.change(input, { target: { value: 'To' } });
      fireEvent.change(input, { target: { value: 'Told' } });
      vi.advanceTimersByTime(400);
    });

    expect(geocodeSuggestionsMock).toHaveBeenCalledTimes(1);
    expect(geocodeSuggestionsMock).toHaveBeenCalledWith('Told');
  });

  it('resolves a real-world POI (Toldo Lancer Centre) and lists it as a selectable suggestion', async () => {
    geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
      vi.advanceTimersByTime(400);
    });

    expect(await screen.findByText('Toldo Lancer Centre, Windsor, Ontario')).toBeInTheDocument();
  });

  it('selecting a suggestion sets filters.lat/lng/radiusKm, mapCenter, and the resolved label', async () => {
    geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
      vi.advanceTimersByTime(400);
    });
    const option = await screen.findByText('Toldo Lancer Centre, Windsor, Ontario');
    fireEvent.mouseDown(option);

    expect(useFilterStore.getState().filters.lat).toBe(42.30569);
    expect(useFilterStore.getState().filters.lng).toBe(-83.06437);
    expect(useFilterStore.getState().filters.radiusKm).toBe(5);
    expect(useFilterStore.getState().mapCenter).toEqual([42.30569, -83.06437]);
    expect(screen.getByText('Toldo Lancer Centre, Windsor, Ontario', { exact: false })).toBeInTheDocument();
  });

  it('shows an ambiguous query\'s multiple candidates, each independently selectable', async () => {
    const candidates = [
      { label: 'Main Street, Toronto, Ontario', lat: 43.65, lng: -79.38 },
      { label: 'Main Street, Ottawa, Ontario', lat: 45.42, lng: -75.7 },
    ];
    geocodeSuggestionsMock.mockResolvedValue({ data: candidates });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Main Street' } });
      vi.advanceTimersByTime(400);
    });

    expect(await screen.findByText('Main Street, Toronto, Ontario')).toBeInTheDocument();
    expect(screen.getByText('Main Street, Ottawa, Ontario')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('Main Street, Ottawa, Ontario'));
    expect(useFilterStore.getState().filters.lat).toBe(45.42);
    expect(useFilterStore.getState().filters.lng).toBe(-75.7);
  });

  it('shows a "no matching places" row for a genuine no-result search, and sets no filters', async () => {
    geocodeSuggestionsMock.mockResolvedValue({ data: [] });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Nonexistent Place Xyz' } });
      vi.advanceTimersByTime(400);
    });

    expect(await screen.findByText(/no matching places found/i)).toBeInTheDocument();
    expect(useFilterStore.getState().filters.lat).toBeUndefined();
  });

  it('degrades to the "no results" row (not a disruptive toast) when the suggestions request fails', async () => {
    geocodeSuggestionsMock.mockRejectedValue(new Error('network error'));
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Somewhere' } });
      vi.advanceTimersByTime(400);
    });

    expect(await screen.findByText(/no matching places found/i)).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('supports arrow-key navigation and Enter to select a suggestion', async () => {
    const candidates = [
      { label: 'Main Street, Toronto, Ontario', lat: 43.65, lng: -79.38 },
      { label: 'Main Street, Ottawa, Ontario', lat: 45.42, lng: -75.7 },
    ];
    geocodeSuggestionsMock.mockResolvedValue({ data: candidates });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Main Street' } });
      vi.advanceTimersByTime(400);
    });
    await screen.findByText('Main Street, Toronto, Ontario');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useFilterStore.getState().filters.lat).toBe(45.42);
  });

  it('a superseded (stale) suggestions response is ignored when a newer keystroke\'s response already arrived', async () => {
    let resolveFirst!: (v: any) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    geocodeSuggestionsMock
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({ data: [{ label: 'Second Result', lat: 1, lng: 2 }] });

    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Fir' } });
      vi.advanceTimersByTime(400);
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Firs' } });
      vi.advanceTimersByTime(400);
    });
    await screen.findByText('Second Result');

    // The first (now-stale) request finally resolves -- must not clobber
    // the already-rendered, more recent result.
    await act(async () => {
      resolveFirst({ data: [{ label: 'First (stale) Result', lat: 9, lng: 9 }] });
    });

    expect(screen.getByText('Second Result')).toBeInTheDocument();
    expect(screen.queryByText('First (stale) Result')).not.toBeInTheDocument();
  });

  it('shows the radius slider (1-10km) once a location is set', async () => {
    geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
      vi.advanceTimersByTime(400);
    });
    fireEvent.mouseDown(await screen.findByText('Toldo Lancer Centre, Windsor, Ontario'));

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

  it('re-drawing the radius circle after a radius change is driven by the same filters.radiusKm the slider sets (no separate state)', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257, radiusKm: 3 } }));
    render(<LocationRadiusSearch />);

    expect(screen.getByText('3 km')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '7' } });
    expect(screen.getByText('7 km')).toBeInTheDocument();
  });

  it('"Use my location" sets filters.lat/lng from requestUserLocation, without any geocode call', async () => {
    requestUserLocationMock.mockResolvedValue({ lat: 45.4215, lng: -75.6972, accuracyM: 20 });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LocationRadiusSearch />);

    await user.click(screen.getByRole('button', { name: /use my current location/i }));

    await waitFor(() => expect(useFilterStore.getState().filters.lat).toBe(45.4215));
    expect(geocodeSuggestionsMock).not.toHaveBeenCalled();
  });

  it('shows a destructive toast when "Use my location" fails (e.g. permission denied)', async () => {
    requestUserLocationMock.mockRejectedValue({ reason: 'denied', message: 'Denied.' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LocationRadiusSearch />);

    await user.click(screen.getByRole('button', { name: /use my current location/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Location permission denied',
      variant: 'destructive',
    })));
  });

  it('Clear removes the location filter (and the slider/label) without touching other filters', async () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, keyword: 'basement', lat: 43.773, lng: -79.257 } }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LocationRadiusSearch />);

    await user.click(screen.getByRole('button', { name: /clear/i }));

    expect(useFilterStore.getState().filters.lat).toBeUndefined();
    expect(useFilterStore.getState().filters.lng).toBeUndefined();
    // Unrelated filters (e.g. an active keyword search) survive the clear.
    expect(useFilterStore.getState().filters.keyword).toBe('basement');
    expect(screen.queryByText(/radius/i)).not.toBeInTheDocument();
  });

  it('clearing the search text (X button) resets the query/suggestions without touching an already-selected filter', async () => {
    geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
      vi.advanceTimersByTime(400);
    });
    await screen.findByText('Toldo Lancer Centre, Windsor, Ontario');

    fireEvent.click(screen.getByRole('button', { name: /clear search text/i }));

    expect(input.value).toBe('');
    expect(screen.queryByText('Toldo Lancer Centre, Windsor, Ontario')).not.toBeInTheDocument();
  });

  it('falls back to a generic label when filters.lat/lng were set by something other than this widget (e.g. the City picker)', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.6532, lng: -79.3832 } }));
    render(<LocationRadiusSearch />);

    expect(screen.getByText(/the selected location/i)).toBeInTheDocument();
  });
});
