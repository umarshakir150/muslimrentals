import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';

/**
 * Coverage for the renter-facing "search a location + radius" filter's map
 * visualization: a distinct, subtly-styled circle showing the searched
 * area (see mapMarkers.ts's SEARCH_RADIUS_CIRCLE_STYLE), independent of
 * and never confusable with a listing's own approximate-location privacy
 * circle (FullMap.approxZone.test.tsx). Purely a display concern -- the
 * actual filtering happens server-side (GET /listings) against each
 * listing's public approximate point.
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
  };

  const circleInstances: any[] = [];
  function makeCircle(latlng: [number, number], options: any) {
    const c: any = { latlng, options };
    c.addTo = vi.fn(() => c);
    circleInstances.push(c);
    return c;
  }

  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => ({ bindPopup: vi.fn(), addTo: vi.fn(), on: vi.fn() })),
    circle: vi.fn(makeCircle),
    markerClusterGroup: vi.fn(() => ({ addLayer: vi.fn(), clearLayers: vi.fn() })),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance, circleInstances };
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
