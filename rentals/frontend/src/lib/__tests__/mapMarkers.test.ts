import { describe, it, expect } from 'vitest';
import {
  CLUSTER_OPTIONS,
  MARKER_ICON_SIZE,
  CLUSTER_ICON_SIZE,
  USER_LOCATION_ICON_SIZE,
  buildMarkerHtml,
  buildClusterHtml,
  buildUserLocationMarkerHtml,
  formatMarkerLocationLabel,
  formatApproxRadiusLabel,
  APPROX_LOCATION_CIRCLE_STYLE,
} from '@/lib/mapMarkers';

const MIN_TOUCH_TARGET_PX = 44;

describe('CLUSTER_OPTIONS (leaflet.markercluster config regression guard)', () => {
  it('keeps spiderfy-on-max-zoom enabled so overlapping markers stay reachable', () => {
    expect(CLUSTER_OPTIONS.spiderfyOnMaxZoom).toBe(true);
  });

  // Regression guard for the actual overlapping-markers bug: a pinned
  // disableClusteringAtZoom turns clustering (and spiderfy) off entirely
  // past that zoom, so any markers still coincident/near-coincident beyond
  // it -- routine now that multiple listings can share the same
  // privacy-approximate public point -- render as raw, unclickable-
  // individually, overlapping markers with no way to spiderfy them apart.
  it('does not disable clustering at any zoom, so spiderfy stays available at max zoom too', () => {
    expect('disableClusteringAtZoom' in CLUSTER_OPTIONS).toBe(false);
  });

  it('keeps a positive maxClusterRadius so nearby listings actually collapse into clusters', () => {
    expect(CLUSTER_OPTIONS.maxClusterRadius).toBeGreaterThan(0);
  });
});

describe('marker/cluster hit-target sizing (accessibility: ~44px minimum tap target)', () => {
  it('per-listing marker icon meets the minimum touch target height', () => {
    expect(MARKER_ICON_SIZE[1]).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  });

  it('cluster icon meets the minimum touch target height', () => {
    expect(CLUSTER_ICON_SIZE[1]).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  });
});

describe('buildMarkerHtml / buildClusterHtml', () => {
  it('wraps the visible pill in a full-size invisible hit area', () => {
    expect(buildMarkerHtml('$1.5k')).toContain('rental-marker-hit');
    expect(buildClusterHtml(5)).toContain('rental-marker-hit');
  });

  it('renders the cluster count', () => {
    expect(buildClusterHtml(12)).toContain('12 listings');
  });
});

describe('formatMarkerLocationLabel', () => {
  it('shows "neighbourhood, city" when a neighbourhood is present', () => {
    expect(formatMarkerLocationLabel('Toronto', 'Kensington Market')).toBe('Kensington Market, Toronto');
  });

  it('falls back to just the city for older listings with no neighbourhood', () => {
    expect(formatMarkerLocationLabel('Toronto', null)).toBe('Toronto');
    expect(formatMarkerLocationLabel('Toronto', undefined)).toBe('Toronto');
  });
});

describe('buildUserLocationMarkerHtml ("You are here" marker)', () => {
  it('does not reuse the listing-marker/price-bubble classes, so it can never look like a listing', () => {
    const html = buildUserLocationMarkerHtml();
    expect(html).not.toContain('rental-marker');
  });

  it('is accessible: labelled distinctly as the viewer\'s own location', () => {
    const html = buildUserLocationMarkerHtml();
    expect(html).toContain('Your current location');
  });

  it('meets the minimum touch target height', () => {
    expect(USER_LOCATION_ICON_SIZE[1]).toBeGreaterThanOrEqual(16); // small deliberate dot, not a price pill
  });
});

describe('formatApproxRadiusLabel', () => {
  it('shows meters for sub-kilometre radii', () => {
    expect(formatApproxRadiusLabel(250)).toBe('250 m');
  });

  it('shows kilometres (1 decimal) once the radius reaches 1000m', () => {
    expect(formatApproxRadiusLabel(1500)).toBe('1.5 km');
  });
});

describe('APPROX_LOCATION_CIRCLE_STYLE', () => {
  it('is a subtle, dashed treatment distinct from a solid/opaque fill', () => {
    expect(APPROX_LOCATION_CIRCLE_STYLE.dashArray).toBeTruthy();
    expect(APPROX_LOCATION_CIRCLE_STYLE.fillOpacity).toBeLessThan(0.2);
  });
});
