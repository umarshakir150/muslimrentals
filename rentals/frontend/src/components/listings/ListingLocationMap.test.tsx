import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import type { Listing } from '@/types';

/**
 * Coverage for the compact single-listing map embedded in ListingDetail
 * (renter discovery UX milestone): proves it reuses the exact same
 * marker/privacy-circle/tooltip primitives as the main map (mapMarkers.ts),
 * never requests/derives a coordinate beyond what's already on the
 * `listing` prop, and gates the privacy-zone treatment on
 * `locationApproximate` exactly like FullMap does for owner/staff.
 */

function buildFakeLeafletModule() {
  const mapInstance = {
    remove: vi.fn(),
    invalidateSize: vi.fn(),
  };

  const circleInstances: any[] = [];
  function makeCircle(latlng: [number, number], options: any) {
    const c: any = { latlng, options };
    c.addTo = vi.fn(() => c);
    c.bindTooltip = vi.fn((html: string, tooltipOptions: any) => {
      c.tooltipHtml = html;
      c.tooltipOptions = tooltipOptions;
      return c;
    });
    c.openTooltip = vi.fn(() => c);
    circleInstances.push(c);
    return c;
  }

  const markerInstances: any[] = [];

  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn((opts: any) => ({ html: opts.html })),
    marker: vi.fn((latlng: [number, number], opts: any) => {
      const m: any = { latlng, opts, addTo: vi.fn(() => m) };
      markerInstances.push(m);
      return m;
    }),
    circle: vi.fn(makeCircle),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance, markerInstances, circleInstances };
}

function baseListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    title: 'Cozy 2BR',
    description: '',
    price: 1500,
    currency: 'CAD',
    bedrooms: 2,
    bathrooms: 1,
    audience: 'ANYONE',
    city: 'Toronto',
    town: '',
    province: 'ON',
    neighbourhood: 'Downtown',
    address: null,
    lat: 43.6488,
    lng: -79.3817,
    contactInfo: null,
    status: 'ACTIVE',
    isActive: true,
    isFeatured: false,
    viewCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    images: [],
    amenities: [],
    user: { id: 'owner-1', name: 'Owner', avatarUrl: null },
    ...overrides,
  } as unknown as Listing;
}

async function renderMap(listing: Listing) {
  const fake = buildFakeLeafletModule();
  vi.doMock('leaflet', () => Promise.resolve({ default: fake.L }));

  const { default: ListingLocationMap } = await import('./ListingLocationMap');
  const utils = render(createElement(ListingLocationMap, { listing }));
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return { ...utils, ...fake };
}

beforeEach(() => {
  vi.resetModules();
});

describe('ListingLocationMap', () => {
  it('draws exactly one marker, at the coordinates already on the listing prop', async () => {
    const listing = baseListing({ locationApproximate: true, locationPrecisionRadiusM: 200 } as any);
    const { markerInstances, L } = await renderMap(listing);

    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0].latlng).toEqual([listing.lat, listing.lng]);
    expect(L.marker).toHaveBeenCalledTimes(1);
  });

  it('draws the labeled privacy circle when the listing is flagged approximate, matching the main map treatment', async () => {
    const listing = baseListing({ locationApproximate: true, locationPrecisionRadiusM: 200 } as any);
    const { circleInstances } = await renderMap(listing);

    expect(circleInstances).toHaveLength(1);
    const circle = circleInstances[0];
    expect(circle.latlng).toEqual([listing.lat, listing.lng]);
    expect(circle.options.radius).toBe(200);
    expect(circle.tooltipOptions.permanent).toBe(true);
    expect(circle.tooltipHtml).toContain('Approximate location');
    expect(circle.tooltipHtml).toContain('Exact address hidden for privacy');
    expect(circle.openTooltip).toHaveBeenCalledTimes(1);
  });

  it('draws no privacy circle at all for an owner/staff view (no locationApproximate flag)', async () => {
    const listing = baseListing(); // locationApproximate left unset, as the owner/staff response shape does
    const { circleInstances, L } = await renderMap(listing);

    expect(circleInstances).toHaveLength(0);
    expect(L.circle).not.toHaveBeenCalled();
  });

  it('never derives or requests a coordinate beyond the listing prop -- marker and circle share the exact same point', async () => {
    const listing = baseListing({ lat: 45.4215, lng: -75.6972, locationApproximate: true, locationPrecisionRadiusM: 200 } as any);
    const { markerInstances, circleInstances } = await renderMap(listing);

    expect(markerInstances[0].latlng).toEqual([45.4215, -75.6972]);
    expect(circleInstances[0].latlng).toEqual([45.4215, -75.6972]);
  });

  it('renders nothing (no map at all) when the listing somehow has no coordinates', async () => {
    const listing = baseListing({ lat: undefined, lng: undefined } as any);
    const { L, container } = await renderMap(listing);

    expect(L.map).not.toHaveBeenCalled();
    expect(container.querySelector('.leaflet-container')).toBeNull();
  });

  it('tears down the map on unmount', async () => {
    const listing = baseListing();
    const { mapInstance, unmount } = await renderMap(listing);

    unmount();

    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
  });
});
