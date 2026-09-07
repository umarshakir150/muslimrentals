import { logger } from './logger';

// Thrown (never silently swallowed as "no results") when Nominatim itself
// says 429 -- a distinct condition from "no candidate matched" that must
// never be presented to a landlord/renter as "check your spelling"/"could
// not find that location". Also serves as the fail-fast signal that stops
// geocodeAddress's free-text fallback and tryStreetSuffixExpansion's
// up-to-10-request loop from continuing to hammer an already-rate-limited
// provider with more requests that would just 429 too.
export class GeocodingUnavailableError extends Error {
  constructor(message = 'Geocoding provider rate-limited this request.') {
    super(message);
    this.name = 'GeocodingUnavailableError';
  }
}

/**
 * Server-side address -> precise-coordinate geocoding, the first stage of
 * the location pipeline this app now uses end to end:
 *
 *   real property address -> geocode -> precise private coordinates
 *     -> privacy transformation (see utils/geo.ts) -> approximate public location
 *
 * Coordinates are never accepted from the client (see listingSchemas.ts --
 * `lat`/`lng` were removed from listingCreateSchema/listingUpdateSchema):
 * a landlord could otherwise submit any address alongside arbitrary
 * coordinates that don't actually match it. Resolving them here, from the
 * address text alone, makes the stored precise location actually mean what
 * it claims to.
 *
 * The one exception is the universal confirm-property-location flow (see
 * routes/listings.ts): geocodeAddress here finds the best STARTING point
 * for a landlord's entered address, but every listing -- regardless of how
 * confident the match is -- requires the landlord to confirm (or drag) a
 * pin over that starting point before it's ever stored. That confirmed pin
 * becomes the exact private coordinate, but only once it's independently
 * verified -- see verifyConfirmedPinLocation below -- against the entered
 * city/province, NOT against distance from geocodeAddress's own starting
 * point. The starting point can itself be badly wrong (a real observed
 * case: off by over 5km for a genuine address), so a landlord correcting
 * it by a large distance is expected and must not be penalized for how bad
 * the starting guess was. The client still never gets to supply a
 * coordinate verified against nothing: every confirmed pin is checked
 * against the same city/province the address was actually entered under.
 *
 * Uses OpenStreetMap's free Nominatim search API -- no API key/signup, and
 * consistent with this app already using OSM tiles for the map itself
 * (FullMap.tsx). Nominatim's usage policy requires a real identifying
 * User-Agent and caps unauthenticated use at ~1 request/second, both fine
 * for this app's listing-creation/edit volume. If that ever changes, this
 * is the one function to swap for a paid provider (Google/Mapbox) --
 * nothing else in the app depends on which geocoder is used.
 */

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'MuslimRentals/1.0 (https://muslimrentals.ca)';
const REQUEST_TIMEOUT_MS = 8_000;

// How many candidates to pull back per query for the listing-address
// pipeline (requirePreciseMatch only -- the renter free-text location
// search still asks for exactly 1, see below). Nominatim's own relevance
// ranking sometimes puts a street-level result first even when a
// house/building-level result for the SAME street/city/province exists
// further down the list -- asking for one candidate and taking it meant
// settling for the street-level result even when a better one was
// available. 5 is enough headroom to surface a better match without
// meaningfully increasing request cost against Nominatim's ~1req/s policy
// (still exactly one HTTP request per query attempt -- this only changes
// `limit=`, not the number of requests made).
const PRECISE_CANDIDATE_LIMIT = 5;

// Nominatim's structured `state=` field matches noticeably more reliably
// against the full province/territory name than against the 2-letter code
// this app stores everywhere else (CityAutocomplete/data/cities.ts) -- e.g.
// "state=Ontario" resolves consistently; "state=ON" is left to Nominatim's
// fuzzy matching, which is exactly the kind of avoidable imprecision this
// pass is about removing. Falls back to the raw value for anything already
// spelled out or genuinely unrecognized, rather than dropping it.
const PROVINCE_NAMES: Record<string, string> = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
  NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
  SK: 'Saskatchewan', YT: 'Yukon',
};

export interface GeocodeResult {
  lat: number;
  lng: number;
  // Only ever set when requirePreciseMatch was used (the listing-address
  // pipeline). Absent for the renter free-text search, which has no
  // per-result confidence concept.
  //
  // Purely informational/internal now -- routes/listings.ts's universal
  // confirm-property-location flow requires landlord confirmation for
  // EVERY listing regardless of this value, and the confirmed pin is
  // verified against the entered city/province (see
  // verifyConfirmedPinLocation below), never against this result's own
  // coordinate -- so `confidence` no longer gates whether confirmation
  // happens, nor how the confirmed pin gets validated. It's kept because
  // pickBestCandidate still needs it to prefer a
  // building-level match over a street-level one when picking the
  // STARTING point shown to the landlord -- a more accurate starting pin
  // means less dragging, even though confirmation is required either way.
  //
  //   'precise' -- the matched result carries a house_number (or is
  //   otherwise an address/building-level point) on the correct
  //   street/city/province.
  //
  //   'street' -- the best available result resolves to the correct
  //   street/city/province, but no candidate carried building-level
  //   precision (OSM simply has no house-number data for that block) --
  //   can legitimately be a couple hundred meters from the actual
  //   property, which is exactly why the landlord still confirms/drags
  //   the pin before anything is stored.
  confidence?: 'precise' | 'street';
}

interface NominatimAddressDetails {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  state?: string;
  postcode?: string;
}

// The metadata Nominatim actually returns to judge match quality by.
// Requested via `format=jsonv2` for the listing-address pipeline, which
// Nominatim documents as including `place_rank`/`importance` (informational
// only below, not gating criteria -- see the comment on
// evaluateAddressMatch) alongside the fields plain `json` already has.
// NOTE: jsonv2 renames the plain-`json` `class` field to `category` --
// both are read here so logging is accurate regardless of which Nominatim
// deployment/version actually served the response.
interface NominatimResult {
  lat?: unknown;
  lon?: unknown;
  address?: NominatimAddressDetails;
  class?: string;
  category?: string;
  type?: string;
  place_rank?: number;
  importance?: number;
  display_name?: string;
}

interface MatchEvaluation {
  status: 'precise' | 'street' | 'rejected';
  // Sanitized, log-safe reasoning -- class/type/rank/importance, an address
  // breakdown, and display_name (all data Nominatim already returns for the
  // address as typed; never the resolved lat/lon, and never surfaced in any
  // API response -- this is diagnostic-log-only, per the explicit ask to
  // "log/report enough sanitized metadata... but do not expose private
  // coordinates").
  reason: string;
}

// ─── Canadian address component normalization ──────────────────────────────
// Goal: get a geographically useful coordinate for the entered address, not
// certify house-number-level building data against OSM. So instead of
// gating on Nominatim's own precision metadata (class/type/place_rank --
// which penalizes a real address purely because OSM hasn't mapped that
// specific building) to decide ACCEPT/REJECT, that metadata is used only to
// grade an already-accepted (right street/city/province) result into
// 'precise' vs 'street' -- see evaluateAddressMatch. A result is rejected
// only when it resolves to a different street/city/province, or to no
// street at all (a bare city/neighbourhood/province centroid).
const STREET_TYPE_ALIASES: Record<string, string> = {
  st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive',
  blvd: 'boulevard', ct: 'court', crt: 'court', cres: 'crescent', cresc: 'crescent',
  pl: 'place', ln: 'lane', hwy: 'highway', pkwy: 'parkway', sq: 'square',
  terr: 'terrace', ter: 'terrace', cir: 'circle', gdns: 'gardens',
  n: 'north', s: 'south', e: 'east', w: 'west',
};

const MUNICIPALITY_PREFIXES = /^(city|town|township|municipality|village|district)\s+of\s+/i;

// ─── Missing-street-suffix fallback ─────────────────────────────────────────
// A landlord who types "1031 Askin" instead of "1031 Askin Ave" gets no
// match at all from Nominatim -- it doesn't guess a suffix on its own. This
// is the real, motivating case (a genuine Windsor, ON address). Two
// distinct word lists do two distinct jobs here:
//
//   KNOWN_STREET_SUFFIXES -- every suffix word (abbreviated forms already
//   normalize to these via STREET_TYPE_ALIASES) this app can recognize an
//   address as already HAVING. If the entered address already ends in one
//   of these, appending another would be actively wrong (turning "732 Mill
//   St" into "732 Mill Street Avenue"), so hasRecognizedStreetSuffix below
//   gates the whole fallback off in that case -- deliberately broader than
//   SUFFIX_EXPANSION_CANDIDATES so this never fires when it shouldn't.
//
//   SUFFIX_EXPANSION_CANDIDATES -- the specific suffixes actually tried
//   (see tryStreetSuffixExpansion), one structured Nominatim query each,
//   only when the address as entered found nothing at all. Deliberately
//   just the handful of suffixes that cover the large majority of Canadian
//   street addresses, not an exhaustive list -- this is a fallback for the
//   common case of an omitted suffix, not a general spell-checker.
const KNOWN_STREET_SUFFIXES = new Set([
  ...Object.values(STREET_TYPE_ALIASES).filter((w) => !['north', 'south', 'east', 'west'].includes(w)),
  'way', 'trail', 'close', 'grove', 'gate', 'walk', 'mews', 'row',
  'path', 'run', 'view', 'ridge', 'heights', 'landing', 'point',
  'bend', 'cove', 'manor', 'common', 'crossing', 'line', 'loop',
]);

const SUFFIX_EXPANSION_CANDIDATES = [
  'Street', 'Avenue', 'Road', 'Drive', 'Boulevard', 'Court', 'Crescent', 'Place', 'Lane', 'Way',
];

// True when the entered street text already ends in a recognized suffix
// (ignoring a trailing directional like "N"/"South") -- i.e. the fallback
// below has nothing useful to add.
function hasRecognizedStreetSuffix(address: string): boolean {
  const words = normalizeStreetName(address).split(' ').filter(Boolean);
  if (words.length > 1 && ['north', 'south', 'east', 'west'].includes(words[words.length - 1])) {
    words.pop();
  }
  return KNOWN_STREET_SUFFIXES.has(words[words.length - 1] ?? '');
}

function normalizeStreetName(input: string): string {
  return input
    .trim()
    // Strip a leading house number/unit (e.g. "732 " or "732A ") -- the
    // requested side is the raw landlord-entered address, which includes
    // the number; Nominatim's `address.road` never does.
    .replace(/^\d+[a-zA-Z]?[\s-]+/, '')
    // Strip an embedded Canadian postal code (e.g. a landlord typing
    // "732 Mill St, N9C 2S2" into a single address field, which this app
    // doesn't have a separate field for) -- it's a real component worth
    // extracting (see extractCanadianFsa) but not part of the street name,
    // and left in place it breaks the exact-match comparison below.
    .replace(/[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STREET_TYPE_ALIASES[word] ?? word)
    .join(' ');
}

function normalizePlaceName(input: string): string {
  return input.trim().replace(MUNICIPALITY_PREFIXES, '').toLowerCase();
}

function normalizeProvinceName(input: string): string {
  const trimmed = input.trim().toUpperCase();
  return (PROVINCE_NAMES[trimmed] ?? input.trim()).toLowerCase();
}

// First 3 characters of a Canadian postal code (the Forward Sortation
// Area) -- a much coarser, and therefore much safer, comparison than the
// full code: Nominatim's postcode for a street-level result is often a
// representative point along the street, not literally the requested
// building's own code. Informational corroboration only (see below), never
// a rejection reason on its own.
function extractCanadianFsa(input: string): string | null {
  const match = input.toUpperCase().match(/[A-Z]\d[A-Z]/);
  return match ? match[0] : null;
}

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

export interface PinLocationVerification {
  ok: boolean;
  // Sanitized, log-safe reason (e.g. "resolves to Toronto, not Windsor") --
  // never the coordinate itself, same stance as every other diagnostic
  // string in this file. Safe to surface directly in the 422 error message
  // routes/listings.ts returns to the landlord.
  reason: string;
}

// ─── Landlord-confirmed-pin geography check ────────────────────────────────
// The universal confirm-property-location flow (routes/listings.ts) cannot
// validate a landlord-placed pin by measuring its distance from
// geocodeAddress's own starting point -- that point is exactly what
// confirmation exists to let the landlord CORRECT, and a real case proved
// it can be off by more than 5km for a genuine address. Measuring "distance
// from a possibly-wrong point" would reject the landlord's legitimate fix
// for being too far from the very mistake they're fixing.
//
// Instead, this reverse-geocodes the CONFIRMED pin itself and checks its
// own city/province against what the landlord actually entered -- the
// thing that actually matters ("is this plausibly in Windsor, ON") is
// independent of how far the pin ended up from any earlier guess. A pin
// several km away, still within the entered city, is accepted; a pin in a
// different city (Toronto instead of Windsor) is rejected regardless of
// distance.
//
// Uses Nominatim's own /reverse endpoint -- the SAME provider already used
// for forward geocoding in this file (no new dependency, API key, billing
// relationship, or provider evaluation needed). Adds exactly one extra
// request per confirmed pin (once per listing create/edit, not per
// keystroke or drag event), comfortably inside the ~1req/s usage-policy
// headroom already discussed at the top of this file.
export async function verifyConfirmedPinLocation(
  lat: number,
  lng: number,
  city: string,
  province?: string | null
): Promise<PinLocationVerification> {
  const params = new URLSearchParams({
    format: 'jsonv2', lat: String(lat), lon: String(lng), addressdetails: '1', zoom: '16',
  });
  const url = `${NOMINATIM_REVERSE_URL}?${params.toString()}`;
  // Never includes the actual coordinate -- same "diagnostic metadata only,
  // never the private location" stance as every other query description in
  // this file.
  const description = `reverse geocode of the landlord-confirmed pin (verifying against city="${city}", state="${province ?? ''}")`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    logger.error(`Reverse geocoding request failed for ${description}:`, err);
    return { ok: false, reason: "we couldn't verify that location right now (reverse geocoding request failed)" };
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    logger.error(`Reverse geocoding API rate-limited (429) for ${description}`);
    throw new GeocodingUnavailableError();
  }

  if (!response.ok) {
    logger.error(`Reverse geocoding API returned ${response.status} for ${description}`);
    return { ok: false, reason: "we couldn't verify that location right now (reverse geocoding service error)" };
  }

  let result: { address?: NominatimAddressDetails } | null;
  try {
    result = (await response.json()) as { address?: NominatimAddressDetails } | null;
  } catch (err) {
    logger.error(`Reverse geocoding response was not valid JSON for ${description}:`, err);
    return { ok: false, reason: "we couldn't verify that location right now (invalid reverse geocoding response)" };
  }

  const addr = result?.address ?? {};
  const resultCity = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.hamlet;
  const resultState = addr.state;

  // Province checked first (cheaper, coarser signal) -- catches a
  // cross-province placement even before the city comparison below.
  if (province && resultState && normalizeProvinceName(resultState) !== normalizeProvinceName(province)) {
    logger.warn(`Pin verification REJECTED for [${description}]: pin resolves to state="${resultState}", not the requested province.`);
    return { ok: false, reason: `that location appears to be in ${resultState}, not ${province}` };
  }

  // Deliberately stricter than evaluateAddressMatch's forward-match city
  // check (which lets a MISSING result city pass): a manually placed pin
  // with no determinable city at all (open water, wilderness, another
  // country's rural area) must not be silently accepted just because
  // Nominatim had nothing to compare against.
  if (!resultCity || normalizePlaceName(resultCity) !== normalizePlaceName(city)) {
    logger.warn(`Pin verification REJECTED for [${description}]: pin resolves to city="${resultCity ?? 'unknown'}", not the requested city.`);
    return {
      ok: false,
      reason: resultCity ? `that location appears to be in ${resultCity}, not ${city}` : "that location's city couldn't be determined",
    };
  }

  logger.info(`Pin verification ACCEPTED for [${description}]: pin resolves to city="${resultCity}", state="${resultState ?? 'unknown'}".`);
  return { ok: true, reason: 'matches the requested city/province' };
}

// Judges whether a Nominatim result resolves to the requested address's
// street, in the requested city, in the requested province, and if so how
// precisely: 'precise' when the address breakdown carries a house_number
// (a real building-level point), 'street' when street+city+province match
// but no house_number is present (OSM has no building data for that
// address, only the road itself). Rejects only a wrong street, a wrong
// city, a wrong province, or a result with no street at all (a
// city/neighbourhood/province centroid).
function evaluateAddressMatch(
  result: NominatimResult,
  requestedStreet: string,
  requestedCity: string,
  requestedProvince: string | null | undefined
): MatchEvaluation {
  const addr = result.address ?? {};
  const category = result.class ?? result.category;
  const resultCity = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.hamlet;
  const requestedFsa = extractCanadianFsa(requestedStreet);
  const resultFsa = addr.postcode ? extractCanadianFsa(addr.postcode) : null;
  const fsaNote = requestedFsa && resultFsa
    ? `, postal FSA ${requestedFsa === resultFsa ? 'matches' : 'differs'} (requested ${requestedFsa}, result ${resultFsa})`
    : '';
  const meta = `category=${category ?? 'unknown'}, type=${result.type ?? 'unknown'}, ` +
    `place_rank=${result.place_rank ?? 'unknown'}, importance=${result.importance ?? 'unknown'}, ` +
    `road="${addr.road ?? 'none'}", city="${resultCity ?? 'none'}", state="${addr.state ?? 'none'}"${fsaNote}, ` +
    `display_name="${result.display_name ?? 'unknown'}"`;

  if (!addr.road) {
    return { status: 'rejected', reason: `no street in the result's address breakdown -- only a city/neighbourhood/province-level match (${meta})` };
  }
  if (normalizeStreetName(addr.road) !== normalizeStreetName(requestedStreet)) {
    return { status: 'rejected', reason: `resolved street does not match the requested street (${meta})` };
  }
  if (resultCity && normalizePlaceName(resultCity) !== normalizePlaceName(requestedCity)) {
    return { status: 'rejected', reason: `resolved city does not match the requested city (${meta})` };
  }
  if (requestedProvince && addr.state && normalizeProvinceName(addr.state) !== normalizeProvinceName(requestedProvince)) {
    return { status: 'rejected', reason: `resolved province does not match the requested province (${meta})` };
  }

  if (addr.house_number) {
    return { status: 'precise', reason: `house_number "${addr.house_number}" present (${meta})` };
  }
  return { status: 'street', reason: `street-level match only -- no house_number in OSM for this building (${meta})` };
}

// Scans every candidate a query returned and picks the best one: any
// 'precise' candidate beats any 'street' candidate, regardless of which
// came first in Nominatim's own relevance ordering -- this is the
// "candidate improvement": a query's #1 result being street-level no
// longer means settling for street-level if a #3 or #4 result on the same
// street/city/province turns out to carry a house_number. 'rejected'
// candidates (wrong street/city/province, or no street at all) are never
// considered, no matter how "precise" their own metadata looks -- a
// building-level point on the wrong street is not a better answer than a
// street-level point on the right one.
interface BestCandidate {
  candidate: NominatimResult;
  status: 'precise' | 'street';
  reason: string;
}

function pickBestCandidate(
  candidates: NominatimResult[],
  requestedStreet: string,
  requestedCity: string,
  requestedProvince: string | null | undefined
): BestCandidate | null {
  let best: BestCandidate | null = null;

  for (const candidate of candidates) {
    const evaluation = evaluateAddressMatch(candidate, requestedStreet, requestedCity, requestedProvince);
    if (evaluation.status === 'rejected') continue;
    if (!best) {
      best = { candidate, status: evaluation.status, reason: evaluation.reason };
    } else if (evaluation.status === 'precise' && best.status === 'street') {
      best = { candidate, status: evaluation.status, reason: evaluation.reason }; // upgrade street -> precise; never downgrade
    }
  }

  return best;
}

// The missing-street-suffix fallback itself: only ever called after the
// address exactly as entered (both structured and free-text) found nothing
// usable at all -- see the call site in geocodeAddress. Tries appending
// each of SUFFIX_EXPANSION_CANDIDATES in turn as a STRUCTURED query (so
// Nominatim knows this is specifically the street field, not a free-text
// guess), evaluating each attempt through the exact same
// evaluateAddressMatch/pickBestCandidate gate as every other query in this
// file -- so a suffix-expansion match still has to land on the right
// street, city, and province, never a fuzzy "close enough" pick.
//
// Deliberately checks EVERY candidate suffix rather than stopping at the
// first success: if "Askin Avenue" and "Askin Trail" both turned out to be
// real, distinct, plausible streets in the same city, silently picking
// whichever happened to come first in the list would be a guess dressed up
// as a match. When more than one distinct suffix produces an accepted
// result, that's genuine ambiguity -- refuse to guess and return null,
// same as if nothing had matched at all.
async function tryStreetSuffixExpansion(
  address: string,
  city: string,
  province: string | null | undefined,
  provinceName: string | undefined
): Promise<GeocodeResult | null> {
  const accepted: Array<BestCandidate & { expandedStreet: string }> = [];

  for (const suffix of SUFFIX_EXPANSION_CANDIDATES) {
    const expandedStreet = `${address} ${suffix}`;
    const params = new URLSearchParams({
      format: 'jsonv2', limit: String(PRECISE_CANDIDATE_LIMIT), countrycodes: 'ca', addressdetails: '1',
      street: expandedStreet, country: 'Canada',
    });
    if (city) params.set('city', city);
    if (provinceName) params.set('state', provinceName);
    const url = `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
    const description = `street="${expandedStreet}", city="${city}", state="${provinceName ?? ''}", country="Canada" (suffix-expansion fallback)`;

    const candidates = await fetchNominatimCandidates(url, description);
    // Validated against the EXPANDED street (e.g. "1031 Askin Avenue"), the
    // same requested city/province as every other attempt -- a candidate
    // still has to resolve to this exact street, not just something
    // vaguely nearby, and city/province checks are untouched.
    const best = pickBestCandidate(candidates, expandedStreet, city, province);
    if (best) {
      logger.info(
        `Geocoding (suffix-expansion "${suffix}", ${candidates.length} candidate(s)) for [${description}]: ` +
        `ACCEPTED (${best.status}) -- ${best.reason}`
      );
      accepted.push({ ...best, expandedStreet });
    }
  }

  if (accepted.length === 0) return null;

  // Prefer any precise (house-level) match over a street-level one across
  // ALL accepted suffixes, then apply the ambiguity check within that
  // preferred tier only -- two street-level guesses when a precise one
  // also exists shouldn't block the precise one from winning.
  const preciseMatches = accepted.filter((m) => m.status === 'precise');
  const pool = preciseMatches.length > 0 ? preciseMatches : accepted;

  if (pool.length > 1) {
    logger.warn(
      `Geocoding suffix-expansion for "${address}, ${city}" is ambiguous -- ${pool.length} distinct street-suffix ` +
      `expansions (${pool.map((m) => m.expandedStreet).join(', ')}) each resolved to a plausible address; refusing to guess.`
    );
    return null;
  }

  const [match] = pool;
  return toGeocodeResult(match.candidate, `suffix-expansion "${match.expandedStreet}"`, match.status);
}

export interface GeocodeOptions {
  // When true:
  //   1. Uses Nominatim's STRUCTURED query fields (street/city/state/country)
  //      instead of one free-text string, requesting several candidates
  //      (see PRECISE_CANDIDATE_LIMIT) rather than just the top one.
  //      Nominatim's own docs note structured fields resolve more reliably
  //      than one joined string when the caller genuinely knows which part
  //      of the input is the street vs. the city/region -- which the
  //      listing Post/Edit form does (separate address/city/province
  //      fields), unlike a renter's free-text location search.
  //   2. Evaluates EVERY candidate against the REQUESTED street/city/
  //      province (see evaluateAddressMatch/pickBestCandidate) and, if none
  //      resolves there at all, falls back to a carefully constructed
  //      free-text query (also asking for several candidates) and does the
  //      same evaluation there.
  //   3. Returns null if no candidate from either attempt resolves to the
  //      requested street/city/province -- a coordinate for the wrong
  //      street, wrong city, or a bare area centroid is not "this address."
  //   4. Otherwise returns the best candidate found, tagged
  //      `confidence: 'precise'` or `confidence: 'street'` -- informational
  //      only (see the field's own doc comment on GeocodeResult): the
  //      caller (routes/listings.ts) always requires landlord confirmation
  //      before treating EITHER as the exact private location, using this
  //      result only as the starting pin -- see verifyConfirmedPinLocation.
  //
  // This does NOT require Nominatim to have building/house-number-level
  // OSM data for the address to return SOMETHING -- a correctly-located
  // street-level match is still returned, just a worse starting pin than a
  // building-level one would have been.
  //
  // Left off (default false) for the renter-facing free-text location
  // search (routes/geocode.ts's GET /geocode), which searches for areas by
  // design ("Scarborough", "downtown Ottawa") and has no specific street to
  // match against in the first place.
  requirePreciseMatch?: boolean;
}

async function fetchNominatimCandidates(url: string, queryDescription: string): Promise<NominatimResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    logger.error(`Geocoding request failed for ${queryDescription}:`, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    logger.error(`Geocoding API rate-limited (429) for ${queryDescription}`);
    throw new GeocodingUnavailableError();
  }

  if (!response.ok) {
    logger.error(`Geocoding API returned ${response.status} for ${queryDescription}`);
    return [];
  }

  let results: unknown;
  try {
    results = await response.json();
  } catch (err) {
    logger.error(`Geocoding response was not valid JSON for ${queryDescription}:`, err);
    return [];
  }

  if (!Array.isArray(results) || results.length === 0) {
    logger.warn(`Geocoding found no match for ${queryDescription}`);
    return [];
  }

  return results as NominatimResult[];
}

function toGeocodeResult(
  top: NominatimResult,
  queryDescription: string,
  confidence?: 'precise' | 'street'
): GeocodeResult | null {
  const lat = parseFloat(String(top.lat));
  const lng = parseFloat(String(top.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    logger.error(`Geocoding returned a non-numeric coordinate for ${queryDescription}`);
    return null;
  }
  return confidence ? { lat, lng, confidence } : { lat, lng };
}

// Deliberately takes address/city/province only -- never a unit/apartment
// number. A unit is meaningless to a geocoder (it resolves buildings and
// streets, not individual units inside one) and including it risks a
// worse or failed match on an address that would otherwise geocode cleanly.
export async function geocodeAddress(
  address: string,
  city: string,
  province?: string | null,
  options: GeocodeOptions = {}
): Promise<GeocodeResult | null> {
  const { requirePreciseMatch = false } = options;

  if (!requirePreciseMatch) {
    // Renter free-text location search -- unchanged from before this whole
    // precision-gate pass: one free-text query, first result wins.
    const q = [address, city, province, 'Canada'].filter(Boolean).join(', ');
    const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'ca', q });
    const url = `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
    const queryDescription = `q="${q}" (free-text)`;

    const [top] = await fetchNominatimCandidates(url, queryDescription);
    return top ? toGeocodeResult(top, queryDescription) : null;
  }

  // ── Listing address pipeline: structured query, then a free-text
  // fallback, each pulling multiple candidates and evaluated against the
  // requested street/city/province (not against Nominatim's own precision
  // metadata alone -- see pickBestCandidate). ───────────────────────────────
  const provinceName = province ? (PROVINCE_NAMES[province.trim().toUpperCase()] ?? province) : undefined;

  const structuredParams = new URLSearchParams({
    format: 'jsonv2', limit: String(PRECISE_CANDIDATE_LIMIT), countrycodes: 'ca', addressdetails: '1',
    street: address, country: 'Canada',
  });
  if (city) structuredParams.set('city', city);
  if (provinceName) structuredParams.set('state', provinceName);
  const structuredUrl = `${NOMINATIM_SEARCH_URL}?${structuredParams.toString()}`;
  const structuredDescription = `street="${address}", city="${city}", state="${provinceName ?? ''}", country="Canada" (structured)`;

  const structuredCandidates = await fetchNominatimCandidates(structuredUrl, structuredDescription);
  const structuredBest = pickBestCandidate(structuredCandidates, address, city, province);
  if (structuredBest) {
    logger.info(
      `Geocoding (structured, ${structuredCandidates.length} candidate(s)) for [${structuredDescription}]: ` +
      `ACCEPTED (${structuredBest.status}) -- ${structuredBest.reason}`
    );
    return toGeocodeResult(structuredBest.candidate, structuredDescription, structuredBest.status);
  }
  if (structuredCandidates.length > 0) {
    logger.info(`Geocoding (structured, ${structuredCandidates.length} candidate(s)) for [${structuredDescription}]: no match, trying free-text fallback`);
  }

  // Structured query returned nothing valid (every candidate rejected, or
  // no candidates at all) -- try a free-text query built the same way the
  // renter-search path builds one, in case Nominatim's structured-field
  // matching missed an address its general search finds.
  const freeTextQuery = [address, city, provinceName ?? province, 'Canada'].filter(Boolean).join(', ');
  const freeTextParams = new URLSearchParams({
    format: 'jsonv2', limit: String(PRECISE_CANDIDATE_LIMIT), countrycodes: 'ca', addressdetails: '1', q: freeTextQuery,
  });
  const freeTextUrl = `${NOMINATIM_SEARCH_URL}?${freeTextParams.toString()}`;
  const freeTextDescription = `q="${freeTextQuery}" (free-text fallback)`;

  const freeTextCandidates = await fetchNominatimCandidates(freeTextUrl, freeTextDescription);
  const freeTextBest = pickBestCandidate(freeTextCandidates, address, city, province);
  if (!freeTextBest) {
    // Address exactly as entered found nothing at all (neither structured
    // nor free-text). If it looks like it's simply missing a street-type
    // suffix ("1031 Askin" instead of "1031 Askin Ave"), try appending the
    // common ones before giving up -- see tryStreetSuffixExpansion for the
    // exact same street/city/province validation and ambiguity guard as
    // every other attempt above.
    if (!hasRecognizedStreetSuffix(address)) {
      const suffixResult = await tryStreetSuffixExpansion(address, city, province, provinceName);
      if (suffixResult) return suffixResult;
    }
    logger.warn(`Geocoding rejected for "${address}, ${city}": no candidate from the structured query, free-text fallback, or street-suffix expansion resolved to the requested street/city/province.`);
    return null;
  }

  logger.info(
    `Geocoding (free-text fallback, ${freeTextCandidates.length} candidate(s)) for [${freeTextDescription}]: ` +
    `ACCEPTED (${freeTextBest.status}) -- ${freeTextBest.reason}`
  );
  return toGeocodeResult(freeTextBest.candidate, freeTextDescription, freeTextBest.status);
}
