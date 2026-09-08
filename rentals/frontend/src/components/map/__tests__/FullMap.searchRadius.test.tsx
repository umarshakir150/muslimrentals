import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';

/**
 * Coverage for the renter-facing "search a location + radius" filter's map
 * visualization: a distinct, subtly-styled circle showing the searched
 * area (see mapMarkers.ts's SEARCH_RADIUS_CIRCLE_STYLE), a distinct marker
 * pinning the searched point itself (buildSearchLocationMarkerHtml), and
 * fitting the map to that circle's bounds so the point/radius/listings can
 * be understood without excessive manual zooming. Independent of and never
 * confusable with a listing's own approximate-location privacy circle
 * (FullMap.approxZone.test.tsx) or the "you are here" marker (
 * FullMap.locateMe.test.tsx). Purely a display concern -- the actual
 * filtering happens server-side (GET /listings) against each listing's
 * public approximate point.
 */

function buildFakeLeafletModule() {
  const mapInstance = {
    remove: vi.fn(),
    on: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    invalidateSize: vi.fn(),
    setView: vi.fn(),
    getZoom: vi.fn(() => 10),
    getCenter: vi.fn(() => ({ lat: 43.65, lng: -79.38 })),
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
    m.bindPopup = vi.fn(() => m);
    m.addTo = vi.fn(() => m);
    m.on = vi.fn(() => m);
    markerInstances.push(m);
    return m;
  }

  const divIconCalls: any[] = [];
  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn((opts: any) => { divIconCalls.push(opts); return { __divIcon: opts }; }),
    marker: vi.fn(makeMarker),
    circle: vi.fn(makeCircle),
    markerClusterGroup: vi.fn(() => ({ addLayer: vi.fn(), clearLayers: vi.fn() })),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance, circleInstances, markerInstances, divIconCalls };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.resetModules();
  delete (window as any).__mapListingClick;
});

describe('FullMap search-radius circle', () => {
  it('draws no circle at all when no location search is active', async () => {
    const { L } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
    }));
    await flushMicrotasks();

    expect(L.circle).not.toHaveBeenCalled();
  });

  it('draws a circle at the search center with radius in meters (radiusKm * 1000)', async () => {
    const { L, mapInstance, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();

    expect(circleInstances).toHaveLength(1);
    expect(circleInstances[0].latlng).toEqual([43.773, -79.257]);
    expect(circleInstances[0].options.radius).toBe(5000);
    expect(mapInstance.addLayer).toHaveBeenCalled(); // via circle.addTo(map), not the marker cluster path
  });

  it('uses styling distinct from the per-listing approximate-location privacy circle (no dashArray, different color)', async () => {
    const { L, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();

    const options = circleInstances[0].options;
    expect(options.color).not.toBe('#0a5c42'); // the privacy circle's brand-green
    expect(options.dashArray).toBeUndefined(); // privacy circle is dashed; this is solid
  });

  it('removes the previous circle and draws a new one when the search center/radius changes', async () => {
    const { L, mapInstance, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    const { rerender } = render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();
    expect(circleInstances).toHaveLength(1);
    const firstCircle = circleInstances[0];

    rerender(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [45.4215, -75.6972] as [number, number],
      searchRadiusKm: 3,
    }));
    await flushMicrotasks();

    expect(mapInstance.removeLayer).toHaveBeenCalledWith(firstCircle);
    expect(circleInstances).toHaveLength(2);
    expect(circleInstances[1].latlng).toEqual([45.4215, -75.6972]);
    expect(circleInstances[1].options.radius).toBe(3000);
  });

  it('removes the circle entirely when the search is cleared (searchCenter becomes null)', async () => {
    const { L, mapInstance, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    const { rerender } = render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();
    const circle = circleInstances[0];

    rerender(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: null,
      searchRadiusKm: null,
    }));
    await flushMicrotasks();

    expect(mapInstance.removeLayer).toHaveBeenCalledWith(circle);
  });
});

describe('FullMap search-location marker', () => {
  it('draws no search marker at all when no location search is active', async () => {
    const { L } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
    }));
    await flushMicrotasks();

    expect(L.marker).not.toHaveBeenCalled();
  });

  it('draws a distinct search-location marker at the search center, visually unlike a listing marker', async () => {
    const { L, markerInstances, divIconCalls } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();

    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0].latlng).toEqual([43.773, -79.257]);

    const html = divIconCalls[divIconCalls.length - 1].html;
    expect(html).toContain('search-location-marker');
    expect(html).not.toContain('rental-marker');
  });

  it('removes the previous search marker and draws a new one when the search center changes', async () => {
    const { L, mapInstance, markerInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    const { rerender } = render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();
    expect(markerInstances).toHaveLength(1);
    const firstMarker = markerInstances[0];

    rerender(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [45.4215, -75.6972] as [number, number],
      searchRadiusKm: 3,
    }));
    await flushMicrotasks();

    expect(mapInstance.removeLayer).toHaveBeenCalledWith(firstMarker);
    expect(markerInstances).toHaveLength(2);
    expect(markerInstances[1].latlng).toEqual([45.4215, -75.6972]);
  });

  it('removes the search marker entirely when the search is cleared (searchCenter becomes null)', async () => {
    const { L, mapInstance, markerInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    const { rerender } = render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();
    const marker = markerInstances[0];

    rerender(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: null,
      searchRadiusKm: null,
    }));
    await flushMicrotasks();

    expect(mapInstance.removeLayer).toHaveBeenCalledWith(marker);
  });
});

describe('FullMap search fit-to-bounds', () => {
  it('does not call fitBounds when no location search is active', async () => {
    const { L, mapInstance } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
    }));
    await flushMicrotasks();

    expect(mapInstance.fitBounds).not.toHaveBeenCalled();
  });

  it('fits the map to the search circle bounds once when a new search is set', async () => {
    const { L, mapInstance, circleInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();

    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);
    expect(mapInstance.fitBounds).toHaveBeenCalledWith(
      circleInstances[0].getBounds(),
      expect.objectContaining({ padding: expect.any(Array) })
    );
  });

  it('re-fits when the search center/radius changes to a new value', async () => {
    const { L, mapInstance } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    const { rerender } = render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();
    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);

    rerender(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [45.4215, -75.6972] as [number, number],
      searchRadiusKm: 3,
    }));
    await flushMicrotasks();

    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-fit bounds again on an unrelated re-render with the same search center/radius (e.g. listings updating)', async () => {
    const { L, mapInstance } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    const { rerender } = render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();
    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);

    // Same search center/radius, but listings changed -- a real scenario
    // (a fresh page of results arriving for the same active search) that
    // must not yank the view back to the search bounds every time.
    rerender(createElement(FullMap, {
      listings: [{ id: 'l1', lat: 43.7, lng: -79.3 } as any],
      center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();

    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('resets the fit guard when the search is cleared, so a later new search still triggers a fresh fit', async () => {
    const { L, mapInstance } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    const { rerender } = render(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();
    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(1);

    rerender(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: null,
      searchRadiusKm: null,
    }));
    await flushMicrotasks();

    // Searching the exact same place again should still fit -- a cleared
    // search resets the guard rather than remembering the last fitted key
    // forever.
    rerender(createElement(FullMap, {
      listings: [], center: [43.65, -79.38] as [number, number],
      onCentreChange: vi.fn(), onListingClick: vi.fn(),
      searchCenter: [43.773, -79.257] as [number, number],
      searchRadiusKm: 5,
    }));
    await flushMicrotasks();

    expect(mapInstance.fitBounds).toHaveBeenCalledTimes(2);
  });
});
