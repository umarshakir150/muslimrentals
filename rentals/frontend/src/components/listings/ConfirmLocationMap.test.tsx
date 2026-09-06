import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';

/**
 * Coverage for the landlord-confirmed-pin map (the "we found the street,
 * not the building" flow -- see routes/listings.ts's
 * resolveGeocodedLocation / `confidence: 'street'`). Same fake-leaflet
 * pattern as ListingLocationMap.test.tsx: leaflet is mocked, so this proves
 * the component wires up Leaflet correctly (draggable + clickable marker,
 * centered on the geocoder's matched point, reports drags/clicks/search
 * results via onChange) without a real map/tiles.
 *
 * geocodeApi and useToast are mocked the same way LocationRadiusSearch's
 * own tests mock them (same underlying GET /geocode?q= flow, same toast
 * component) -- this is deliberately not a second geocoding
 * implementation, just a second caller of the existing one.
 */

const { geocodeSearchMock } = vi.hoisted(() => ({ geocodeSearchMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  geocodeApi: { search: geocodeSearchMock },
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

function buildFakeLeafletModule() {
  const mapHandlers: Record<string, Function> = {};
  const mapInstance = {
    remove: vi.fn(),
    invalidateSize: vi.fn(),
    setView: vi.fn(),
    on: vi.fn((event: string, handler: Function) => { mapHandlers[event] = handler; }),
    // Test helper: simulate a click/tap on the map at a given point --
    // Leaflet's own 'click' event fires identically for a mouse click and
    // a touch tap (its default `tap` handling normalizes touch-tap to the
    // same 'click' event), so one helper covers both.
    __simulateClick: (lat: number, lng: number) => {
      mapHandlers['click']?.({ latlng: { lat, lng } });
    },
  };
  const markerInstances: any[] = [];

  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn((opts: any) => ({ html: opts.html })),
    marker: vi.fn((latlng: [number, number], opts: any) => {
      const handlers: Record<string, Function> = {};
      const m: any = {
        latlng,
        opts,
        addTo: vi.fn(() => m),
        on: vi.fn((event: string, handler: Function) => { handlers[event] = handler; }),
        getLatLng: vi.fn(() => ({ lat: m.latlng[0], lng: m.latlng[1] })),
        setLatLng: vi.fn((next: [number, number] | { lat: number; lng: number }) => {
          m.latlng = Array.isArray(next) ? next : [next.lat, next.lng];
        }),
        // Test helper: simulate a drag by moving the marker then firing
        // whatever handler was registered for 'dragend', exactly like a
        // real Leaflet marker would.
        __simulateDrag: (lat: number, lng: number) => {
          m.latlng = [lat, lng];
          handlers['dragend']?.();
        },
      };
      markerInstances.push(m);
      return m;
    }),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance, markerInstances };
}

async function renderMap(props: { initialLat: number; initialLng: number; onChange: (lat: number, lng: number) => void }) {
  const fake = buildFakeLeafletModule();
  vi.doMock('leaflet', () => Promise.resolve({ default: fake.L }));

  const { default: ConfirmLocationMap } = await import('./ConfirmLocationMap');
  const utils = render(createElement(ConfirmLocationMap, props));
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return { ...utils, ...fake };
}

beforeEach(() => {
  vi.resetModules();
  geocodeSearchMock.mockReset();
  toastMock.mockReset();
});

describe('ConfirmLocationMap', () => {
  it('centers the map and marker on the geocoder-matched point', async () => {
    const onChange = vi.fn();
    const { L, markerInstances } = await renderMap({ initialLat: 42.3023085, initialLng: -83.0764497, onChange });

    expect(L.map).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ center: [42.3023085, -83.0764497] }));
    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0].latlng).toEqual([42.3023085, -83.0764497]);
  });

  it('renders exactly one DRAGGABLE marker (the whole point of this map)', async () => {
    const { markerInstances } = await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange: vi.fn() });

    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0].opts.draggable).toBe(true);
  });

  it('reports the marker\'s new position via onChange after a drag', async () => {
    const onChange = vi.fn();
    const { markerInstances } = await renderMap({ initialLat: 42.3023085, initialLng: -83.0764497, onChange });

    markerInstances[0].__simulateDrag(42.3035, -83.0770);

    expect(onChange).toHaveBeenCalledWith(42.3035, -83.0770);
  });

  it('never calls onChange before any drag happens', async () => {
    const onChange = vi.fn();
    await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('tears down the map on unmount', async () => {
    const { mapInstance, unmount } = await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange: vi.fn() });

    unmount();

    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
  });

  describe('click/tap-to-move', () => {
    it('moves the marker and fires onChange when the map is clicked', async () => {
      const onChange = vi.fn();
      const { mapInstance, markerInstances } = await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange });

      mapInstance.__simulateClick(42.31, -83.08);

      expect(markerInstances[0].setLatLng).toHaveBeenCalledWith({ lat: 42.31, lng: -83.08 });
      expect(onChange).toHaveBeenCalledWith(42.31, -83.08);
    });

    it('a click does not disturb dragging -- both keep working, independently, after each other', async () => {
      const onChange = vi.fn();
      const { mapInstance, markerInstances } = await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange });

      mapInstance.__simulateClick(42.31, -83.08);
      markerInstances[0].__simulateDrag(42.32, -83.09);
      mapInstance.__simulateClick(42.33, -83.10);

      expect(onChange).toHaveBeenNthCalledWith(1, 42.31, -83.08);
      expect(onChange).toHaveBeenNthCalledWith(2, 42.32, -83.09);
      expect(onChange).toHaveBeenNthCalledWith(3, 42.33, -83.10);
      expect(onChange).toHaveBeenCalledTimes(3);
    });

    it('the marker stays draggable after a click moves it (click does not replace or reset the marker)', async () => {
      const { mapInstance, markerInstances } = await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange: vi.fn() });

      mapInstance.__simulateClick(42.31, -83.08);

      expect(markerInstances).toHaveLength(1); // same single marker, not a new one
      expect(markerInstances[0].opts.draggable).toBe(true);
    });
  });

  describe('address/location search', () => {
    it('renders a search input and button', async () => {
      await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange: vi.fn() });
      expect(screen.getByPlaceholderText(/search an address or place/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    });

    it('on success: recenters/zooms the map, moves the marker, and calls onChange -- the SAME state drag/click use', async () => {
      geocodeSearchMock.mockResolvedValue({ data: { lat: 43.773, lng: -79.257 } });
      const onChange = vi.fn();
      const user = userEvent.setup();
      const { mapInstance, markerInstances } = await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange });

      await user.type(screen.getByPlaceholderText(/search an address or place/i), 'Scarborough');
      await user.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => expect(onChange).toHaveBeenCalledWith(43.773, -79.257));
      expect(mapInstance.setView).toHaveBeenCalledWith([43.773, -79.257], 17);
      expect(markerInstances[0].setLatLng).toHaveBeenCalledWith([43.773, -79.257]);
      expect(geocodeSearchMock).toHaveBeenCalledWith('Scarborough');
    });

    it('a search result never calls any confirm-type action -- onChange is the only thing it calls (moving the candidate pin, not confirming it)', async () => {
      geocodeSearchMock.mockResolvedValue({ data: { lat: 43.773, lng: -79.257 } });
      const onChange = vi.fn();
      const user = userEvent.setup();
      await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange });

      await user.type(screen.getByPlaceholderText(/search an address or place/i), 'Scarborough');
      await user.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      // This component exposes no confirm/submit prop or callback at all --
      // the only observable effect of a successful search is the same
      // onChange drag/click already use. Confirming is the parent modal's
      // own separate, explicit button, entirely outside this component.
    });

    it('on failure: shows a destructive toast and never calls onChange or moves the marker', async () => {
      geocodeSearchMock.mockRejectedValue(new Error('not found'));
      const onChange = vi.fn();
      const user = userEvent.setup();
      const { markerInstances } = await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange });

      await user.type(screen.getByPlaceholderText(/search an address or place/i), 'Nonexistent Place');
      await user.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
      expect(onChange).not.toHaveBeenCalled();
      expect(markerInstances[0].setLatLng).not.toHaveBeenCalled();
    });

    it('does not search on an empty/whitespace-only query', async () => {
      const user = userEvent.setup();
      await renderMap({ initialLat: 42.3, initialLng: -83.07, onChange: vi.fn() });

      await user.type(screen.getByPlaceholderText(/search an address or place/i), '   ');
      const searchButton = screen.getByRole('button', { name: 'Search' });
      expect(searchButton).toBeDisabled();
    });
  });
});
