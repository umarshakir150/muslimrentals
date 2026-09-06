import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import type { Listing } from '@/types';

/**
 * Coverage for the founder correction after the first pass of the privacy-
 * location milestone: a dashed circle alone still puts a solid price pill
 * dead center of "the area", which reads as an exact pin with a decorative
 * ring around it rather than "somewhere in this whole zone". The fix binds
 * a permanent, always-visible-while-selected label directly to the privacy
 * circle itself (Leaflet's tooltip API, independent of the marker's own
 * price/photo popup) -- see buildApproxZoneTooltipHtml() in mapMarkers.ts
 * and its use in FullMap.tsx's marker 'popupopen'/'popupclose' handlers.
 *
 * This file proves:
 *   1. selecting a listing (opening its marker's popup) draws the privacy
 *      circle AND labels it, both removed again on deselect;
 *   2. the circle is drawn around the exact same point already on the
 *      marker (listing.lat/lng) -- proving nothing extra/more-precise is
 *      ever pulled from the network just to draw the zone;
 *   3. a listing with no approximate-location flag (owner/staff's own view)
 *      never gets a circle/tooltip at all;
 *   4. several distinct listings sharing an identical public coordinate
 *      (the routine "dense downtown" / spiderfy case) each get their own,
 *      independently correct circle when selected in turn -- no cross-talk
 *      between markers that happen to share a point.
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
  const circleInstances: any[] = [];
  const clusterGroupInstance = { addLayer: vi.fn(), clearLayers: vi.fn() };

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

  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn((latlng: [number, number]) => {
      const handlers: Record<string, () => void> = {};
      const m: any = {
        latlng,
        bindPopup: vi.fn(() => m),
        addTo: vi.fn(() => m),
        on: vi.fn((event: string, cb: () => void) => { handlers[event] = cb; }),
        fireHandler: (event: string) => handlers[event]?.(),
      };
      markerInstances.push(m);
      return m;
    }),
    circle: vi.fn(makeCircle),
    markerClusterGroup: vi.fn(() => clusterGroupInstance),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance, markerInstances, circleInstances, clusterGroupInstance };
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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function renderFullMap(listings: Listing[]) {
  const fake = buildFakeLeafletModule();
  vi.doMock('leaflet', () => Promise.resolve({ default: fake.L }));
  vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

  const { default: FullMap } = await import('../FullMap');
  render(
    createElement(FullMap, {
      listings,
      center: [43.6488, -79.3817] as [number, number],
      onCentreChange: vi.fn(),
      onListingClick: vi.fn(),
    })
  );
  await flushMicrotasks();
  return fake;
}

beforeEach(() => {
  vi.resetModules();
  delete (window as any).__mapListingClick;
});

describe('FullMap approximate-location privacy zone', () => {
  it('draws a labeled privacy circle around the listing when its marker is selected, and removes it on deselect', async () => {
    const listing = baseListing({ locationApproximate: true, locationPrecisionRadiusM: 200 } as any);
    const { markerInstances, circleInstances, mapInstance } = await renderFullMap([listing]);

    expect(circleInstances).toHaveLength(0); // nothing drawn before selection

    markerInstances[0].fireHandler('popupopen');

    expect(circleInstances).toHaveLength(1);
    const circle = circleInstances[0];
    expect(circle.options.radius).toBe(200);
    // Bound with a PERMANENT tooltip -- visible for as long as the zone is
    // shown, not just on hover -- and explicitly opened.
    expect(circle.tooltipOptions.permanent).toBe(true);
    expect(circle.openTooltip).toHaveBeenCalledTimes(1);
    expect(circle.tooltipHtml).toContain('Approximate location');
    expect(circle.tooltipHtml).toContain('Exact address hidden for privacy');

    markerInstances[0].fireHandler('popupclose');
    expect(mapInstance.removeLayer).toHaveBeenCalledWith(circle);
  });

  it('draws the circle with EXACTLY the radius the API sent, never a hardcoded/independent value', async () => {
    // A deliberately non-default number (not 200, the current
    // PRIVACY_RADIUS_METERS) -- if this component ever hardcoded its own
    // radius instead of reading listing.locationPrecisionRadiusM, this test
    // would catch it even though the default-value tests above would not
    // (they'd still pass by coincidence).
    const listing = baseListing({ locationApproximate: true, locationPrecisionRadiusM: 137 } as any);
    const { markerInstances, circleInstances } = await renderFullMap([listing]);

    markerInstances[0].fireHandler('popupopen');

    expect(circleInstances[0].options.radius).toBe(137);
  });

  it('draws the circle around the exact same point already on the marker -- never a separate, more-precise coordinate', async () => {
    const listing = baseListing({ lat: 45.4215, lng: -75.6972, locationApproximate: true, locationPrecisionRadiusM: 200 } as any);
    const { markerInstances, circleInstances } = await renderFullMap([listing]);

    markerInstances[0].fireHandler('popupopen');

    expect(circleInstances[0].latlng).toEqual(markerInstances[0].latlng);
    expect(circleInstances[0].latlng).toEqual([45.4215, -75.6972]);
  });

  it('never draws a circle or tooltip for a listing without an approximate-location flag (owner/staff view)', async () => {
    const listing = baseListing(); // locationApproximate left unset, as the owner/staff API response shape does
    const { markerInstances, circleInstances, L } = await renderFullMap([listing]);

    markerInstances[0].fireHandler('popupopen');

    expect(circleInstances).toHaveLength(0);
    expect(L.circle).not.toHaveBeenCalled();
  });

  it('gives each of several listings sharing an identical public coordinate its own independent circle when selected in turn (no cross-talk under spiderfy)', async () => {
    const listings = [
      baseListing({ id: 'a', locationApproximate: true, locationPrecisionRadiusM: 200 } as any),
      baseListing({ id: 'b', locationApproximate: true, locationPrecisionRadiusM: 200 } as any),
      baseListing({ id: 'c', locationApproximate: true, locationPrecisionRadiusM: 200 } as any),
    ];
    const { markerInstances, circleInstances, mapInstance } = await renderFullMap(listings);
    expect(markerInstances).toHaveLength(3); // all three still individually clickable once spiderfied

    markerInstances[0].fireHandler('popupopen');
    expect(circleInstances).toHaveLength(1);
    markerInstances[0].fireHandler('popupclose');
    expect(mapInstance.removeLayer).toHaveBeenCalledWith(circleInstances[0]);

    markerInstances[1].fireHandler('popupopen');
    expect(circleInstances).toHaveLength(2);
    // The second listing's circle is a distinct instance, independently
    // tracked -- closing the first didn't and can't affect it.
    expect(circleInstances[1]).not.toBe(circleInstances[0]);

    markerInstances[2].fireHandler('popupopen');
    expect(circleInstances).toHaveLength(3);
  });
});
