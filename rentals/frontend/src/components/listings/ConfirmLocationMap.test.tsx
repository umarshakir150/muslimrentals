import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';

/**
 * Coverage for the landlord-confirmed-pin map (the "we found the street,
 * not the building" flow -- see routes/listings.ts's
 * resolveGeocodedLocation / `confidence: 'street'`). Same fake-leaflet
 * pattern as ListingLocationMap.test.tsx: leaflet is mocked, so this proves
 * the component wires up Leaflet correctly (draggable marker, centered on
 * the geocoder's matched point, reports drags via onChange) without a real
 * map/tiles.
 */

function buildFakeLeafletModule() {
  const mapInstance = { remove: vi.fn(), invalidateSize: vi.fn() };
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
});
