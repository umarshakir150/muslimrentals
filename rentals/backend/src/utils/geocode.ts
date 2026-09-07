import { logger } from './logger';

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
 * ─── Provider plumbing (Geocodio evaluation spike, 2026-09) ─────────────────
 * Two providers are supported behind this exact same public interface
 * (geocodeAddress/verifyConfirmedPinLocation/GeocodeResult/
 * PinLocationVerification/GeocodingUnavailableError never change shape no
 * matter which is active) -- routes/listings.ts, routes/geocode.ts, and
 * every frontend caller depend only on that interface, never on which
 * provider is behind it:
 *
 *   - 'nominatim' (default) -- OpenStreetMap's free Nominatim search API,
 *     no API key/signup, consistent with this app already using OSM tiles
 *     for the map itself (FullMap.tsx). Free, but a shared public service:
 *     see the 429 handling below, added after a real production rate-limit
 *     incident (2026-09-06).
 *   - 'geocodio' -- api.geocod.io, evaluated as a paid-tier-free-for-our-
 *     scale replacement specifically because it (a) has real US/Canada
 *     government-sourced address data (StatCan/CanVecPlus) rather than
 *     generic OSM coverage, and (b) its terms explicitly allow storing
 *     results in our own database indefinitely -- which this app requires
 *     (the precise coordinate is a permanent Listing column), and which
 *     several other providers restrict or charge extra for. Selected via
 *     GEOCODING_PROVIDER=geocodio + GEOCODIO_API_KEY (server-side only --
 *     never sent to or read by the frontend, which never talks to any
 *     geocoding provider directly; it only ever calls this app's own
 *     GET /geocode and POST/PATCH /listings routes).
 *
 * Both providers' raw responses are normalized into the same internal
 * GeocodeCandidate shape (originally Nominatim's own field names, kept as
 * the canonical shape since it already carried everything needed) before
 * evaluateAddressMatch/pickBestCandidate ever see them -- the actual
 * street/city/province matching rules, the 'precise' vs 'street'
 * distinction, and the missing-street-suffix fallback are all completely
 * provider-agnostic and were not touched by adding Geocodio.
 */

// Thrown (never silently swallowed as "no results") when a geocoding
// provider itself says it can't currently serve the request -- a distinct
// condition from "no candidate matched" that must never be presented to a
// landlord/renter as "check your spelling"/"could not find that location".
// Also serves as the fail-fast signal that stops geocodeAddress's free-text
// fallback and tryStreetSuffixExpansion's up-to-10-request loop from
// continuing to hammer an already-unavailable provider with more requests.
export class GeocodingUnavailableError extends Error {
  constructor(message = 'Geocoding provider rate-limited this request.') {
    super(message);
    this.name = 'GeocodingUnavailableError';
  }
}

// A specific KIND of "unavailable": the provider is configured wrong (no
// API key at all, or the key it has was rejected) rather than genuinely
// rate-limited/overloaded. Kept as a subclass (not a sibling type) so every
// existing `err instanceof GeocodingUnavailableError` check in
// routes/geocode.ts and routes/listings.ts already catches this too,
// without those call sites needing to know two error types exist -- they're
// both "we can't geocode right now" from the caller's perspective. Exported
// separately only so logs/tests can tell a misconfiguration apart from a
// real provider outage.
export class GeocodingConfigError extends GeocodingUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodingConfigError';
  }
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'MuslimRentals/1.0 (https://muslimrentals.ca)';
const REQUEST_TIMEOUT_MS = 8_000;

const GEOCODIO_BASE_URL = 'https://api.geocod.io/v2';

// How many candidates to pull back per query for the listing-address
// pipeline (requirePreciseMatch only -- the renter free-text location
// search still asks for exactly 1, see below). A provider's own relevance
// ranking sometimes puts a street-level result first even when a
// house/building-level result for the SAME street/city/province exists
// further down the list -- asking for one candidate and taking it meant
// settling for the street-level result even when a better one was
// available. 5 is enough headroom to surface a better match without
// meaningfully increasing request cost against Nominatim's ~1req/s policy
// (still exactly one HTTP request per query attempt -- this only changes
// `limit=`, not the number of requests made).
const PRECISE_CANDIDATE_LIMIT = 5;

// Nominatim's structured `state=` field (and Geocodio's own state-name
// matching) resolve noticeably more reliably against the full
// province/territory name than against the 2-letter code this app stores
// everywhere else (CityAutocomplete/data/cities.ts) -- e.g. "state=Ontario"
// resolves consistently; "state=ON" is left to fuzzier matching, which is
// exactly the kind of avoidable imprecision this map exists to remove.
// Falls back to the raw value for anything already spelled out or
// genuinely unrecognized, rather than dropping it. normalizeProvinceName
// below also uses this map in reverse (code <-> full name both normalize
// to the same lowercase form), so a provider that returns the 2-letter
// code back (Geocodio does) compares correctly against a full name too.
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
  //   precision -- can legitimately be a couple hundred meters from the
  //   actual property, which is exactly why the landlord still
  //   confirms/drags the pin before anything is stored.
  confidence?: 'precise' | 'street';
}

interface CandidateAddressDetails {
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

// The canonical, provider-agnostic shape every raw provider response gets
// normalized into before any match-evaluation logic runs. Originated as
// (and is still shaped like) Nominatim's own jsonv2 result -- kept as the
// one shared shape rather than introducing a second one, since it already
// carries everything evaluateAddressMatch needs. class/category/type/
// place_rank/importance are Nominatim-specific relevance metadata used
// only for diagnostic logging (see evaluateAddressMatch's `meta` string);
// a provider that doesn't have an equivalent (Geocodio) just leaves them
// undefined and logs its own accuracy_type there instead (see
// geocodioResultToCandidate).
interface GeocodeCandidate {
  lat?: unknown;
  lon?: unknown;
  address?: CandidateAddressDetails;
  class?: string;
  category?: string;
  type?: string;
  place_rank?: number;
  importance?: number;
  display_name?: string;
}

interface MatchEvaluation {
  status: 'precise' | 'street' | 'rejected';
  // Sanitized, log-safe reasoning -- category/type/rank/importance, an
  // address breakdown, and display_name (all data the provider already
  // returns for the address as typed; never the resolved lat/lon, and
  // never surfaced in any API response -- this is diagnostic-log-only, per
  // the explicit ask to "log/report enough sanitized metadata... but do
  // not expose private coordinates").
  reason: string;
}

// ─── Canadian address component normalization ──────────────────────────────
// Goal: get a geographically useful coordinate for the entered address, not
// certify house-number-level building data against the provider. So instead
// of gating on the provider's own precision metadata (which penalizes a
// real address purely because the provider hasn't mapped that specific
// building) to decide ACCEPT/REJECT, that metadata is used only to grade an
// already-accepted (right street/city/province) result into 'precise' vs
// 'street' -- see evaluateAddressMatch. A result is rejected only when it
// resolves to a different street/city/province, or to no street at all (a
// bare city/neighbourhood/province centroid).
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
// match at all from a literal query -- neither provider guesses a suffix on
// its own for a STRUCTURED query. This is the real, motivating case (a
// genuine Windsor, ON address). Two distinct word lists do two distinct jobs
// here:
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
//   (see tryStreetSuffixExpansion), one structured query each, only when
//   the address as entered found nothing at all. Deliberately just the
//   handful of suffixes that cover the large majority of Canadian street
//   addresses, not an exhaustive list -- this is a fallback for the common
//   case of an omitted suffix, not a general spell-checker.
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
    // the number; a provider's own road/street field never does.
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
// full code: a provider's postcode for a street-level result is often a
// representative point along the street, not literally the requested
// building's own code (and Geocodio specifically only ever returns the FSA
// for Canada unless the caller already supplied a full code -- see
// geocodioResultToCandidate). Informational corroboration only (see
// below), never a rejection reason on its own.
function extractCanadianFsa(input: string): string | null {
  const match = input.toUpperCase().match(/[A-Z]\d[A-Z]/);
  return match ? match[0] : null;
}

export interface PinLocationVerification {
  ok: boolean;
  // Sanitized, log-safe reason (e.g. "resolves to Toronto, not Windsor") --
  // never the coordinate itself, same stance as every other diagnostic
  // string in this file. Safe to surface directly in the 422 error message
  // routes/listings.ts returns to the landlord.
  reason: string;
}

// ─── Provider selection ─────────────────────────────────────────────────────
// Read lazily (not cached at module load) so tests can flip
// process.env.GEOCODING_PROVIDER per-test without needing to re-import this
// module -- the same pattern every other env-driven check in this codebase
// already uses (e.g. routes/listings.ts's AWS_CONFIGURED is the one
// exception, cached at import time, precisely because it backs a top-level
// `new S3Client(...)` call; nothing here needs that).
type GeocodingProviderName = 'nominatim' | 'geocodio';

function getActiveProviderName(): GeocodingProviderName {
  return (process.env.GEOCODING_PROVIDER || '').trim().toLowerCase() === 'geocodio' ? 'geocodio' : 'nominatim';
}

// Never logged, never returned in any response -- read once per call site
// that needs it, straight from server-side environment configuration. The
// frontend has no code path that could ever see this: it never talks to
// Geocodio directly, only to this app's own GET /geocode and POST/PATCH
// /listings routes (see the file-level comment above).
function getGeocodioApiKey(): string {
  const key = process.env.GEOCODIO_API_KEY;
  if (!key || !key.trim()) {
    throw new GeocodingConfigError(
      'GEOCODING_PROVIDER=geocodio but GEOCODIO_API_KEY is not set. Refusing to call Geocodio without a key rather than silently falling back to a different provider.'
    );
  }
  return key.trim();
}

// Classifies a non-OK HTTP status from either provider into how the caller
// should react -- shared so both providers fail the exact same way for the
// exact same class of problem, and so this policy exists in exactly one
// place:
//   'auth'        -- the key is missing/invalid/rejected. A config problem,
//                    not a transient one -- retrying the same request won't
//                    help until the key itself is fixed.
//   'unavailable' -- rate-limited (429) or the provider's own server is
//                    erroring (5xx). Transient; the address/pin itself is
//                    not the problem.
//   null          -- anything else (a 4xx like 422 for genuinely malformed
//                    input) is treated as "no usable candidate", exactly
//                    like an empty result set, not a provider failure.
function classifyProviderFailure(status: number): 'auth' | 'unavailable' | null {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || status >= 500) return 'unavailable';
  return null;
}

// ─── Nominatim provider ──────────────────────────────────────────────────────

async function fetchNominatimJson(url: string, providerLabel: string, queryDescription: string): Promise<unknown | null> {
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
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const failure = classifyProviderFailure(response.status);
  if (failure === 'auth') {
    logger.error(`${providerLabel} rejected the request (status ${response.status}) for ${queryDescription} -- check credentials.`);
    throw new GeocodingConfigError(`${providerLabel} rejected the request (status ${response.status}).`);
  }
  if (failure === 'unavailable') {
    logger.error(`${providerLabel} is rate-limited or unavailable (status ${response.status}) for ${queryDescription}`);
    throw new GeocodingUnavailableError();
  }
  if (!response.ok) {
    logger.error(`${providerLabel} returned ${response.status} for ${queryDescription}`);
    return null;
  }

  try {
    return await response.json();
  } catch (err) {
    logger.error(`${providerLabel} response was not valid JSON for ${queryDescription}:`, err);
    return null;
  }
}

async function fetchNominatimCandidates(url: string, queryDescription: string): Promise<GeocodeCandidate[]> {
  const results = await fetchNominatimJson(url, 'Nominatim', queryDescription);
  if (!Array.isArray(results) || results.length === 0) {
    logger.warn(`Geocoding found no match for ${queryDescription}`);
    return [];
  }
  return results as GeocodeCandidate[];
}

async function nominatimReverse(lat: number, lng: number, description: string): Promise<CandidateAddressDetails | null> {
  const params = new URLSearchParams({
    format: 'jsonv2', lat: String(lat), lon: String(lng), addressdetails: '1', zoom: '16',
  });
  const url = `${NOMINATIM_REVERSE_URL}?${params.toString()}`;

  const result = await fetchNominatimJson(url, 'Nominatim', description) as { address?: CandidateAddressDetails } | null;
  return result?.address ?? null;
}

// ─── Geocodio provider ───────────────────────────────────────────────────────
// https://api.geocod.io/v2/{geocode,reverse} -- REST + API key in the query
// string (server-side only, see getGeocodioApiKey), JSON in/out, no SDK.
// Response shape (default, non-"simple" format):
//   { results: [{ address_components: {number, street, suffix, city,
//     state, zip, ...}, formatted_address, location: {lat, lng},
//     accuracy, accuracy_type, source }, ...] }
interface GeocodioAddressComponents {
  number?: string;
  predirectional?: string;
  street?: string;
  suffix?: string;
  postdirectional?: string;
  formatted_street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface GeocodioResult {
  address_components?: GeocodioAddressComponents;
  formatted_address?: string;
  location?: { lat?: unknown; lng?: unknown };
  accuracy?: number;
  accuracy_type?: string;
  source?: string;
}

// accuracy_type values that mean "resolved to a real building/rooftop
// point, not just an interpolated guess along the street" -- see the
// house_number note below for why this can't just be "was a house number
// present in the input".
const GEOCODIO_PRECISE_ACCURACY_TYPES = new Set(['rooftop', 'point', 'nearest_rooftop_match']);
// accuracy_type values that mean "no real street match at all" -- a bare
// city or province/state centroid, the Geocodio equivalent of Nominatim
// returning a result with no `address.road`.
const GEOCODIO_NO_STREET_ACCURACY_TYPES = new Set(['place', 'state']);

// Normalizes one Geocodio result into the shared GeocodeCandidate shape.
//
// Deliberately NOT a straight field-for-field mapping of house_number:
// Geocodio's `address_components.number` is the NUMBER AS PARSED FROM THE
// INPUT, echoed back even for a range_interpolation/street_center match
// where Geocodio itself is only guessing a point along the street, not
// confirming a real building exists there. Nominatim's `address.house_number`
// by contrast is only ever populated when the underlying map data actually
// has a mapped building at that number. Naively copying
// address_components.number into GeocodeCandidate.address.house_number
// would make evaluateAddressMatch call every Geocodio match 'precise'
// whenever the landlord's input happened to include a number -- which is
// always, since every real street address has one -- silently discarding
// Geocodio's own, more informative accuracy_type distinction. So:
// house_number is only populated here when accuracy_type itself claims
// building-level precision; road/city/state are withheld entirely for a
// bare place/state-level match, so the shared "no street in the address
// breakdown" rejection fires exactly like it does for Nominatim.
function geocodioResultToCandidate(result: GeocodioResult): GeocodeCandidate {
  const c = result.address_components ?? {};
  const isNoStreetMatch = GEOCODIO_NO_STREET_ACCURACY_TYPES.has(result.accuracy_type ?? '');
  const isPreciseMatch = GEOCODIO_PRECISE_ACCURACY_TYPES.has(result.accuracy_type ?? '');

  const road = isNoStreetMatch
    ? undefined
    : (c.formatted_street || [c.predirectional, c.street, c.suffix, c.postdirectional].filter(Boolean).join(' ') || undefined);

  return {
    lat: result.location?.lat,
    lon: result.location?.lng,
    address: isNoStreetMatch ? undefined : {
      house_number: isPreciseMatch ? c.number : undefined,
      road,
      city: c.city,
      state: c.state,
      postcode: c.zip,
    },
    // No Nominatim-style class/place_rank/importance equivalent -- logged
    // via `type` instead so evaluateAddressMatch's diagnostic `meta` string
    // still shows Geocodio's own confidence signal.
    type: result.accuracy_type,
    display_name: result.formatted_address,
  };
}

async function fetchGeocodioJson(url: string, queryDescription: string): Promise<{ results: GeocodioResult[] } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    logger.error(`Geocoding request failed for ${queryDescription}:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const failure = classifyProviderFailure(response.status);
  if (failure === 'auth') {
    logger.error(`Geocodio rejected the request (status ${response.status}) for ${queryDescription} -- check GEOCODIO_API_KEY.`);
    throw new GeocodingConfigError(`Geocodio rejected the API key (status ${response.status}).`);
  }
  if (failure === 'unavailable') {
    logger.error(`Geocodio is rate-limited or unavailable (status ${response.status}) for ${queryDescription}`);
    throw new GeocodingUnavailableError();
  }
  if (!response.ok) {
    logger.error(`Geocodio returned ${response.status} for ${queryDescription}`);
    return null;
  }

  try {
    return (await response.json()) as { results: GeocodioResult[] };
  } catch (err) {
    logger.error(`Geocodio response was not valid JSON for ${queryDescription}:`, err);
    return null;
  }
}

async function fetchGeocodioCandidates(url: string, queryDescription: string): Promise<GeocodeCandidate[]> {
  const body = await fetchGeocodioJson(url, queryDescription);
  const results = body?.results;
  if (!results || results.length === 0) {
    logger.warn(`Geocoding found no match for ${queryDescription}`);
    return [];
  }
  return results.map(geocodioResultToCandidate);
}

async function geocodioReverse(lat: number, lng: number, description: string): Promise<CandidateAddressDetails | null> {
  const apiKey = getGeocodioApiKey();
  const params = new URLSearchParams({ q: `${lat},${lng}`, api_key: apiKey });
  const url = `${GEOCODIO_BASE_URL}/reverse?${params.toString()}`;

  const body = await fetchGeocodioJson(url, description);
  const top = body?.results?.[0];
  if (!top) return null;
  const c = top.address_components ?? {};
  return { city: c.city, state: c.state };
}

// ─── Provider-agnostic candidate fetch ──────────────────────────────────────
// Builds the actual provider-specific request (URL, params, API key) and
// returns normalized candidates -- everything above this point in the file
// (evaluateAddressMatch, pickBestCandidate, tryStreetSuffixExpansion,
// geocodeAddress) calls only this, never a provider's fetch function
// directly, so adding a third provider later never touches that shared
// logic either.
type CandidateQuery =
  | { kind: 'structured'; street: string; city: string; provinceName?: string }
  | { kind: 'freeText'; q: string };

async function fetchCandidates(query: CandidateQuery, queryDescription: string): Promise<GeocodeCandidate[]> {
  const provider = getActiveProviderName();

  if (provider === 'geocodio') {
    const apiKey = getGeocodioApiKey();
    const params = query.kind === 'structured'
      ? new URLSearchParams({
          street: query.street, city: query.city, country: 'CA', api_key: apiKey,
          ...(query.provinceName ? { state: query.provinceName } : {}),
        })
      : new URLSearchParams({ q: query.q, api_key: apiKey });
    const url = `${GEOCODIO_BASE_URL}/geocode?${params.toString()}`;
    return fetchGeocodioCandidates(url, queryDescription);
  }

  const params = query.kind === 'structured'
    ? new URLSearchParams({
        format: 'jsonv2', limit: String(PRECISE_CANDIDATE_LIMIT), countrycodes: 'ca', addressdetails: '1',
        street: query.street, city: query.city, country: 'Canada',
        ...(query.provinceName ? { state: query.provinceName } : {}),
      })
    : new URLSearchParams({ format: 'jsonv2', limit: String(PRECISE_CANDIDATE_LIMIT), countrycodes: 'ca', addressdetails: '1', q: query.q });
  const url = `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
  return fetchNominatimCandidates(url, queryDescription);
}

// Judges whether a candidate resolves to the requested address's street, in
// the requested city, in the requested province, and if so how precisely:
// 'precise' when the address breakdown carries a house_number (a real
// building-level point), 'street' when street+city+province match but no
// house_number is present. Rejects only a wrong street, a wrong city, a
// wrong province, or a result with no street at all (a city/neighbourhood/
// province centroid). Provider-agnostic -- operates purely on the
// normalized GeocodeCandidate shape.
function evaluateAddressMatch(
  result: GeocodeCandidate,
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
  return { status: 'street', reason: `street-level match only -- no confirmed building-level point for this address (${meta})` };
}

// Scans every candidate a query returned and picks the best one: any
// 'precise' candidate beats any 'street' candidate, regardless of which
// came first in the provider's own relevance ordering -- this is the
// "candidate improvement": a query's #1 result being street-level no
// longer means settling for street-level if a #3 or #4 result on the same
// street/city/province turns out to carry a house_number. 'rejected'
// candidates (wrong street/city/province, or no street at all) are never
// considered, no matter how "precise" their own metadata looks -- a
// building-level point on the wrong street is not a better answer than a
// street-level point on the right one.
interface BestCandidate {
  candidate: GeocodeCandidate;
  status: 'precise' | 'street';
  reason: string;
}

function pickBestCandidate(
  candidates: GeocodeCandidate[],
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
// each of SUFFIX_EXPANSION_CANDIDATES in turn as a STRUCTURED query (so the
// provider knows this is specifically the street field, not a free-text
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
// result, that's genuine ambiguity -- refuse to guess and return null, same
// as if nothing had matched at all. A GeocodingUnavailableError from any
// attempt propagates immediately, aborting the remaining candidates rather
// than continuing to hammer an already-unavailable provider.
async function tryStreetSuffixExpansion(
  address: string,
  city: string,
  province: string | null | undefined,
  provinceName: string | undefined
): Promise<GeocodeResult | null> {
  const accepted: Array<BestCandidate & { expandedStreet: string }> = [];

  for (const suffix of SUFFIX_EXPANSION_CANDIDATES) {
    const expandedStreet = `${address} ${suffix}`;
    const description = `street="${expandedStreet}", city="${city}", state="${provinceName ?? ''}", country="Canada" (suffix-expansion fallback)`;

    const candidates = await fetchCandidates({ kind: 'structured', street: expandedStreet, city, provinceName }, description);
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
  //   1. Uses the provider's STRUCTURED query fields (street/city/state/
  //      country) instead of one free-text string, requesting several
  //      candidates (see PRECISE_CANDIDATE_LIMIT) rather than just the top
  //      one. Structured fields resolve more reliably than one joined
  //      string when the caller genuinely knows which part of the input is
  //      the street vs. the city/region -- which the listing Post/Edit
  //      form does (separate address/city/province fields), unlike a
  //      renter's free-text location search.
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
  // This does NOT require the provider to have building/house-number-level
  // data for the address to return SOMETHING -- a correctly-located
  // street-level match is still returned, just a worse starting pin than a
  // building-level one would have been.
  //
  // Left off (default false) for the renter-facing free-text location
  // search (routes/geocode.ts's GET /geocode), which searches for areas by
  // design ("Scarborough", "downtown Ottawa") and has no specific street to
  // match against in the first place.
  requirePreciseMatch?: boolean;
}

function toGeocodeResult(
  top: GeocodeCandidate,
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
    const queryDescription = `q="${q}" (free-text)`;

    const [top] = await fetchCandidates({ kind: 'freeText', q }, queryDescription);
    return top ? toGeocodeResult(top, queryDescription) : null;
  }

  // ── Listing address pipeline: structured query, then a free-text
  // fallback, each pulling multiple candidates and evaluated against the
  // requested street/city/province (not against the provider's own
  // precision metadata alone -- see pickBestCandidate). ────────────────────
  const provinceName = province ? (PROVINCE_NAMES[province.trim().toUpperCase()] ?? province) : undefined;

  const structuredDescription = `street="${address}", city="${city}", state="${provinceName ?? ''}", country="Canada" (structured)`;
  const structuredCandidates = await fetchCandidates({ kind: 'structured', street: address, city, provinceName }, structuredDescription);
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
  // renter-search path builds one, in case the provider's structured-field
  // matching missed an address its general search finds.
  const freeTextQuery = [address, city, provinceName ?? province, 'Canada'].filter(Boolean).join(', ');
  const freeTextDescription = `q="${freeTextQuery}" (free-text fallback)`;
  const freeTextCandidates = await fetchCandidates({ kind: 'freeText', q: freeTextQuery }, freeTextDescription);
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

// ─── Landlord-confirmed-pin geography check ────────────────────────────────
// The universal confirm-property-location flow (routes/listings.ts) cannot
// validate a landlord-placed pin by measuring its distance from
// geocodeAddress's own starting point -- that point is exactly what
// confirmation exists to let the landlord CORRECT, and a real case proved
// it can be off by more than 5km for a genuine address. Measuring "distance
// from a possibly-wrong point" would reject the landlord's legitimate fix
// for being too far from the very mistake it's fixing.
//
// Instead, this reverse-geocodes the CONFIRMED pin itself and checks its
// own city/province against what the landlord actually entered -- the
// thing that actually matters ("is this plausibly in Windsor, ON") is
// independent of how far the pin ended up from any earlier guess. A pin
// several km away, still within the entered city, is accepted; a pin in a
// different city (Toronto instead of Windsor) is rejected regardless of
// distance. Provider-agnostic: only the actual reverse-geocode call below
// is provider-specific, via the same getActiveProviderName() switch every
// other function in this file uses.
export async function verifyConfirmedPinLocation(
  lat: number,
  lng: number,
  city: string,
  province?: string | null
): Promise<PinLocationVerification> {
  // Never includes the actual coordinate -- same "diagnostic metadata only,
  // never the private location" stance as every other query description in
  // this file.
  const description = `reverse geocode of the landlord-confirmed pin (verifying against city="${city}", state="${province ?? ''}")`;

  let addr: CandidateAddressDetails | null;
  try {
    addr = getActiveProviderName() === 'geocodio'
      ? await geocodioReverse(lat, lng, description)
      : await nominatimReverse(lat, lng, description);
  } catch (err) {
    if (err instanceof GeocodingUnavailableError) throw err;
    logger.error(`Reverse geocoding request failed for ${description}:`, err);
    return { ok: false, reason: "we couldn't verify that location right now (reverse geocoding request failed)" };
  }

  if (!addr) {
    return { ok: false, reason: "we couldn't verify that location right now (reverse geocoding service error)" };
  }

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
  // country's rural area) must not be silently accepted just because the
  // provider had nothing to compare against.
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
