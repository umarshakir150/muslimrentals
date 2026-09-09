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
 * provider is behind it. searchPlaces (below, added for the Browse
 * place/POI-search feature) is the one exception: it always uses Nominatim
 * regardless of GEOCODING_PROVIDER, since Geocodio has no general place/POI
 * search product to switch to in the first place -- see its own doc comment.
 *
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
  // Only ever set by geocodeFullAddress (Browse's manual full-address
  // Search/Enter resolve, see that function's own doc comment) -- the raw
  // Geocodio accuracy_type string for the accepted candidate (e.g.
  // 'rooftop', 'range_interpolation'), so a lower-confidence-but-still-
  // useful match can be identified precisely, not just coarsely graded.
  accuracyType?: string;
  // Same accepted-but-not-rooftop distinction as accuracyType, collapsed to
  // the two states a caller actually needs to act on: 'exact' means place
  // the marker with full confidence; 'approximate' means the coordinate is
  // genuinely on/near the right building but was only interpolated, not
  // confirmed rooftop-precise -- never silently presented as identical to
  // 'exact'.
  precision?: 'exact' | 'approximate';
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
  // Only ever populated for Nominatim (via addressdetails=1) -- the
  // ISO 3166-1 alpha-2 country code Nominatim itself resolved the result
  // to. Used exclusively as a defense-in-depth double-check in searchPlaces
  // (see its own doc comment): the query-level `countrycodes=ca` filter is
  // the primary restriction, but a firm Canada-only guarantee for that
  // feature means not trusting the query parameter alone.
  country_code?: string;
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
  // Only ever populated for Geocodio (its own 0-1 accuracy score,
  // alongside `type` carrying its accuracy_type string) -- diagnostic-log
  // use only, same stance as importance/place_rank above.
  accuracy?: number;
  display_name?: string;
  // Only ever populated when the query requested `namedetails=1` (see
  // searchPlaces below) -- Nominatim's full breakdown of every name-related
  // tag an OSM element carries (name, alt_name, old_name, official_name,
  // short_name, language variants, ...), keyed by tag name. Never affects
  // which candidates a query MATCHES (that's governed entirely by
  // Nominatim's own search index); only lets a caller see WHICH of an
  // element's names its query actually matched, so a result can be labeled
  // with the name a searcher will recognize rather than always whichever
  // name happens to be primary on the map.
  namedetails?: Record<string, string>;
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
// accuracy_type values that are still a genuinely useful ADDRESS match --
// Geocodio estimated a point along the correct street segment between two
// known addresses -- but not confirmed rooftop-precise. Used only by
// geocodeFullAddress (Browse's manual full-address resolve) to accept and
// clearly mark a result as approximate rather than reject it outright;
// deliberately NOT added to GEOCODIO_PRECISE_ACCURACY_TYPES above, which
// several OTHER call sites (evaluateAddressMatch's precise/street grading
// for the listing-address pipeline) depend on meaning "rooftop-confirmed"
// specifically.
const GEOCODIO_APPROXIMATE_ADDRESS_ACCURACY_TYPES = new Set(['range_interpolation']);
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
      // Geocodio's own resolved country for this result (echoed back in the
      // same shape structured requests send it in, e.g. "CA") -- normalized
      // to lowercase so it can be checked with the exact same defense-in-
      // depth pattern searchPlaces() already uses for Nominatim's
      // country_code (see geocodeFullAddress below).
      country_code: c.country ? c.country.toLowerCase() : undefined,
    },
    // No Nominatim-style class/place_rank/importance equivalent -- logged
    // via `type` instead so evaluateAddressMatch's diagnostic `meta` string
    // still shows Geocodio's own confidence signal.
    type: result.accuracy_type,
    accuracy: result.accuracy,
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

export interface PlaceSuggestion {
  // A short, human-readable label built from the provider's own address
  // breakdown (see toPlaceSuggestion) -- shown directly in the renter-facing
  // autocomplete dropdown (LocationRadiusSearch.tsx), never a raw internal
  // shape.
  label: string;
  lat: number;
  lng: number;
}

// How many place-search candidates to REQUEST from Nominatim -- a wider
// INTERNAL pool than what's ever shown (see DISPLAY_SUGGESTION_LIMIT
// below). Nominatim ranks its own results by a mix of text-match quality
// and general importance; for a multi-word or partial query the intended
// match can easily sit outside Nominatim's own top handful even though it
// genuinely matches everything typed so far. Fetching a wider pool and
// re-ranking it locally (see scoreCandidateRelevance) is what actually
// fixes that -- raising this alone, without local re-ranking, was already
// tried and wasn't enough (a founder-reported symptom: "Vincent Massey"
// staying dominated by unrelated "Vincent"-only matches while typing).
//
// Raised from 15 -> 30 (2026-09-09, founder-reported "the dropdown misses
// many real places") -- still comfortably under Nominatim's own documented
// `limit` ceiling of 40 for the /search endpoint, and this only changes how
// many results ONE request asks for, not how often requests are made, so it
// does not affect the app's Nominatim rate-limit exposure (see the 429
// handling elsewhere in this file). A bigger fetch pool can only ever add
// candidates the local re-ranking below gets to consider -- it never
// changes which candidates Nominatim itself decided to match in the first
// place; that ceiling is the still-unresolved Nominatim autocomplete-policy
// issue tracked separately as a PR #21 merge blocker.
const NOMINATIM_FETCH_LIMIT = 30;

// How many suggestions are actually shown, after local re-ranking and
// dedup. Kept modest and separate from the fetch pool above -- widening
// the fetch pool improves WHICH candidates are available to rank; this is
// purely about not dumping a wall of noisy results into the dropdown.
// Raised from 8 -> 10 alongside the fetch-pool widening above, so a wider
// candidate pool can actually surface as more distinct, diverse places in
// the dropdown rather than being cut off at the old, narrower window.
const DISPLAY_SUGGESTION_LIMIT = 10;

// The alternate-name OSM tags Nominatim's `namedetails=1` can return
// alongside an element's primary `name` -- checked, in this order, when the
// searched text doesn't match the primary name at all (see
// findMatchingNameAlias below). Deliberately just these four well-
// established, generic OSM name tags -- not a curated list of specific
// known renames, and not a fuzzy/edit-distance match against arbitrary
// text: this generalizes to ANY renamed or aliased place OSM has tagged
// this way, never to a specific building.
const ALTERNATE_NAME_TAGS = ['alt_name', 'old_name', 'official_name', 'short_name'];

function namesLooselyMatch(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na));
}

// Nominatim's search index already matches a query against ANY name tag an
// OSM element carries, not just its primary `name` -- `namedetails=1` is
// what lets this app SEE which one actually matched. A building renamed
// after a naming-rights gift (the motivating real case) is often still
// tagged `name=<old name>` with the new name only present as `alt_name` or
// `old_name` until a mapper updates the primary tag; without this, a
// genuinely correct match would display under a name the searcher never
// typed and won't recognize -- indistinguishable from "nothing found" even
// though Nominatim did find the right place. OSM tags can list several
// alternates separated by `;` (e.g. `alt_name=Foo;Bar`) -- each is checked
// individually. Returns undefined (no substitution) whenever the primary
// name already reasonably matches the query, or no alias does either.
function findMatchingNameAlias(
  namedetails: Record<string, string> | undefined,
  query: string,
  primaryName: string | undefined
): string | undefined {
  if (!namedetails || !query.trim()) return undefined;
  if (primaryName && namesLooselyMatch(primaryName, query)) return undefined;

  for (const tag of ALTERNATE_NAME_TAGS) {
    const raw = namedetails[tag];
    if (!raw) continue;
    for (const candidate of raw.split(';')) {
      if (namesLooselyMatch(candidate, query)) return candidate.trim();
    }
  }
  return undefined;
}

// Builds a short, readable label for the autocomplete dropdown: the
// provider's own most-specific identifier (a named POI's actual name, or a
// full street address) plus city/province context -- never just
// reconstructed from the address breakdown alone, which has no "name"
// field at all and would silently drop a searched-for POI's name entirely
// (address.road is only ever the street it's ON, e.g. a search for "Toldo
// Lancer Centre" would otherwise resolve to a suggestion labeled just
// "Sunset Avenue, Windsor, Ontario" -- accurate, but useless for confirming
// this is actually the building the renter searched for).
//
// Nominatim's own `display_name` puts the most specific element first --
// for a named place, that's the name itself; for a plain address match,
// it's the same "house_number road" the breakdown already has. Using
// whichever of those is MORE specific (i.e. differs from the plain street
// line) as the label's first segment means a POI keeps its name and a
// plain address search looks exactly like it did before this function
// existed. `query` (the searcher's own text) additionally lets a renamed/
// aliased POI surface under the name actually searched for -- see
// findMatchingNameAlias.
function toPlaceSuggestionLabel(candidate: GeocodeCandidate, query: string): string {
  const addr = candidate.address ?? {};
  const locality = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.hamlet;
  const streetLine = [addr.house_number, addr.road].filter(Boolean).join(' ') || undefined;
  const firstSegment = candidate.display_name?.split(',')[0]?.trim() || undefined;
  let primary = firstSegment && firstSegment !== streetLine ? firstSegment : streetLine;

  const alias = findMatchingNameAlias(candidate.namedetails, query, primary);
  if (alias) primary = alias;

  const parts = [primary, locality, addr.state].filter((p): p is string => Boolean(p && p.trim()));

  if (parts.length > 0) return parts.join(', ');
  return candidate.display_name ?? 'Unknown location';
}

// Builds the Nominatim query params for a place/POI search. `layer` is set
// EXPLICITLY to 'address,poi' rather than left to Nominatim's own server-
// side default -- named-landmark search (a gym, mosque, university
// building, or mall) is a POI-layer query by definition, and this removes
// any dependency on an undocumented/version-specific default ever silently
// excluding that layer.
//
// `countrycodes=ca` is a FIRM, single-tier restriction -- there is
// deliberately no second attempt that relaxes it. An earlier version of
// this function retried with a soft Canada-wide `viewbox`+`bounded=0` bias
// (which does NOT exclude non-Canadian results, only prefers them) when the
// hard-filtered query found nothing, specifically to recover the rare case
// of a genuinely Canadian point whose own OSM country tagging is wrong.
// Removed by explicit founder direction: this app currently only needs
// Canada, and a soft geographic bias is not actually Canada-only -- a
// rectangle bounding box that covers all of Canada's latitude/longitude
// range also covers nearly the entire northern half of the continental US,
// so that fallback could genuinely surface a US result (e.g. a
// cross-border query near Windsor/Detroit). Reliable Canada-only
// autocomplete is worth more than recovering that edge case; see
// searchPlaces's own doc comment for the defense-in-depth country_code
// check that backs this up further.
function buildPlaceSearchParams(query: string): URLSearchParams {
  return new URLSearchParams({
    format: 'jsonv2',
    limit: String(NOMINATIM_FETCH_LIMIT),
    addressdetails: '1',
    // Lets a matched candidate's full name-tag breakdown (alt_name,
    // old_name, official_name, short_name, ...) be seen in the response --
    // never affects which candidates a query matches, only what this app
    // can see about the ones Nominatim already decided to return. See
    // findMatchingNameAlias.
    namedetails: '1',
    layer: 'address,poi',
    countrycodes: 'ca',
    q: query,
  });
}

// ─── Local relevance re-ranking ─────────────────────────────────────────────
// Nominatim returns candidates in ITS OWN relevance order (text-match
// quality + general importance/geography) -- this app previously passed
// that order straight through unchanged (aside from raising the fetch
// limit above). That's fine for a single, unambiguous word, but for a
// genuinely multi-word, partially-typed query it produces the wrong
// intuition: Nominatim has no notion of "the user is mid-typing a specific
// phrase and every token typed so far matters equally", so a highly-
// "important" place matching only the FIRST word can rank ahead of a
// less-prominent place that matches EVERY typed word (a founder-reported
// real symptom: "Vincent Mass" staying dominated by unrelated
// "Vincent"-only results, sometimes until the name was nearly complete).
// This section re-ranks the fetched pool locally, using Nominatim's own
// order only as a stable-sort tiebreaker -- provider/geographic relevance
// stays a real, useful secondary signal, just no longer the ONLY one.
//
// Deliberately NOT fuzzy/edit-distance matching: every rule below is exact
// (normalized) token equality or exact prefix matching, so this can never
// promote a genuinely unrelated place just because it "looks similar".
// Nothing here is specific to any one place name -- see the tests using
// synthetic examples, not "Toldo"/"Vincent Massey" themselves, to prove it.

// Tokens shorter than this contribute NO prefix-match signal at all --
// this is what keeps a single keystroke ("T") from artificially promoting
// any specific place: with no meaningful token to match against yet, every
// candidate scores identically (TIER_NONE) and Nominatim's own original
// order stands untouched, i.e. genuinely broad, unpromoted results. As
// soon as a token reaches this length, it starts contributing real signal.
const MIN_MEANINGFUL_TOKEN_LENGTH = 2;

// Discrete relevance tiers (spaced 1000 apart) matching the founder's own
// priority ladder, strongest to weakest. Only ever compared against each
// other via scoreCandidateRelevance below -- the absolute numbers don't
// mean anything outside that comparison.
const TIER_EXACT_PHRASE = 5000;       // 1. exact normalized phrase/name match
const TIER_FULL_PREFIX_PHRASE = 4000; // 2. candidate name starts with the entire typed phrase (as complete words)
const TIER_ALL_TOKENS = 3000;         // 3. every typed token matches (final token may be a prefix)
const TIER_MOST_TOKENS = 2000;        // 4. a genuine majority of typed tokens match
const TIER_ONE_TOKEN = 1000;          // 5. only one (typically the first/generic) token matches
const TIER_NONE = 0;                  // no meaningful match at all

// Within a tier, a smooth 0-1 "coverage" bonus (scaled well below the
// 1000-point tier gap, so it can never cross a tier boundary) rewards
// typing MORE of an already-matched word, so ranking feels progressive
// rather than a sudden jump the instant any token first qualifies.
const COVERAGE_BONUS_SCALE = 500;

// Lowercases and splits into whitespace-delimited word tokens after
// removing punctuation (keeping any Unicode letter/number, so accented
// characters remain intact rather than being stripped or mismatched) --
// the same normalization applied to both a candidate's name(s) and the
// searcher's typed query, so they compare on equal footing regardless of
// case or punctuation.
function normalizeForRanking(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Every plausible "name" a candidate could be searched by: its primary
// display name/address line, plus every alt_name/old_name/official_name/
// short_name value (each already split on ';' for multi-value OSM tags) --
// the SAME pool findMatchingNameAlias draws from, so a query matching an
// alias ranks the candidate well, not just labels it well after the fact
// (previously, alias data affected the DISPLAY label only, never ranking --
// this closes that gap).
//
// Each variant also carries `isAddressLine`: true for a variant derived
// purely from WHERE a candidate is located (its house_number+road line, or
// the full display_name breakdown) rather than what it's actually NAMED
// (a real name/alt_name/old_name/official_name/short_name tag, or the
// display_name's own most-specific segment when that genuinely differs
// from the plain address line). This is the fix for a founder-reported
// symptom ("Vincent Massey" collapsing to a single unrelated business
// result): a business or bare address sitting ON a road named "Vincent
// Massey Drive" was scoring an identical top-tier phrase-match to a place
// actually NAMED "Vincent Massey ..." -- being LOCATED ON a road sharing
// the query's words is a real but strictly weaker signal than being NAMED
// those words, and scoreNameVariant below caps address-line matches
// accordingly so a genuinely-named match can never be crowded out by one.
interface NameVariant {
  text: string;
  isAddressLine: boolean;
}

function collectNameVariants(candidate: GeocodeCandidate): NameVariant[] {
  const addr = candidate.address ?? {};
  const streetLine = [addr.house_number, addr.road].filter(Boolean).join(' ');
  const firstSegment = candidate.display_name?.split(',')[0]?.trim();
  // Mirrors toPlaceSuggestionLabel's own "does this candidate actually have
  // a distinct name, or is its most-specific segment just its address"
  // check -- kept as the single shared definition of "this is a real name"
  // would be better, but toPlaceSuggestionLabel needs the resolved LABEL
  // while this needs a boolean per variant; duplicated on purpose rather
  // than reshaping either function's return shape for the other's benefit.
  const hasDistinctName = Boolean(firstSegment && firstSegment !== streetLine);

  const variants = new Map<string, boolean>(); // text -> isAddressLine
  const add = (text: string | undefined, isAddressLine: boolean) => {
    if (!text) return;
    const existing = variants.get(text);
    // If the exact same text is reachable both as a real name/alias AND as
    // an address line (a rare literal collision), treat it as a name --
    // being independently findable via an actual name tag is a strictly
    // stronger claim than merely sharing text with an address line.
    if (existing === undefined || (existing === true && !isAddressLine)) {
      variants.set(text, isAddressLine);
    }
  };

  add(firstSegment, !hasDistinctName);
  add(streetLine || undefined, true);
  add(candidate.display_name, true);

  const namedetails = candidate.namedetails;
  if (namedetails) {
    for (const tag of Object.keys(namedetails)) {
      const raw = namedetails[tag];
      if (!raw) continue;
      for (const value of raw.split(';')) {
        const trimmed = value.trim();
        if (trimmed) add(trimmed, false);
      }
    }
  }
  return Array.from(variants.entries()).map(([text, isAddressLine]) => ({ text, isAddressLine }));
}

// Scores ONE name variant against the typed query tokens. Every token
// EXCEPT the last must already be a complete, exact match against some
// candidate token (order-flexible, per "token order can be flexible where
// appropriate") -- only the final token, which may still be mid-typing,
// is allowed to match via prefix. This is the actual fix for a multi-word
// query being dominated by its first word: with two-or-more typed tokens,
// the first must be an exact match, not merely any shared prefix, so a
// candidate matching ONLY that first word never gets confused with one
// that ALSO genuinely matches the second.
function scoreNameVariant(nameTokens: string[], queryTokens: string[], isAddressLine: boolean): number {
  if (queryTokens.length === 0 || nameTokens.length === 0) return TIER_NONE;

  const nameJoined = nameTokens.join(' ');
  const queryJoined = queryTokens.join(' ');

  // An address-line variant means "located at/on this text", not "named
  // this text" -- capped at the same ceiling as matching every typed token
  // by name (see TIER_ALL_TOKENS below), so a mere address/road-name
  // overlap can never out-rank, or even tie, a candidate that is actually
  // NAMED the searched phrase.
  const addressLineCeiling = TIER_ALL_TOKENS + COVERAGE_BONUS_SCALE;

  if (nameJoined === queryJoined) {
    return isAddressLine ? addressLineCeiling : TIER_EXACT_PHRASE;
  }
  if (queryJoined.length >= MIN_MEANINGFUL_TOKEN_LENGTH && nameJoined.startsWith(`${queryJoined} `)) {
    return isAddressLine ? addressLineCeiling : TIER_FULL_PREFIX_PHRASE;
  }

  // A single, still-incompletely-typed token: no discrete "matched all/
  // most/one tokens" categorization makes sense with only one token to
  // begin with -- instead climb smoothly from TIER_ONE_TOKEN toward
  // TIER_ALL_TOKENS as more of that SAME word is typed. This is what
  // keeps a bare "T" contributing no signal at all (below the minimum
  // length, no match even attempted) while "To" stays modest, "Tol"
  // becomes competitive, and "Told"/"Toldo" climb strongly -- a smooth
  // curve, not a sudden jump the moment any short prefix first matches.
  // (Once the token is a COMPLETE word, the full-prefix-phrase check
  // above already fires first and this branch is never reached for it.)
  if (queryTokens.length === 1) {
    const [qt] = queryTokens;
    if (qt.length < MIN_MEANINGFUL_TOKEN_LENGTH) return TIER_NONE;
    const match = nameTokens.find((nt) => nt.startsWith(qt));
    if (!match) return TIER_NONE;
    const coverage = qt.length / match.length; // 0..1
    return TIER_ONE_TOKEN + coverage * (TIER_ALL_TOKENS - TIER_ONE_TOKEN);
  }

  const lastIdx = queryTokens.length - 1;
  let matchedCount = 0;
  let coverageSum = 0;

  queryTokens.forEach((qt, i) => {
    if (i === lastIdx) {
      if (qt.length < MIN_MEANINGFUL_TOKEN_LENGTH) return;
      const match = nameTokens.find((nt) => nt.startsWith(qt));
      if (match) {
        matchedCount++;
        coverageSum += qt.length / match.length;
      }
    } else if (nameTokens.includes(qt)) {
      matchedCount++;
      coverageSum += 1;
    }
  });

  if (matchedCount === 0) return TIER_NONE;

  const meanCoverage = coverageSum / queryTokens.length;
  const bonus = meanCoverage * COVERAGE_BONUS_SCALE;

  if (matchedCount === queryTokens.length) return TIER_ALL_TOKENS + bonus;
  // A genuine majority, not merely "at least half" -- for a 2-token query
  // that means matching only 1 of 2 is NOT "most", it's the same as
  // matching just one generic token (see TIER_ONE_TOKEN below).
  if (matchedCount > queryTokens.length / 2) return TIER_MOST_TOKENS + bonus;
  return TIER_ONE_TOKEN + bonus;
}

// A candidate's overall relevance is the BEST score across every name it
// could plausibly be found by (see collectNameVariants) -- a candidate
// whose primary name doesn't match but whose alt_name does should rank on
// the strength of that alias, the same way findMatchingNameAlias already
// lets it DISPLAY under that alias.
function scoreCandidateRelevance(candidate: GeocodeCandidate, queryTokens: string[]): number {
  let best = TIER_NONE;
  for (const variant of collectNameVariants(candidate)) {
    const score = scoreNameVariant(normalizeForRanking(variant.text), queryTokens, variant.isAddressLine);
    if (score > best) best = score;
  }
  return best;
}

// ─── Result diversity ───────────────────────────────────────────────────────
// Nominatim's `class` (e.g. 'shop', 'amenity', 'highway') is the closest
// general-purpose "category" signal available on every candidate -- used
// ONLY as a soft diversity cap below, never as a ranking signal itself (a
// higher-scoring candidate always wins regardless of category).
function candidateCategory(candidate: GeocodeCandidate): string {
  return candidate.class || candidate.category || 'unknown';
}

// How many of the DISPLAYED suggestions may share the same category.
// Deliberately soft and generous -- this never reorders by relevance and
// never drops a higher-scoring candidate for a lower one, it only prevents
// several near-identical results of ONE type (e.g. many different
// businesses/addresses along the same road, all genuinely tied in score)
// from consuming the entire display window and crowding out a genuinely
// different, still-relevant type of place ranked just outside it.
const MAX_SAME_CATEGORY_DISPLAYED = 3;

// Takes an already relevance-sorted, already deduped list and reorders it
// minimally so no single category can consume the whole display window: a
// candidate over its category's quota is deferred (never dropped) and only
// backfilled at the end if there aren't enough other candidates to fill
// `limit` slots. This never promotes a candidate ahead of a
// higher-scoring one that already fit within quota -- it only ever
// changes which candidates make it into the final LIMITED window, never
// their relative order otherwise.
function applyResultDiversity(
  ranked: { suggestion: PlaceSuggestion; category: string }[],
  limit: number
): PlaceSuggestion[] {
  const counts = new Map<string, number>();
  const included = new Set<number>(); // indices into `ranked` that made the cut
  const overflow: number[] = []; // indices deferred purely for exceeding their category's quota

  ranked.forEach((item, i) => {
    const count = counts.get(item.category) ?? 0;
    if (count < MAX_SAME_CATEGORY_DISPLAYED) {
      counts.set(item.category, count + 1);
      included.add(i);
    } else {
      overflow.push(i);
    }
  });

  for (const i of overflow) {
    if (included.size >= limit) break;
    included.add(i);
  }

  // Crucial: the returned order always follows `ranked`'s own overall
  // relevance order, never the order items were decided to be included in
  // -- filtering (rather than concatenating accepted+backfilled lists)
  // guarantees diversity can only ever affect WHICH candidates make the
  // cut, never demote a higher-scoring included candidate below a
  // lower-scoring one (a real bug caught in an earlier draft of this
  // function: a lower-scoring candidate from an under-represented category
  // could slip into an "accepted" list ahead of a higher-scoring,
  // quota-deferred candidate simply because it was processed later).
  return ranked.filter((_, i) => included.has(i)).slice(0, limit).map((item) => item.suggestion);
}

// ─── Address-intent ranking ─────────────────────────────────────────────────
// searchPlaces's local relevance re-ranking above (scoreCandidateRelevance)
// is a NAME-matching model: it treats a candidate's house_number+road
// "street-line" purely as TEXT that happens to look like an address, and
// caps it at the same ceiling no matter what kind of OSM entity actually
// produced it. That is not enough once the query itself is a full street
// address: Nominatim frequently also returns a business/POI geocoded to the
// SAME house number (a business occupies a real numbered building), and
// that POI's own street-line variant matches the typed address text just as
// exactly as the plain address point's does -- both score identically, and
// the tie is broken by Nominatim's own original order, which commonly ranks
// a named, "important" POI above a bare residential address node. Confirmed
// against the unmodified ranking with synthetic data before this section was
// added: a "452 Elm Street" search returned "Elm Street Pharmacy" (also
// geocoded to house_number 452) ahead of the actual address point purely on
// that tie-break, with the real address point second and the bare road
// third. The renter typed a specific building's address, not a business
// name, so that tie must never be left to chance.
//
// This section is a NARROW addition, active ONLY when the query itself
// looks like a full street address (see looksLikeFullAddress) -- a bare
// place/POI name search (no leading house number) is completely unaffected
// and keeps using scoreCandidateRelevance exactly as before.

// A full street address starts with a house number (optionally a single
// trailing unit letter, e.g. "123A") followed by more text (the street
// name) -- deliberately just this shape check, not an exhaustive address
// grammar, and not tied to any specific address/city, so it generalizes the
// same way to any Canadian street address.
function looksLikeFullAddress(query: string): boolean {
  return /^\d+[a-zA-Z]?\s+\S/.test(query.trim());
}

// The leading house-number token itself (e.g. "452" from "452 Elm Street"),
// or null if the query doesn't start with one -- only ever called after
// looksLikeFullAddress has already confirmed the shape.
function extractLeadingHouseNumber(query: string): string | null {
  return query.trim().match(/^(\d+[a-zA-Z]?)\b/)?.[1]?.toLowerCase() ?? null;
}

type CandidateKind = 'address' | 'road' | 'poi' | 'neighborhood' | 'city' | 'postal';

// Nominatim's general-purpose `class` values that mean "a named business/
// amenity/attraction" -- checked BEFORE the house_number fallback in
// classifyCandidateKind below, since many POIs carry a full, accurate
// address breakdown (including their own house_number) alongside their
// name, and that must never be mistaken for the plain address record for
// that same building.
const POI_CLASSES = new Set([
  'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'healthcare', 'historic', 'religion',
]);
const CITY_PLACE_TYPES = new Set(['city', 'town', 'municipality', 'borough', 'county']);
const NEIGHBORHOOD_PLACE_TYPES = new Set(['suburb', 'neighbourhood', 'neighborhood', 'quarter', 'hamlet', 'village', 'locality']);

// Classifies what KIND of OSM entity a candidate actually is, using the same
// class/type/address metadata Nominatim already returns (see the
// GeocodeCandidate shape) -- never a candidate's own text/name, which is
// exactly what scoreCandidateRelevance already judges separately. Order
// matters: a road is checked first (its own address breakdown sometimes
// echoes its own name as `address.road` with no house_number, which would
// otherwise fall through further down), then postal/city/neighborhood area
// classes, then POI classes (checked before the house_number fallback for
// the reason in POI_CLASSES's own comment), then finally "has a
// house_number, or Nominatim's own `type=house` marker" for a plain
// address. Anything left over is treated as a generic named place (poi) --
// not a road, not an area, not a confirmed address.
function classifyCandidateKind(candidate: GeocodeCandidate): CandidateKind {
  const addr = candidate.address ?? {};
  const cls = candidate.class;
  const type = candidate.type;

  if (cls === 'highway') return 'road';
  if (cls === 'place' && type === 'postcode') return 'postal';
  if (cls === 'boundary' || (cls === 'place' && type && CITY_PLACE_TYPES.has(type))) return 'city';
  if (cls === 'place' && type && NEIGHBORHOOD_PLACE_TYPES.has(type)) return 'neighborhood';
  if (POI_CLASSES.has(cls ?? '')) return 'poi';
  if (type === 'house' || addr.house_number) return 'address';
  return 'poi';
}

// Priority order requested for a full-address query: exact address-level
// results outrank POIs, roads, neighborhoods, cities, and postal/admin
// areas. Spaced far enough apart (KIND_PRIORITY_SCALE) that no amount of
// textual relevance (scoreCandidateRelevance's own max is a few thousand)
// can ever let a lower kind outrank a higher one.
const KIND_PRIORITY: Record<CandidateKind, number> = {
  address: 5, road: 4, poi: 3, neighborhood: 2, city: 1, postal: 0,
};
const KIND_PRIORITY_SCALE = 100_000;
// Extra credit within the 'address' kind for a candidate whose OWN
// house_number matches what was actually typed, over one that's merely
// address-kind but a different number on a similarly-matching street --
// kept below KIND_PRIORITY_SCALE so it can never itself cross into a
// different kind's range.
const HOUSE_NUMBER_MATCH_BONUS = KIND_PRIORITY_SCALE / 2;

// The address-intent scorer used in place of scoreCandidateRelevance ONLY
// when looksLikeFullAddress(query) is true. Deliberately requires a genuine
// baseline text match first (relevance > TIER_NONE, i.e. at least one real
// token actually matched) before applying any kind-based boost -- an
// address-kind candidate sharing NOTHING textually with the query (e.g. an
// unrelated result Nominatim returned for some other reason) must never be
// artificially promoted just because it happens to be an address record.
function scoreAddressIntentCandidate(
  candidate: GeocodeCandidate,
  queryTokens: string[],
  leadingHouseNumber: string | null
): number {
  const relevance = scoreCandidateRelevance(candidate, queryTokens);
  if (relevance <= TIER_NONE) return TIER_NONE;

  const kind = classifyCandidateKind(candidate);
  const houseNumber = candidate.address?.house_number?.trim().toLowerCase();
  const houseNumberBonus = kind === 'address' && leadingHouseNumber && houseNumber === leadingHouseNumber
    ? HOUSE_NUMBER_MATCH_BONUS
    : 0;

  return KIND_PRIORITY[kind] * KIND_PRIORITY_SCALE + houseNumberBonus + relevance;
}

// ─── Renter-facing place/POI search (autocomplete) ─────────────────────────
// Distinct from geocodeAddress's free-text path (used by the single-result
// GET /geocode endpoint that ConfirmLocationMap.tsx's listing-creation flow
// depends on, which this function does NOT replace or touch) -- this one:
//
//   1. ALWAYS queries Nominatim, regardless of GEOCODING_PROVIDER. Geocodio
//      is a structured ADDRESS geocoder with no general place/POI search
//      product at all -- feeding it a bare landmark name like "Toldo Lancer
//      Centre" (no street/city to parse) is not something its API is built
//      to resolve, unlike Nominatim's general-purpose OSM-backed search,
//      which already indexes named buildings/POIs alongside addresses. This
//      is an intentional, permanent architectural choice, not a temporary
//      default -- see the GEOCODING_PROVIDER switch's own doc comment above,
//      which governs the LISTING address pipeline only. This is already a
//      free-form `q=` search, never the structured street/city/state query
//      geocodeAddress's requirePreciseMatch path uses -- there is no
//      "address-oriented assumption" to remove here.
//   2. Sends the query text AS TYPED, with no manual ", Canada" appended --
//      that string concatenation bought nothing (countrycodes/viewbox below
//      already scope the search geographically) and, for a bare POI name
//      with no natural "city, country" reading, only risked confusing
//      Nominatim's tokenizer for no benefit.
//   3. Enforces Canada-only as a FIRM requirement, not just a preference:
//      the query itself is hard-restricted via `countrycodes=ca` (see
//      buildPlaceSearchParams), and every returned candidate is additionally
//      double-checked against its own resolved `address.country_code`
//      before it ever reaches ranking/display -- defense in depth against
//      trusting the query parameter alone. There is deliberately no
//      second, country-relaxed attempt when the hard-filtered query finds
//      nothing (an earlier version tried a soft Canada-wide `viewbox` bias
//      to recover a genuinely Canadian POI with wrong OSM country tagging,
//      but a soft geographic bias is not actually Canada-only -- a
//      bounding box covering all of Canada's latitude/longitude range also
//      covers nearly the entire northern continental US, so it could
//      genuinely surface a non-Canadian result). This does NOT, and
//      cannot, recover a POI that simply isn't named/tagged as Canadian
//      anywhere in OpenStreetMap at all -- no query reformulation finds
//      data that was never entered; that's a real, inherent OSM data-
//      quality limitation, not a bug in this query.
//   4. Requests `namedetails=1` and, via findMatchingNameAlias, relabels a
//      match using whichever alt_name/old_name/official_name/short_name tag
//      the search actually matched, when that differs from the element's
//      primary name. This does NOT change which candidates match (that's
//      Nominatim's index, unaffected by this parameter) -- it fixes the
//      case where Nominatim DID find the right place but under a name the
//      searcher never typed and wouldn't recognize. (The motivating real
//      case: a building renamed after a naming-rights gift, e.g. the
//      University of Windsor's athletics centre, may still be tagged
//      `name=<old name>` in OSM with the new name only present as an alias
//      until a mapper updates the primary tag.) If OSM has NEITHER the
//      primary name NOR any alias matching the search text, this cannot
//      manufacture a result -- that is a genuine OpenStreetMap data gap,
//      not something any query parameter can work around.
//   5. Fetches a wider internal pool (NOMINATIM_FETCH_LIMIT) than it ever
//      shows, then RE-RANKS that pool locally (see "Local relevance
//      re-ranking" above) before slicing to DISPLAY_SUGGESTION_LIMIT --
//      Nominatim's own per-query relevance order isn't reliable for a
//      multi-word, partially-typed phrase (see that section's own doc
//      comment), so this app no longer trusts it blindly. A genuinely
//      ambiguous search (e.g. a street name that exists in several cities)
//      still surfaces multiple candidates for the renter to pick from, and
//      a soft per-category diversity cap (see applyResultDiversity) keeps
//      several near-identical results of ONE type from crowding out a
//      genuinely different, still-relevant type of place.
//   6. Returns an empty array for "no matches" (never throws/404s) -- an
//      autocomplete dropdown showing "no results" is a normal, expected UI
//      state, not an error condition the way a single-result lookup's 404
//      is for GET /geocode.
//   7. When the query itself looks like a full street address (see
//      looksLikeFullAddress), scores candidates with scoreAddressIntentCandidate
//      instead of scoreCandidateRelevance -- see that section's own doc
//      comment for why plain name-phrase matching alone lets a POI/business
//      geocoded to the same house number as the plain address point win a
//      tie it should never win. A bare place/POI name query (no leading
//      house number) is completely unaffected and still uses
//      scoreCandidateRelevance exactly as before.
//
// Never accepts/returns a provider API key -- same stance as every other
// function in this file; the frontend only ever calls this app's own
// GET /geocode/suggestions route.
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const url = `${NOMINATIM_SEARCH_URL}?${buildPlaceSearchParams(query).toString()}`;
  const rawCandidates = await fetchNominatimCandidates(url, `q="${query}" (place search, Canada-only)`);

  // Defense in depth (see this function's own doc comment, point 3): drop
  // anything whose own resolved country isn't Canada, rather than trusting
  // the `countrycodes=ca` query parameter alone. A candidate with no
  // country_code at all (addressdetails occasionally omits it) is kept --
  // "unknown" is not the same as "confirmed not Canadian".
  const candidates = rawCandidates.filter((c) => {
    const cc = c.address?.country_code;
    return !cc || cc.toLowerCase() === 'ca';
  });

  const queryTokens = normalizeForRanking(query);
  const addressIntent = looksLikeFullAddress(query);
  const leadingHouseNumber = addressIntent ? extractLeadingHouseNumber(query) : null;

  const scored = candidates
    .map((candidate) => {
      const lat = parseFloat(String(candidate.lat));
      const lng = parseFloat(String(candidate.lon));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        suggestion: { label: toPlaceSuggestionLabel(candidate, query), lat, lng },
        score: addressIntent
          ? scoreAddressIntentCandidate(candidate, queryTokens, leadingHouseNumber)
          : scoreCandidateRelevance(candidate, queryTokens),
        category: candidateCategory(candidate),
      };
    })
    .filter((s): s is { suggestion: PlaceSuggestion; score: number; category: string } => s !== null);

  // A stable sort (guaranteed by the JS spec) -- ties, including "no
  // meaningful signal yet" (every candidate scoring TIER_NONE for a bare
  // single character), preserve Nominatim's own original relevance/
  // geographic order rather than being reshuffled arbitrarily.
  scored.sort((a, b) => b.score - a.score);

  const deduped = dedupeByLabel(scored);
  return applyResultDiversity(deduped, DISPLAY_SUGGESTION_LIMIT);
}

// Nominatim's own `dedupe` (on by default) collapses near-identical raw
// results, but that happens BEFORE this app's own labeling -- two distinct
// candidates (e.g. a building point and an entrance/address point a few
// metres apart) can still end up with the EXACT SAME label after
// toPlaceSuggestionLabel's construction, which reads as a confusing
// literal duplicate in the autocomplete dropdown even though the
// underlying coordinates differ slightly. Keeps the FIRST occurrence of
// each label -- i.e. Nominatim's own relevance ranking still decides which
// of the duplicates' coordinates wins -- rather than picking arbitrarily.
// Generic over any record carrying a `suggestion`, so it can run either
// before or after category info is attached without needing its own copy.
function dedupeByLabel<T extends { suggestion: PlaceSuggestion }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.suggestion.label)) return false;
    seen.add(item.suggestion.label);
    return true;
  });
}

// ─── Full-address resolve for Browse's manual Search/Enter (2026-09) ───────
// A real, founder-reported bug: routing EVERY manual search (including full
// street addresses) through searchPlaces()'s Nominatim-only place/POI
// pipeline meant an address search's marker accuracy was only ever as good
// as local re-ranking of Nominatim's own candidates -- and Nominatim
// frequently has no house-level data for a given Canadian address at all,
// or returns a business/road/area result ranking indistinguishably from a
// genuine address point. This app already pays for and runs Geocodio
// specifically for address-level geocoding (the listing-creation pipeline,
// see geocodeAddress above) -- reusing that path for a FULL ADDRESS query
// specifically (never for POI/place-name queries, see resolvePlace below)
// fixes this without adding a new provider or any new credential.
//
// Deliberately does NOT reuse geocodeAddress() as-is -- neither of its two
// existing modes fits a single raw typed string:
//   - Its default (non-requirePreciseMatch) free-text mode has NO accuracy
//     gating at all -- it blindly returns whatever candidate came back
//     first. That is exactly the "silently present an approximate location
//     as if it were the exact address" failure this function exists to
//     close, not something to inherit.
//   - Its requirePreciseMatch mode DOES have real accuracy gating
//     (evaluateAddressMatch/pickBestCandidate), but that machinery
//     validates a candidate's own resolved city/province against SEPARATELY
//     SUPPLIED requested street/city/province fields -- Browse's search box
//     is one raw typed string with nothing decomposed to validate against.
//
// Acceptance is judged directly on Geocodio's own accuracy_type string
// (top.type, always threaded through by geocodioResultToCandidate
// regardless of precision -- see that function's own doc comment),
// NOT on address.house_number presence: that field is deliberately left
// unpopulated for range_interpolation (to keep the LISTING-address
// pipeline's own precise/street grading correct elsewhere in this file --
// untouched, not something this function should perturb), which would
// otherwise make a genuinely useful interpolated address indistinguishable
// from a bare road/area match here. Two accepted tiers, never re-ranked by
// any Nominatim/local relevance heuristic (Geocodio's own top free-text
// result is used as-is, or rejected outright):
//   'exact'       -- rooftop / point / nearest_rooftop_match. Presented
//                    with full confidence.
//   'approximate' -- range_interpolation. A real, useful match (Geocodio
//                    estimated a point along the correct street segment
//                    between two known addresses) -- returned, never
//                    rejected, but tagged so a caller can show it as
//                    approximate rather than implying rooftop precision.
// Everything else (street_center, place, state, or no candidate at all) is
// rejected outright -- "Location not found" is more honest than a marker
// silently placed at a road or neighbourhood centroid.
//
// Canada-only: fetchCandidates' free-text mode (unlike its structured mode)
// has no country= parameter for Geocodio, so the query text itself gets the
// same explicit ", Canada" suffix geocodeAddress's own default free-text
// mode already appends (a hint, not a hard filter) -- PLUS a result-side
// country_code check (defense in depth, the exact pattern searchPlaces()
// already uses for Nominatim): a candidate resolving outside Canada is
// rejected outright, never presented.
//
// Every branch logs the same sanitized field set (never the full request/
// response) for diagnosing a specific real-world address: accuracy_type,
// accuracy score, formatted address, lat/lng, and resolved country -- all
// data Geocodio already returns for the address as typed, never anything
// beyond that.
async function geocodeFullAddress(query: string): Promise<GeocodeResult | null> {
  const q = [query, 'Canada'].join(', ');
  const description = `q="${q}" (Browse manual full-address search, free-text)`;

  const [top] = await fetchCandidates({ kind: 'freeText', q }, description);
  if (!top) return null;

  const addr = top.address ?? {};
  const sanitizedFields = () =>
    `accuracy_type=${top.type ?? 'unknown'}, accuracy=${top.accuracy ?? 'unknown'}, ` +
    `formatted="${top.display_name ?? 'unknown'}", lat=${top.lat ?? 'unknown'}, lng=${top.lon ?? 'unknown'}, ` +
    `country=${addr.country_code ?? 'unknown'}`;

  if (addr.country_code && addr.country_code !== 'ca') {
    logger.warn(`Full-address resolve REJECTED for [${description}]: best candidate resolved outside Canada (${sanitizedFields()}).`);
    return null;
  }

  const accuracyType = top.type;
  const isExact = accuracyType ? GEOCODIO_PRECISE_ACCURACY_TYPES.has(accuracyType) : false;
  const isApproximate = accuracyType ? GEOCODIO_APPROXIMATE_ADDRESS_ACCURACY_TYPES.has(accuracyType) : false;

  if (!addr.road || (!isExact && !isApproximate)) {
    logger.warn(`Full-address resolve REJECTED for [${description}]: best candidate is not address-level precision (${sanitizedFields()}).`);
    return null;
  }

  const result = toGeocodeResult(top, description, isExact ? 'precise' : 'street');
  if (!result) return null;

  logger.info(`Full-address resolve ACCEPTED (${isExact ? 'exact' : 'approximate'}) for [${description}]: ${sanitizedFields()}.`);
  return { ...result, accuracyType, precision: isExact ? 'exact' : 'approximate' };
}

// ─── Manual "search my complete typed text" resolve ────────────────────────
// Backs LocationRadiusSearch.tsx's Enter/Search action: autocomplete
// suggestions are assistance, never a required gate. If the renter's
// intended place doesn't appear in (or disagrees with) the dropdown, they
// can still finish typing and search their own complete text directly --
// this resolves that complete text to a single best Canadian location, or
// null if nothing resolves.
//
// Narrow split (2026-09, see geocodeFullAddress's own doc comment for the
// full reasoning): a query that LOOKS LIKE a full street address (see
// looksLikeFullAddress -- the same shape check searchPlaces' own
// address-intent ranking already uses) resolves via Geocodio's address
// geocoding instead of Nominatim, since accurate address-level coordinates
// is exactly what this app already pays Geocodio for. Everything else --
// POI/building/business/school/landmark/neighbourhood/city text -- keeps
// resolving via searchPlaces()'s existing Nominatim-only pipeline exactly
// as before; that pipeline, and the autocomplete suggestions dropdown that
// shares it, are UNCHANGED by this split.
export async function resolvePlace(query: string): Promise<GeocodeResult | null> {
  if (looksLikeFullAddress(query)) {
    return geocodeFullAddress(query);
  }
  const [top] = await searchPlaces(query);
  return top ? { lat: top.lat, lng: top.lng } : null;
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
