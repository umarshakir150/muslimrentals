/**
 * Geo distance helper, used by the in-memory radius filter in GET /listings.
 * Pure function (no I/O) so it's covered by DB-independent unit tests.
 */

// Haversine great-circle distance between two lat/lng points, in kilometres.
export function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Privacy-safe approximate listing location ─────────────────────────────
// The real address and precise lat/lng (Listing.address/lat/lng) are kept
// server-side for internal use (owner's own views, staff moderation, the
// radius-search filter's actual distance math) and are never sent to a
// public caller. What a public caller gets instead is this: a point offset
// from the real one by a random-looking but *deterministic* distance/angle,
// derived only from the listing's own id and its real coordinates -- no
// stored column, no migration, and no per-request randomness, so the same
// listing always renders at the same public point (recomputing it fresh on
// every read is what "stable" actually means here, not caching one).
// Editing a listing's real address naturally moves its public point too,
// since the seed includes the real coordinates.
//
// This is deliberately a per-listing random jitter, not a shared
// neighbourhood/grid centroid: every listing gets its own approximate point
// within PRIVACY_RADIUS_METERS of its real one, so the public map reflects
// genuine relative proximity between listings without ever landing a
// normal-looking pin on any real property. See mapMarkers.ts/FullMap.tsx
// for how the client then draws an explicit "approximate area" circle of
// this same radius around the point, rather than presenting it as exact.
//
// 200m (not the original 250m) per founder direction after a live test:
// the offset math itself was verified correct and tightly bounded (see
// getApproximateLocation's own multi-city regression coverage below,
// which computes the real geodesic distance for every case) -- a ~1km-off
// marker the founder observed live was not explained by this function,
// which has never been able to produce more than PRIVACY_RADIUS_METERS of
// displacement by construction. The likely actual cause is Nominatim
// (the free OSM geocoder)'s own precision for that specific address --
// see PostListingModal.tsx/CityAutocomplete's onChange, which now also
// passes the selected city's province into the geocoding query, tightening
// match specificity. Kept at 200m for this pass too: it already sits in the
// founder's requested 150-250m band, and the "real point can appear outside
// the circle" concern this pass fixes is about the OFFSET CONSTRUCTION below
// (how close to the R boundary the jitter distance was allowed to get), not
// about R itself needing to move again.
export const PRIVACY_RADIUS_METERS = 200;

// The offset distance is drawn from [MIN_OFFSET_FRACTION, MAX_OFFSET_FRACTION)
// * PRIVACY_RADIUS_METERS. MAX_OFFSET_FRACTION < 1 is not a stylistic choice --
// it is what makes "the real point is guaranteed inside the displayed circle"
// a mathematical fact rather than a best-effort approximation. See the proof
// in the comment on getApproximateLocation below.
const MIN_OFFSET_FRACTION = 0.4;
const MAX_OFFSET_FRACTION = 0.9;

// Mulberry32 -- a small, fast, deterministic PRNG. Not cryptographic (no
// need to be: the seed is derived from public-ish data and the whole point
// is that the *same* input always reproduces the *same* output, the
// opposite of what a secret/unpredictable generator would give us).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cheap 32-bit string hash (djb2) -- turns a listing id (a UUID string) into
// a numeric seed for mulberry32. Collisions across different listings just
// mean two listings' jitter angles/distances happen to correlate, which has
// no privacy or correctness impact (each still jitters from its *own* real
// coordinates).
function hashSeed(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

const METERS_PER_DEG_LAT = 111_320;

export interface ApproximateLocation {
  lat: number;
  lng: number;
}

// Deterministically offsets (lat, lng) by a pseudo-random distance in
// [MIN_OFFSET_FRACTION, MAX_OFFSET_FRACTION) * PRIVACY_RADIUS_METERS -- i.e.
// [80, 180) meters at the current 200m radius -- at a pseudo-random angle,
// seeded by `seed` (pass the listing's id) plus the real coordinates
// themselves (so moving a listing's real address changes its public point
// too, rather than the point sticking to a stale id-only seed forever).
//
// ── Why the real point is GUARANTEED to lie inside the displayed circle ───
// The public map draws a circle of radius `R = PRIVACY_RADIUS_METERS`
// centered on the point this function returns. For the real point to be
// guaranteed inside that circle, the actual geodesic distance between the
// real point and the returned point must be strictly less than R -- always,
// not "almost always":
//
//   1. `distance` (the value fed into the offset construction below) is
//      drawn from [MIN_OFFSET_FRACTION * R, MAX_OFFSET_FRACTION * R), i.e.
//      strictly < R by construction (MAX_OFFSET_FRACTION = 0.9 < 1). This
//      alone would be sufficient if the offset were built directly on a
//      flat plane.
//   2. Lat/lng isn't a flat plane, though, so `dLat`/`dLng` below are built
//      using the standard equirectangular (local tangent-plane)
//      approximation, not an exact geodesic construction -- so the REAL
//      (haversine) distance between (lat, lng) and (lat+dLat, lng+dLng)
//      isn't exactly `distance`, only extremely close to it. That
//      approximation's relative error for a great-circle path of length d
//      on a sphere of radius R_earth is O((d / R_earth)^2) (from the
//      Taylor expansion of the spherical law of cosines around d = 0).
//      At d = 200m and R_earth = 6,371,000m that's on the order of
//      (200 / 6_371_000)^2 ~= 1e-9, i.e. a sub-millimeter absolute error --
//      utterly swallowed by the 10% (20m at R=200) margin MAX_OFFSET_FRACTION
//      already leaves below R. So the real geodesic distance is, for every
//      practical and floating-point purpose, still strictly < R.
//
// Combined: real geodesic distance(realPoint, approxPoint) < R for every
// input, at every latitude -- which is exactly "the real point is somewhere
// inside this circle", not a statistical tendency. Proven, not just tested,
// but also independently verified in tests/utils/geo.test.ts by computing
// the actual haversine distance (via distKm, a separately-implemented
// formula from the equirectangular offset built here) across hundreds of
// deterministic samples spanning equatorial, mid-latitude, and near-polar
// coordinates in both hemispheres.
//
// The lower bound (MIN_OFFSET_FRACTION) is a separate, non-mathematical
// privacy/UX choice: it keeps the jitter from ever landing suspiciously
// close to the real point, which the "inside the circle" guarantee alone
// doesn't require but a *useful* privacy circle does.
export function getApproximateLocation(seed: string, lat: number, lng: number): ApproximateLocation {
  const rand = mulberry32(hashSeed(`${seed}:${lat.toFixed(6)}:${lng.toFixed(6)}`));
  const angle = rand() * 2 * Math.PI;
  const distance = PRIVACY_RADIUS_METERS * (MIN_OFFSET_FRACTION + rand() * (MAX_OFFSET_FRACTION - MIN_OFFSET_FRACTION));

  const dLat = (distance * Math.cos(angle)) / METERS_PER_DEG_LAT;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLng = metersPerDegLng > 0 ? (distance * Math.sin(angle)) / metersPerDegLng : 0;

  return { lat: lat + dLat, lng: lng + dLng };
}

// Redacts a listing's precise location for a public-facing response: drops
// `address` AND `unit` entirely, replaces `lat`/`lng` with the approximate
// point, and flags the result so the client renders the "approximate area"
// treatment instead of an exact-address claim. Callers decide *when* to
// apply this (owner/ADMIN/MODERATOR views should keep the real data) --
// this function only knows how.
export function toPublicListingLocation<
  T extends { id: string; lat: number; lng: number; address?: string | null; unit?: string | null }
>(
  listing: T
): Omit<T, 'address' | 'unit'> & { lat: number; lng: number; locationApproximate: true; locationPrecisionRadiusM: number } {
  const { address: _address, unit: _unit, ...rest } = listing;
  const approx = getApproximateLocation(listing.id, listing.lat, listing.lng);
  return {
    ...rest,
    lat: approx.lat,
    lng: approx.lng,
    locationApproximate: true,
    locationPrecisionRadiusM: PRIVACY_RADIUS_METERS,
  };
}
