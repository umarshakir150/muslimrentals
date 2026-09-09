import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LocationRadiusSearch from './LocationRadiusSearch';
import { useFilterStore } from '@/store/filterStore';

const { geocodeSuggestionsMock, geocodeResolveMock } = vi.hoisted(() => ({
  geocodeSuggestionsMock: vi.fn(),
  geocodeResolveMock: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  geocodeApi: { suggestions: geocodeSuggestionsMock, resolve: geocodeResolveMock },
}));

const { requestUserLocationMock } = vi.hoisted(() => ({ requestUserLocationMock: vi.fn() }));
vi.mock('@/lib/geolocation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/geolocation')>();
  return { ...actual, requestUserLocation: requestUserLocationMock };
});

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

// SearchRadiusMiniMap has its own full Leaflet-mocked test coverage
// (SearchRadiusMiniMap.test.tsx) -- stubbed here so these tests stay
// focused on LocationRadiusSearch's own behavior (search/select/clear/
// slider) and never need real Leaflet in this file. This stub also lets
// these tests assert the WIRING (does the mini-map receive the right
// center/radius/listings) without re-testing the map's internals.
vi.mock('./SearchRadiusMiniMap', () => ({
  default: (props: { center: [number, number] | null; radiusKm: number | null; listings?: { id: string }[] }) => (
    <div
      data-testid="mini-map-stub"
      data-center={JSON.stringify(props.center)}
      data-radius={props.radiusKm ?? ''}
      data-listings-count={props.listings?.length ?? 0}
    />
  ),
}));

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
    geocodeResolveMock.mockReset();
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

  it('a stale in-flight response arriving after the query was cleared entirely is discarded, not shown', async () => {
    let resolveSearch!: (v: any) => void;
    geocodeSuggestionsMock.mockImplementationOnce(() => new Promise((resolve) => { resolveSearch = resolve; }));
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
      vi.advanceTimersByTime(400);
    });
    // Clear back below the minimum query length while the request is still in flight.
    await act(async () => {
      fireEvent.change(input, { target: { value: 'T' } });
      vi.advanceTimersByTime(400);
    });

    await act(async () => {
      resolveSearch({ data: [{ label: 'Should Not Appear', lat: 1, lng: 2 }] });
    });

    expect(screen.queryByText('Should Not Appear')).not.toBeInTheDocument();
  });

  it('shows up to 8 suggestions when the backend supplies that many, for a broad partial query', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ label: `Place ${i}, Anytown, Ontario`, lat: 43 + i, lng: -79 - i }));
    geocodeSuggestionsMock.mockResolvedValue({ data: eight });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Pla' } });
      vi.advanceTimersByTime(400);
    });

    for (const s of eight) {
      expect(await screen.findByText(s.label)).toBeInTheDocument();
    }
  });

  describe('per-query suggestion cache', () => {
    it('does not re-fetch when the exact same query text is searched again', async () => {
      geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });
      await screen.findByText('Toldo Lancer Centre, Windsor, Ontario');
      expect(geocodeSuggestionsMock).toHaveBeenCalledTimes(1);

      // Clear the text, then retype the EXACT same query.
      await act(async () => {
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });

      expect(await screen.findByText('Toldo Lancer Centre, Windsor, Ontario')).toBeInTheDocument();
      expect(geocodeSuggestionsMock).toHaveBeenCalledTimes(1);
    });

    it('cache lookups are case/whitespace-insensitive (same query, different casing, no re-fetch)', async () => {
      geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'toldo lancer centre' } });
        vi.advanceTimersByTime(400);
      });
      await screen.findByText('Toldo Lancer Centre, Windsor, Ontario');
      expect(geocodeSuggestionsMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.change(input, { target: { value: '  Toldo Lancer Centre  ' } });
        vi.advanceTimersByTime(400);
      });

      expect(geocodeSuggestionsMock).toHaveBeenCalledTimes(1);
    });

    it('still fetches fresh for a genuinely different query text (cache is not a blanket suppressor)', async () => {
      geocodeSuggestionsMock
        .mockResolvedValueOnce({ data: [TOLDO_LANCER_CENTRE] })
        .mockResolvedValueOnce({ data: [{ label: 'Different Place, Ontario', lat: 5, lng: 6 }] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });
      await screen.findByText('Toldo Lancer Centre, Windsor, Ontario');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Something Else Entirely' } });
        vi.advanceTimersByTime(400);
      });

      expect(await screen.findByText('Different Place, Ontario')).toBeInTheDocument();
      expect(geocodeSuggestionsMock).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failed/rate-limited lookup -- retyping the same text retries the network', async () => {
      geocodeSuggestionsMock
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce({ data: [TOLDO_LANCER_CENTRE] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });
      await screen.findByText(/no matching places found/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });

      expect(await screen.findByText('Toldo Lancer Centre, Windsor, Ontario')).toBeInTheDocument();
      expect(geocodeSuggestionsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the radius slider (0.5-10km) once a location is set', async () => {
    geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
    render(<LocationRadiusSearch />);
    const input = screen.getByLabelText('Search a location');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
      vi.advanceTimersByTime(400);
    });
    fireEvent.mouseDown(await screen.findByText('Toldo Lancer Centre, Windsor, Ontario'));

    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('0.5');
    expect(slider.max).toBe('10');
    expect(slider.step).toBe('0.5');
  });

  it('allows moving the radius slider down to the 0.5km minimum', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257 } }));
    render(<LocationRadiusSearch />);

    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } });

    expect(useFilterStore.getState().filters.radiusKm).toBe(0.5);
    // "0.5 km" legitimately appears twice once the value is at the floor:
    // once as the current-value display, once as the slider's own min-bound
    // label -- both correct now that they coincide.
    expect(screen.getAllByText('0.5 km').length).toBeGreaterThan(0);
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

  describe('embedded mini-map preview (hidden until a location resolves)', () => {
    it('does not render the mini-map before any location has been searched -- showing an empty map upfront felt redundant', () => {
      render(<LocationRadiusSearch />);

      expect(screen.queryByTestId('mini-map-stub')).not.toBeInTheDocument();
    });

    it('does not render the mini-map while the user is still typing/has an open suggestions dropdown, only once one is actually selected', async () => {
      geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });
      await screen.findByText('Toldo Lancer Centre, Windsor, Ontario'); // dropdown open, nothing selected yet

      expect(screen.queryByTestId('mini-map-stub')).not.toBeInTheDocument();
    });

    it('appears with the resolved location and radius once a suggestion is selected', async () => {
      geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });
      fireEvent.mouseDown(await screen.findByText('Toldo Lancer Centre, Windsor, Ontario'));

      const stub = screen.getByTestId('mini-map-stub');
      expect(JSON.parse(stub.dataset.center!)).toEqual([42.30569, -83.06437]);
      expect(stub.dataset.radius).toBe('5');
    });

    it('appears once a location is already active on mount too (e.g. set by the City picker elsewhere)', () => {
      useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257 } }));
      render(<LocationRadiusSearch />);

      expect(screen.getByTestId('mini-map-stub')).toBeInTheDocument();
    });

    it('updates the mini-map radius immediately when the slider changes, while it stays visible', () => {
      useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257, radiusKm: 5 } }));
      render(<LocationRadiusSearch />);

      fireEvent.change(screen.getByRole('slider'), { target: { value: '8' } });

      const stub = screen.getByTestId('mini-map-stub');
      expect(stub).toBeInTheDocument();
      expect(stub.dataset.radius).toBe('8');
    });

    it('updates to the new location when the search is replaced with a different place', async () => {
      useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257 } }));
      geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });
      fireEvent.mouseDown(await screen.findByText('Toldo Lancer Centre, Windsor, Ontario'));

      const stub = screen.getByTestId('mini-map-stub');
      expect(JSON.parse(stub.dataset.center!)).toEqual([42.30569, -83.06437]);
    });

    it('hides again and returns the controls to their initial compact layout when Clear is pressed', () => {
      useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257 } }));
      const { container } = render(<LocationRadiusSearch />);
      expect(screen.getByTestId('mini-map-stub')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /clear/i }));

      expect(screen.queryByTestId('mini-map-stub')).not.toBeInTheDocument();
      // The 2-column grid only exists to host the mini-map beside the
      // controls -- once it's gone, the wrapper should no longer carry that
      // layout class either (back to the plain, compact single-column form).
      expect(container.querySelector('.lg\\:grid-cols-2')).toBeNull();
    });

    it('passes optional listings through to the mini-map for its preview dots', () => {
      useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257 } }));
      const listings = [{ id: 'a', lat: 1, lng: 2 }, { id: 'b', lat: 3, lng: 4 }];
      render(<LocationRadiusSearch listings={listings} />);

      expect(screen.getByTestId('mini-map-stub').dataset.listingsCount).toBe('2');
    });

    it('lays out controls and the mini-map as a 2-column grid at the lg breakpoint once visible (stacked below the controls on mobile)', () => {
      useFilterStore.setState((s) => ({ filters: { ...s.filters, lat: 43.773, lng: -79.257 } }));
      const { container } = render(<LocationRadiusSearch />);

      // Tailwind's `lg:grid-cols-2` is what turns the mobile "map stacked
      // under the controls" DOM order into a "map beside the controls"
      // desktop layout -- this asserts the responsive class is actually
      // applied, not just that a map exists somewhere in the tree.
      expect(container.querySelector('.lg\\:grid-cols-2')).not.toBeNull();
    });
  });

  // Autocomplete suggestions are assistance, never a required gate: the
  // renter can always finish typing and press Enter/click Search to
  // resolve their COMPLETE typed text directly, regardless of what the
  // dropdown does or doesn't show. This is a distinct code path
  // (GET /geocode/resolve, via geocodeApi.resolve) from the suggestions
  // dropdown above -- never simply "select suggestions[0]".
  describe('manual Enter/Search direct-search path (autocomplete is assistance, not a gate)', () => {
    it('pressing Enter with no suggestions loaded resolves the complete typed text directly', async () => {
      geocodeSuggestionsMock.mockResolvedValue({ data: [] });
      geocodeResolveMock.mockResolvedValue({ data: { lat: 42.31, lng: -83.02 } });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Vincent Massey Secondary School' } });
        vi.advanceTimersByTime(400);
      });
      await screen.findByText(/no matching places found/i);

      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(geocodeResolveMock).toHaveBeenCalledWith('Vincent Massey Secondary School'));

      await waitFor(() => expect(useFilterStore.getState().filters.lat).toBe(42.31));
      expect(useFilterStore.getState().filters.lng).toBe(-83.02);
    });

    it('pressing Enter while irrelevant suggestions are visible (none explicitly highlighted) resolves the full typed text, never the top suggestion', async () => {
      geocodeSuggestionsMock.mockResolvedValue({ data: [{ label: 'Irrelevant Result', lat: 99, lng: 99 }] });
      geocodeResolveMock.mockResolvedValue({ data: { lat: 1, lng: 2 } });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Vincent Massey' } });
        vi.advanceTimersByTime(400);
      });
      await screen.findByText('Irrelevant Result'); // dropdown open, nothing highlighted

      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(geocodeResolveMock).toHaveBeenCalledWith('Vincent Massey'));

      await waitFor(() => expect(useFilterStore.getState().filters.lat).toBe(1));
      expect(useFilterStore.getState().filters.lng).toBe(2);
    });

    it('arrow-key-highlighting a suggestion then pressing Enter still selects it directly, without calling resolve', async () => {
      geocodeSuggestionsMock.mockResolvedValue({ data: [TOLDO_LANCER_CENTRE] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Toldo Lancer Centre' } });
        vi.advanceTimersByTime(400);
      });
      await screen.findByText('Toldo Lancer Centre, Windsor, Ontario');

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(useFilterStore.getState().filters.lat).toBe(42.30569);
      expect(geocodeResolveMock).not.toHaveBeenCalled();
    });

    it('clicking the visible Search button performs the same direct search as pressing Enter', async () => {
      geocodeSuggestionsMock.mockResolvedValue({ data: [] });
      geocodeResolveMock.mockResolvedValue({ data: { lat: 42.31, lng: -83.02 } });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Vincent Massey' } });
        vi.advanceTimersByTime(400);
      });

      await user.click(screen.getByRole('button', { name: /search this location/i }));

      await waitFor(() => expect(geocodeResolveMock).toHaveBeenCalledWith('Vincent Massey'));
      await waitFor(() => expect(useFilterStore.getState().filters.lat).toBe(42.31));
    });

    it('a successful direct search shows the mini-map, same as selecting a suggestion would', async () => {
      geocodeResolveMock.mockResolvedValue({ data: { lat: 42.31, lng: -83.02 } });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      fireEvent.change(input, { target: { value: 'Vincent Massey Secondary School' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(screen.getByTestId('mini-map-stub')).toBeInTheDocument());
      const stub = screen.getByTestId('mini-map-stub');
      expect(JSON.parse(stub.dataset.center!)).toEqual([42.31, -83.02]);
    });

    it('shows an "Approximate location" note for a range-interpolated address resolve, without rejecting the address', async () => {
      geocodeResolveMock.mockResolvedValue({ data: { lat: 42.29, lng: -83.05, precision: 'approximate', accuracyType: 'range_interpolation' } });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      fireEvent.change(input, { target: { value: '732 Mill St' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(useFilterStore.getState().filters.lat).toBe(42.29));
      expect(screen.getByText(/approximate location/i)).toBeInTheDocument();
    });

    it('does not show the "Approximate location" note for an exact (rooftop) address resolve', async () => {
      geocodeResolveMock.mockResolvedValue({ data: { lat: 42.31, lng: -83.02, precision: 'exact', accuracyType: 'rooftop' } });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      fireEvent.change(input, { target: { value: '1051 Cedarglen Gate' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(useFilterStore.getState().filters.lat).toBe(42.31));
      expect(screen.queryByText(/approximate location/i)).not.toBeInTheDocument();
    });

    it('an unresolved search shows a clear "not found" message and leaves the typed text intact so the renter can edit it', async () => {
      const notFound = Object.assign(new Error('Could not find that location.'), { status: 404 });
      geocodeResolveMock.mockRejectedValue(notFound);
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'Somewhere Unresolvable' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(await screen.findByText(/location not found/i)).toBeInTheDocument();
      expect(input.value).toBe('Somewhere Unresolvable');
      expect(useFilterStore.getState().filters.lat).toBeUndefined();
    });

    it('a generic/transient failure (not a 404) shows a destructive toast, not the persistent "not found" message, and also keeps the typed text', async () => {
      geocodeResolveMock.mockRejectedValue(new Error('Service temporarily unavailable.'));
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'Vincent Massey' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
      expect(screen.queryByText(/location not found/i)).not.toBeInTheDocument();
      expect(input.value).toBe('Vincent Massey');
    });

    it('typing again after a "not found" result clears the message', async () => {
      const notFound = Object.assign(new Error('Could not find that location.'), { status: 404 });
      geocodeResolveMock.mockRejectedValue(notFound);
      geocodeSuggestionsMock.mockResolvedValue({ data: [] });
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      fireEvent.change(input, { target: { value: 'Somewhere Unresolvable' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await screen.findByText(/location not found/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'Somewhere Unresolvable Refined' } });
        vi.advanceTimersByTime(400);
      });

      expect(screen.queryByText(/location not found/i)).not.toBeInTheDocument();
    });

    it('pressing Enter with an empty query does nothing (no request, no crash)', async () => {
      render(<LocationRadiusSearch />);
      const input = screen.getByLabelText('Search a location');

      fireEvent.keyDown(input, { key: 'Enter' });

      expect(geocodeResolveMock).not.toHaveBeenCalled();
    });

    // Canada-only enforcement for a direct search is a backend guarantee
    // (see resolvePlace()/searchPlaces()'s own tests in
    // tests/utils/geocode.test.ts) -- the frontend has no independent
    // country logic of its own, it simply uses whatever GET /geocode/resolve
    // returns (or its 404), so there is nothing distinct to test here beyond
    // the success/not-found paths already covered above.
  });
});
