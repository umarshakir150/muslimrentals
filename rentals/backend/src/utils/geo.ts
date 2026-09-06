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
// within MAX_DISPLACEMENT_METERS of its real one, so the public map reflects
// genuine relative proximity between listings without ever landing a
// normal-looking pin on any real property. See mapMarkers.ts/FullMap.tsx
// for how the client then draws an explicit "approximate area" circle of
// radius PRIVACY_RADIUS_METERS around the point, rather than presenting it
// as exact.
//
// ── Two independent knobs, not one ──────────────────────────────────────
// Earlier passes tied "how far the point actually moves" and "how big the
// displayed circle is" to the same single constant (first 250m, then 200m,
// scaled by a fraction for the jitter). That made the approximation only as
// accurate as the circle was allowed to be large. Per founder direction
// after live testing ("the approximate location is still a little too far
// from the actual property"), these are now separate:
//
//   MAX_DISPLACEMENT_METERS -- caps how far the public point can actually
//   be moved from the real one. Smaller = a more accurate/closer
//   approximation. This is the number that answers "how close is the dot
//   to the real property."
//
//   PRIVACY_RADIUS_METERS -- the radius of the circle actually drawn on the
//   map. Only needs to satisfy PRIVACY_RADIUS_METERS > MAX_DISPLACEMENT_METERS
//   (see the proof on getApproximateLocation below for the exact margin).
//   This is the number that answers "how big is the 'somewhere in here'
//   zone."
//
// Per founder direction after auditing the underlying geocoded coordinates
// themselves (see utils/geocode.ts's `requirePreciseMatch` gate): with the
// base coordinate now either verified address-level-precise or a landlord-
// confirmed pin (see the universal confirm-property-location flow in
// routes/listings.ts -- every listing's exact private point is now either
// a precise geocode match or an explicit human placement, never an
// unconfirmed guess), the jitter itself can stay small while the displayed
// circle still does the actual privacy work. Previous passes: 180m
// max/200m circle, then 120m max/130m circle, then 50m max/500m circle,
// then 50m max/250m circle.
//
// Per founder direction (2026-09-06): the 50m-max/250m-circle pass above
// left the public dot clustering in only the innermost ~4% of the drawn
// circle's AREA (50^2/250^2), because 50m max out of a 250m radius is a
// much smaller fraction of *area* than it looks like as a fraction of
// *radius* -- a circle's area grows with the square of its radius, so a
// circle that visually promises "the property could be anywhere in here"
// was in practice only ever placing the dot in a small disk at its center.
// That's a real privacy gap, not just a cosmetic one: it lets a motivated
// viewer infer the real property is almost certainly within ~50m of the
// shown point, far tighter than the 250m the circle implies. Raised to
// 200m max -- still strictly, comfortably inside the unchanged 250m circle
// (see the proof on getApproximateLocation below), but now covering
// (200/250)^2 = 64% of the circle's area instead of 4%.
export const MAX_DISPLACEMENT_METERS = 200;
const MIN_DISPLACEMENT_METERS = 15;
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
// [MIN_DISPLACEMENT_METERS, MAX_DISPLACEMENT_METERS) -- i.e. [15, 200)
// meters currently -- at a pseudo-random angle, seeded by `seed` (pass the
// listing's id) plus the real coordinates themselves (so moving a listing's
// real address changes its public point too, rather than the point
// sticking to a stale id-only seed forever).
//
// ── Area-uniform distance sampling, not radius-uniform ────────────────────
// A naive `distance = MIN + rand() * (MAX - MIN)` samples uniformly over the
// *radius* value, but the area of an annulus at radius r grows with r (its
// area element is proportional to r dr), so radius-uniform sampling packs
// points much more densely near MIN than near MAX -- the opposite of "evenly
// spread across the allowed area." The standard inverse-CDF fix for
// sampling a point uniformly BY AREA within an annulus [MIN, MAX] is
// `distance = sqrt(MIN^2 + rand() * (MAX^2 - MIN^2))` (the disk case,
// MIN = 0, is the familiar `R * sqrt(rand())`). That's what `distance`
// below computes, so the public dot is now genuinely, uniformly likely to
// land anywhere in the annulus the circle implies -- not clustered near its
// center the way a naive linear draw (or the previous small-MAX pass) would.
//
// ── Why the real point is GUARANTEED to lie inside the displayed circle ───
// The public map draws a circle of radius PRIVACY_RADIUS_METERS centered on
// the point this function returns. For the real point to be guaranteed
// inside that circle, the actual geodesic distance between the real point
// and the returned point must be strictly less than PRIVACY_RADIUS_METERS --
// always, not "almost always":
//
//   1. `distance` (the value fed into the offset construction below) is
//      strictly < MAX_DISPLACEMENT_METERS by construction: it's
//      sqrt(MIN^2 + rand() * (MAX^2 - MIN^2)) with rand() < 1, so
//      distance^2 < MIN^2 + (MAX^2 - MIN^2) = MAX^2, i.e. distance < MAX.
//      Since PRIVACY_RADIUS_METERS > MAX_DISPLACEMENT_METERS (250 > 200),
//      `distance` is therefore also strictly < PRIVACY_RADIUS_METERS. This
//      alone would be sufficient if the offset were built directly on a
//      flat plane.
//   2. Lat/lng isn't a flat plane, though, so `dLat`/`dLng` below are built
//      using the standard equirectangular (local tangent-plane)
//      approximation, not an exact geodesic construction -- so the REAL
//      (haversine) distance between (lat, lng) and (lat+dLat, lng+dLng)
//      isn't exactly `distance`, only extremely close to it. That
//      approximation's relative error for a great-circle path of length d
//      on a sphere of radius R_earth is O((d / R_earth)^2) (from the
//      Taylor expansion of the spherical law of cosines around d = 0). At
//      d = 200m and R_earth = 6,371,000m that's on the order of
//      (200 / 6_371_000)^2 ~= 9.9e-10, i.e. still a sub-millimeter absolute
//      error -- utterly swallowed by the 50m margin between
//      MAX_DISPLACEMENT_METERS (200) and PRIVACY_RADIUS_METERS (250). So
//      the real geodesic distance is, for every practical and
//      floating-point purpose, still strictly less than
//      PRIVACY_RADIUS_METERS.
//
// Combined: real geodesic distance(realPoint, approxPoint) < PRIVACY_RADIUS_METERS
// for every input, at every latitude -- which is exactly "the real point is
// somewhere inside this circle", not a statistical tendency. Proven, not
// just tested, but also independently verified in tests/utils/geo.test.ts
// by computing the actual haversine distance (via distKm, a
// separately-implemented formula from the equirectangular offset built
// here) across hundreds of deterministic samples spanning equatorial,
// mid-latitude, and near-polar coordinates in both hemispheres, plus a set
// of Canadian city/latitude samples specifically, and by a histogram-style
// check that samples actually spread across the outer part of the allowed
// range, not just the inner part.
//
// The lower bound (MIN_DISPLACEMENT_METERS) is a separate, non-mathematical
// privacy/UX choice: it keeps the jitter from ever landing suspiciously
// close to the real point, which the "inside the circle" guarantee alone
// doesn't require but a *useful* privacy circle does.
export function getApproximateLocation(seed: string, lat: number, lng: number): ApproximateLocation {
  const rand = mulberry32(hashSeed(`${seed}:${lat.toFixed(6)}:${lng.toFixed(6)}`));
  const angle = rand() * 2 * Math.PI;
  const distance = Math.sqrt(MIN_DISPLACEMENT_METERS ** 2 + rand() * (MAX_DISPLACEMENT_METERS ** 2 - MIN_DISPLACEMENT_METERS ** 2));

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
