/**
 * Pure, framework-free helpers for FullMap's clustering/spiderfy config and
 * marker rendering -- extracted so the config and hit-target sizing can be
 * regression-tested without mounting a real Leaflet map in a browser.
 */

// leaflet.markercluster options.
//
// disableClusteringAtZoom is deliberately NOT set. It used to be pinned to
// 14, which turns clustering off entirely beyond that zoom -- meaning any
// markers still close enough to visually overlap past zoom 14 (identical
// or near-identical coordinates, now routine under the privacy-approximate
// location model: several real listings within the same ~200m privacy
// radius can legitimately land on the exact same public point) were shown
// as raw, unclustered, pixel-overlapping markers with no way to reach the
// ones underneath -- the actual "overlapping markers" bug this option
// exists to fix. Leaving it unset keeps clustering (and therefore
// spiderfyOnMaxZoom below) active at every zoom level; maxClusterRadius is
// a *pixel* radius, so at high zoom the same real-world distance covers
// far more pixels and stops clustering on its own -- only markers that are
// still genuinely close together on screen ever cluster/spiderfy,
// regardless of how far in the map is zoomed.
export const CLUSTER_OPTIONS = {
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
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

// ─── "You are here" (Locate me) marker ─────────────────────────────────────
// Deliberately nothing like a listing marker/price bubble (not a pill, no
// price, no click target opening a listing) -- a small blue dot with a
// pulsing ring, the same visual language most map products use for "this
// is you", so it can never be mistaken for a rental.
export const USER_LOCATION_ICON_SIZE: [number, number] = [22, 22];
export const USER_LOCATION_ICON_ANCHOR: [number, number] = [11, 11];

export function buildUserLocationMarkerHtml(): string {
  return `<div class="user-location-marker" role="img" aria-label="Your current location">
    <div class="user-location-marker-pulse"></div>
    <div class="user-location-marker-dot"></div>
  </div>`;
}

// ─── Approximate-location privacy circle ───────────────────────────────────
// Drawn around a listing's public marker (see FullMap.tsx) to make clear
// the property is somewhere within this area, not exactly at the pin.
export const APPROX_LOCATION_CIRCLE_STYLE = {
  color: '#0a5c42',
  fillColor: '#0a5c42',
  fillOpacity: 0.08,
  weight: 1.5,
  dashArray: '4 6',
} as const;

export function formatApproxRadiusLabel(radiusM: number): string {
  return radiusM >= 1000 ? `${(radiusM / 1000).toFixed(1)} km` : `${radiusM} m`;
}

// A dashed circle alone still centers a solid price pill exactly in the
// middle of it, which reads as "the pill is a decorated exact pin" rather
// than "the property is somewhere in this whole area" -- a real, founder-
// flagged UX gap, not just a copy problem. This permanent map-level label
// (bound to the circle itself via Leaflet's tooltip API, independent of the
// marker's own popup) is the fix: it puts the privacy disclosure directly
// on the zone being drawn, visible for as long as the zone is, rather than
// buried at the bottom of an unrelated price/photo popup someone might not
// scroll to.
export function buildApproxZoneTooltipHtml(): string {
  return `<div class="approx-zone-label">
    <strong>Approximate location</strong>
    <span>Exact address hidden for privacy</span>
  </div>`;
}

// ─── Location-radius search circle ─────────────────────────────────────────
// Drawn around a renter's searched location + chosen radius (see
// LocationRadiusSearch.tsx / FullMap.tsx) to show what area a radius search
// covers. Deliberately styled nothing like APPROX_LOCATION_CIRCLE_STYLE
// above (blue/solid vs. brand-green/dashed) -- the two circles answer
// different questions ("what area did I search" vs. "where is this
// specific listing, approximately") and must never be visually confused
// with each other when both happen to be on screen at once.
export const SEARCH_RADIUS_CIRCLE_STYLE = {
  color: '#2563eb',
  fillColor: '#2563eb',
  fillOpacity: 0.06,
  weight: 1.5,
} as const;
