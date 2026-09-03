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
export const PRIVACY_RADIUS_METERS = 250;

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
// [0.3 * PRIVACY_RADIUS_METERS, PRIVACY_RADIUS_METERS) at a pseudo-random
// angle, seeded by `seed` (pass the listing's id) plus the real coordinates
// themselves (so moving a listing's real address changes its public point
// too, rather than the point sticking to a stale id-only seed forever).
// The lower bound keeps the jitter from ever landing suspiciously close to
// the real point while still guaranteeing (by construction) that the real
// point lies within PRIVACY_RADIUS_METERS of the returned one -- exactly
// the "somewhere in this circle" guarantee the public-facing privacy
// circle promises.
export function getApproximateLocation(seed: string, lat: number, lng: number): ApproximateLocation {
  const rand = mulberry32(hashSeed(`${seed}:${lat.toFixed(6)}:${lng.toFixed(6)}`));
  const angle = rand() * 2 * Math.PI;
  const distance = PRIVACY_RADIUS_METERS * (0.3 + rand() * 0.7);

  const dLat = (distance * Math.cos(angle)) / METERS_PER_DEG_LAT;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLng = metersPerDegLng > 0 ? (distance * Math.sin(angle)) / metersPerDegLng : 0;

  return { lat: lat + dLat, lng: lng + dLng };
}

// Redacts a listing's precise location for a public-facing response: drops
// `address` entirely, replaces `lat`/`lng` with the approximate point, and
// flags the result so the client renders the "approximate area" treatment
// instead of an exact-address claim. Callers decide *when* to apply this
// (owner/ADMIN/MODERATOR views should keep the real data) -- this function
// only knows how.
export function toPublicListingLocation<T extends { id: string; lat: number; lng: number; address?: string | null }>(
  listing: T
): Omit<T, 'address'> & { lat: number; lng: number; locationApproximate: true; locationPrecisionRadiusM: number } {
  const { address: _address, ...rest } = listing;
  const approx = getApproximateLocation(listing.id, listing.lat, listing.lng);
  return {
    ...rest,
    lat: approx.lat,
    lng: approx.lng,
    locationApproximate: true,
    locationPrecisionRadiusM: PRIVACY_RADIUS_METERS,
  };
}
