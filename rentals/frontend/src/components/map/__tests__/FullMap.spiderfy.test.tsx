import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import type { Listing } from '@/types';

/**
 * Regression coverage for the "Spiderfy overlapping markers" milestone.
 *
 * Real leaflet.markercluster spiderfy behavior (fanning out overlapping
 * markers on click, un-fanning on zoom/collapse) lives entirely inside the
 * mocked-out third-party library and can't be exercised in jsdom -- that
 * part is the library's own well-tested responsibility. What FullMap itself
 * is responsible for, and what regressed before (disableClusteringAtZoom:
 * 14 killed clustering -- and therefore spiderfy -- above that zoom), is:
 *
 *   1. every listing marker, however close its coordinates, is added to the
 *      SAME markerClusterGroup instance (never bypassed straight onto the
 *      map) -- that's what makes clustering/spiderfy possible at all;
 *   2. the cluster group is built with the options that keep spiderfy
 *      active at every zoom (spiderfyOnMaxZoom: true, no
 *      disableClusteringAtZoom pin);
 *   3. this holds even for the "dense downtown" case the privacy model now
 *      makes routine: several distinct listings whose PUBLIC (approximate)
 *      coordinates are identical or a few meters apart, because they share
 *      a privacy zone.
 *
 * This mirrors the established buildFakeLeafletModule() mocking pattern
 * from mapCleanup.test.tsx / FullMap.locateMe.test.tsx.
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
    getZoom: vi.fn(() => 16),
    getCenter: vi.fn(() => ({ lat: 43.65, lng: -79.38 })),
  };

  const markerInstances: any[] = [];
  const clusterGroupInstance = { addLayer: vi.fn(), clearLayers: vi.fn() };

  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn((latlng: [number, number]) => {
      const m = { bindPopup: vi.fn(), addTo: vi.fn(), on: vi.fn(), latlng };
      markerInstances.push(m);
      return m;
    }),
    circle: vi.fn(() => ({ addTo: vi.fn() })),
    markerClusterGroup: vi.fn(() => clusterGroupInstance),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance, markerInstances, clusterGroupInstance };
}

// Several distinct downtown listings that, under the ~250m privacy radius,
// legitimately land on the exact same or near-identical public coordinate.
const DENSE_DOWNTOWN_LISTINGS: Listing[] = Array.from({ length: 5 }, (_, i) => ({
  id: `listing-${i}`,
  title: `Downtown unit ${i}`,
  description: '',
  price: 1500 + i * 50,
  currency: 'CAD',
  bedrooms: 1,
  bathrooms: 1,
  audience: 'ANYONE',
  city: 'Toronto',
  town: '',
  province: 'ON',
  neighbourhood: 'Financial District',
  address: null,
  // Identical public coordinate for most, one offset by a few meters --
  // both cases must still cluster/spiderfy together, not render as raw
  // overlapping unclustered pins.
  lat: 43.6488 + (i === 4 ? 0.00003 : 0),
  lng: -79.3817 + (i === 4 ? 0.00003 : 0),
  locationApproximate: true,
  locationPrecisionRadiusM: 250,
  contactInfo: null,
  status: 'ACTIVE',
  isActive: true,
  isFeatured: false,
  viewCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  images: [],
  amenities: [],
  user: { id: `owner-${i}`, name: 'Owner', avatarUrl: null },
})) as unknown as Listing[];

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.resetModules();
  delete (window as any).__mapListingClick;
});

describe('FullMap dense-marker clustering/spiderfy wiring', () => {
  it('builds the cluster group with spiderfy kept active at every zoom (no disableClusteringAtZoom pin)', async () => {
    const { L } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(
      createElement(FullMap, {
        listings: DENSE_DOWNTOWN_LISTINGS,
        center: [43.6488, -79.3817] as [number, number],
        onCentreChange: vi.fn(),
        onListingClick: vi.fn(),
      })
    );
    await flushMicrotasks();

    expect(L.markerClusterGroup).toHaveBeenCalledTimes(1);
    const options = L.markerClusterGroup.mock.calls[0][0];
    expect(options.spiderfyOnMaxZoom).toBe(true);
    expect('disableClusteringAtZoom' in options).toBe(false);
  });

  it('adds every listing marker to the SAME cluster group, even when several listings share an identical or near-identical public coordinate', async () => {
    const { L, clusterGroupInstance, markerInstances } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    render(
      createElement(FullMap, {
        listings: DENSE_DOWNTOWN_LISTINGS,
        center: [43.6488, -79.3817] as [number, number],
        onCentreChange: vi.fn(),
        onListingClick: vi.fn(),
      })
    );
    await flushMicrotasks();

    // One marker per listing, all routed through cluster.addLayer -- never
    // added directly to the map, which would bypass clustering/spiderfy
    // entirely and reproduce the original "can't click the one underneath" bug.
    expect(markerInstances).toHaveLength(DENSE_DOWNTOWN_LISTINGS.length);
    expect(clusterGroupInstance.addLayer).toHaveBeenCalledTimes(DENSE_DOWNTOWN_LISTINGS.length);

    // Confirms the overlap is real (not accidentally spread out): four of
    // the five markers share the exact same coordinate pair.
    const coordKey = (m: any) => `${m.latlng[0]},${m.latlng[1]}`;
    const identicalGroup = markerInstances.filter((m) => coordKey(m) === '43.6488,-79.3817');
    expect(identicalGroup.length).toBe(4);
  });

  it('re-renders markers (clearing and re-adding to the same cluster group) when the listings prop changes, keeping the dense set clusterable', async () => {
    const { L, clusterGroupInstance } = buildFakeLeafletModule();
    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');
    const { rerender } = render(
      createElement(FullMap, {
        listings: DENSE_DOWNTOWN_LISTINGS.slice(0, 2),
        center: [43.6488, -79.3817] as [number, number],
        onCentreChange: vi.fn(),
        onListingClick: vi.fn(),
      })
    );
    await flushMicrotasks();
    expect(clusterGroupInstance.addLayer).toHaveBeenCalledTimes(2);

    rerender(
      createElement(FullMap, {
        listings: DENSE_DOWNTOWN_LISTINGS,
        center: [43.6488, -79.3817] as [number, number],
        onCentreChange: vi.fn(),
        onListingClick: vi.fn(),
      })
    );
    await flushMicrotasks();

    expect(clusterGroupInstance.clearLayers).toHaveBeenCalled();
    expect(clusterGroupInstance.addLayer).toHaveBeenCalledTimes(2 + DENSE_DOWNTOWN_LISTINGS.length);
  });
});
