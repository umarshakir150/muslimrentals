import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

/**
 * Coverage for the small, embedded map preview living directly in Browse's
 * location/radius controls (LocationRadiusSearch.tsx) -- see this
 * component's own doc comment for why it exists. Same fake-leaflet pattern
 * as ConfirmLocationMap.test.tsx/FullMap.searchRadius.test.tsx: leaflet is
 * mocked, so this proves the component wires up the search marker/circle/
 * fit-bounds/listing-preview correctly without a real map or tiles.
 */

function buildFakeLeafletModule() {
  const mapInstance = {
    remove: vi.fn(),
    invalidateSize: vi.fn(),
    setView: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
  };

  const circleInstances: any[] = [];
  function makeCircle(latlng: [number, number], options: any) {
    const c: any = { latlng, options };
    c.addTo = vi.fn(() => c);
    c.getBounds = vi.fn(() => ({ __bounds: true, latlng, radius: options.radius }));
    circleInstances.push(c);
    return c;
  }

  const markerInstances: any[] = [];
  function makeMarker(latlng: [number, number], options: any) {
    const m: any = { latlng, options };
    m.addTo = vi.fn(() => m);
    markerInstances.push(m);
    return m;
  }

  const circleMarkerInstances: any[] = [];
  function makeCircleMarker(latlng: [number, number], options: any) {
    const cm: any = { latlng, options };
    cm.addTo = vi.fn(() => cm);
    circleMarkerInstances.push(cm);
    return cm;
  }

  const layerGroupInstances: any[] = [];
  function makeLayerGroup() {
    const lg: any = { layers: [] as any[] };
    lg.addTo = vi.fn(() => lg);
    layerGroupInstances.push(lg);
    return lg;
  }

  const divIconCalls: any[] = [];
  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn((opts: any) => { divIconCalls.push(opts); return { __divIcon: opts }; }),
    marker: vi.fn(makeMarker),
    circle: vi.fn(makeCircle),
    circleMarker: vi.fn(makeCircleMarker),
    layerGroup: vi.fn(makeLayerGroup),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance, circleInstances, markerInstances, circleMarkerInstances, layerGroupInstances, divIconCalls };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.resetModules();
});

describe('SearchRadiusMiniMap', () => {
  it('shows the default/empty state (no marker, no circle) before a location is selected', async () => {
    const { L, markerInstances, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));

    const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
    render(createElement(SearchRadiusMiniMap, { center: null, radiusKm: null }));
    await flushMicrotasks();

    expect(markerInstances).toHaveLength(0);
    expect(circleInstances).toHaveLength(0);
    expect(screen.getByText(/search a location above to preview it here/i)).toBeInTheDocument();
  });

  it('renders a distinct search-location marker and radius circle once a location is selected', async () => {
    const { L, markerInstances, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));

    const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
    render(createElement(SearchRadiusMiniMap, { center: [43.773, -79.257] as [number, number], radiusKm: 5 }));
    await flushMicrotasks();

    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0].latlng).toEqual([43.773, -79.257]);
    expect(circleInstances).toHaveLength(1);
    expect(circleInstances[0].latlng).toEqual([43.773, -79.257]);
    expect(circleInstances[0].options.radius).toBe(5000);
    expect(screen.queryByText(/search a location above to preview it here/i)).not.toBeInTheDocument();
  });

  it('fits the map to the radius circle bounds once a location is selected', async () => {
    const { L, mapInstance, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));

    const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
    render(createElement(SearchRadiusMiniMap, { center: [43.773, -79.257] as [number, number], radiusKm: 5 }));
    await flushMicrotasks();

    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);
    expect(mapInstance.fitBounds).toHaveBeenCalledWith(circleInstances[0].getBounds(), expect.objectContaining({ padding: expect.any(Array) }));
  });

  it('updates the circle radius immediately when the radiusKm prop changes (slider moved)', async () => {
    const { L, mapInstance, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));

    const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
    const { rerender } = render(createElement(SearchRadiusMiniMap, { center: [43.773, -79.257] as [number, number], radiusKm: 5 }));
    await flushMicrotasks();
    const firstCircle = circleInstances[0];

    rerender(createElement(SearchRadiusMiniMap, { center: [43.773, -79.257] as [number, number], radiusKm: 8 }));
    await flushMicrotasks();

    expect(mapInstance.removeLayer).toHaveBeenCalledWith(firstCircle);
    expect(circleInstances).toHaveLength(2);
    expect(circleInstances[1].options.radius).toBe(8000);
  });

  it('resets to the default empty state when the location is cleared', async () => {
    const { L, mapInstance, markerInstances, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));

    const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
    const { rerender } = render(createElement(SearchRadiusMiniMap, { center: [43.773, -79.257] as [number, number], radiusKm: 5 }));
    await flushMicrotasks();
    const marker = markerInstances[0];
    const circle = circleInstances[0];

    rerender(createElement(SearchRadiusMiniMap, { center: null, radiusKm: null }));
    await flushMicrotasks();

    expect(mapInstance.removeLayer).toHaveBeenCalledWith(marker);
    expect(mapInstance.removeLayer).toHaveBeenCalledWith(circle);
    expect(mapInstance.setView).toHaveBeenCalled();
    expect(await screen.findByText(/search a location above to preview it here/i)).toBeInTheDocument();
  });

  it('re-fits when searching again after a clear (fit guard resets, not fitted only once ever)', async () => {
    const { L, mapInstance } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));

    const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
    const { rerender } = render(createElement(SearchRadiusMiniMap, { center: [43.773, -79.257] as [number, number], radiusKm: 5 }));
    await flushMicrotasks();
    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);

    rerender(createElement(SearchRadiusMiniMap, { center: null, radiusKm: null }));
    await flushMicrotasks();

    rerender(createElement(SearchRadiusMiniMap, { center: [43.773, -79.257] as [number, number], radiusKm: 5 }));
    await flushMicrotasks();

    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(2);
  });

  describe('optional listing preview dots', () => {
    it('draws a small dot per listing when a location is active and the count is small', async () => {
      const { L, circleMarkerInstances, layerGroupInstances } = buildFakeLeafletModule();
      vi.doMock('leaflet', () => Promise.resolve({ default: L }));

      const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
      render(createElement(SearchRadiusMiniMap, {
        center: [43.773, -79.257] as [number, number],
        radiusKm: 5,
        listings: [
          { id: 'a', lat: 43.77, lng: -79.25 },
          { id: 'b', lat: 43.78, lng: -79.26 },
        ],
      }));
      await flushMicrotasks();

      expect(circleMarkerInstances).toHaveLength(2);
      expect(layerGroupInstances).toHaveLength(1);
    });

    it('draws nothing for listings when no location is active yet', async () => {
      const { L, circleMarkerInstances } = buildFakeLeafletModule();
      vi.doMock('leaflet', () => Promise.resolve({ default: L }));

      const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
      render(createElement(SearchRadiusMiniMap, {
        center: null,
        radiusKm: null,
        listings: [{ id: 'a', lat: 43.77, lng: -79.25 }],
      }));
      await flushMicrotasks();

      expect(circleMarkerInstances).toHaveLength(0);
    });

    it('skips drawing listing dots entirely when there are too many to preview cleanly', async () => {
      const { L, circleMarkerInstances } = buildFakeLeafletModule();
      vi.doMock('leaflet', () => Promise.resolve({ default: L }));

      const many = Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, lat: 43.7 + i * 0.001, lng: -79.3 }));

      const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
      render(createElement(SearchRadiusMiniMap, { center: [43.773, -79.257] as [number, number], radiusKm: 5, listings: many }));
      await flushMicrotasks();

      expect(circleMarkerInstances).toHaveLength(0);
    });
  });

  it('is accessible: labeled as a map preview, distinctly for the empty vs. active state', async () => {
    const { L } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));

    const { default: SearchRadiusMiniMap } = await import('./SearchRadiusMiniMap');
    render(createElement(SearchRadiusMiniMap, { center: null, radiusKm: null }));
    await flushMicrotasks();

    expect(screen.getByRole('img', { name: /no location searched yet/i })).toBeInTheDocument();
  });
});
