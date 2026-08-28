import { describe, it, expect } from 'vitest';
import {
  CLUSTER_OPTIONS,
  MARKER_ICON_SIZE,
  CLUSTER_ICON_SIZE,
  buildMarkerHtml,
  buildClusterHtml,
  formatMarkerLocationLabel,
} from '@/lib/mapMarkers';

const MIN_TOUCH_TARGET_PX = 44;

describe('CLUSTER_OPTIONS (leaflet.markercluster config regression guard)', () => {
  it('keeps spiderfy-on-max-zoom enabled so overlapping markers stay reachable', () => {
    expect(CLUSTER_OPTIONS.spiderfyOnMaxZoom).toBe(true);
  });

  it('keeps a defined disableClusteringAtZoom so clusters separate naturally on zoom', () => {
    expect(CLUSTER_OPTIONS.disableClusteringAtZoom).toBeGreaterThan(0);
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
