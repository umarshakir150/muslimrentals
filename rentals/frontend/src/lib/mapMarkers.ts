/**
 * Pure, framework-free helpers for FullMap's clustering/spiderfy config and
 * marker rendering -- extracted so the config and hit-target sizing can be
 * regression-tested without mounting a real Leaflet map in a browser.
 */

// leaflet.markercluster options. spiderfyOnMaxZoom is what makes markers
// sharing (near-)identical coordinates branch outward on click/tap once
// zoomed as far as the map allows clusters to separate naturally
// (disableClusteringAtZoom); maxClusterRadius controls how close markers
// must be (in pixels) to collapse into one cluster at lower zoom.
export const CLUSTER_OPTIONS = {
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  disableClusteringAtZoom: 14,
  maxClusterRadius: 50,
  animate: true,
} as const;

// Icon sizes are padded past the visible pill so the tap target meets the
// ~44px accessibility minimum -- important once spiderfy packs several
// markers close together at high zoom on a phone.
export const MARKER_ICON_SIZE: [number, number] = [70, 44];
export const MARKER_ICON_ANCHOR: [number, number] = [35, 22];
export const CLUSTER_ICON_SIZE: [number, number] = [90, 44];
export const CLUSTER_ICON_ANCHOR: [number, number] = [45, 22];

export function buildMarkerHtml(priceLabel: string): string {
  return `<div class="rental-marker-hit"><div class="rental-marker">${priceLabel}</div></div>`;
}

export function buildClusterHtml(count: number): string {
  return `<div class="rental-marker-hit"><div class="rental-marker">${count} listings</div></div>`;
}

// Presentation-only label -- never mutates/derives the stored lat/lng.
export function formatMarkerLocationLabel(city: string, neighbourhood?: string | null): string {
  return neighbourhood ? `${neighbourhood}, ${city}` : city;
}
