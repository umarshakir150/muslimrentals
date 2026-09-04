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
  precise: boolean;
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
// specific building), this compares the REQUESTED street/city/province
// against what Nominatim's address breakdown actually resolved to. A result
// is accepted whenever it resolves to the right street, in the right city,
// in the right province -- whether or not it also happens to carry a
// house_number -- and rejected only when it resolves to a different
// street/city/province, or to no street at all (a bare city/neighbourhood/
// province centroid).
const STREET_TYPE_ALIASES: Record<string, string> = {
  st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive',
  blvd: 'boulevard', ct: 'court', crt: 'court', cres: 'crescent', cresc: 'crescent',
  pl: 'place', ln: 'lane', hwy: 'highway', pkwy: 'parkway', sq: 'square',
  terr: 'terrace', ter: 'terrace', cir: 'circle', gdns: 'gardens',
  n: 'north', s: 'south', e: 'east', w: 'west',
};

const MUNICIPALITY_PREFIXES = /^(city|town|township|municipality|village|district)\s+of\s+/i;

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

// Judges whether a Nominatim result resolves to the requested address's
// street, in the requested city, in the requested province -- the tiered
// strategy: an exact house-number/building match is accepted (and noted),
// but so is a plain street-level match, as long as street+city+province
// all check out. Rejects only a wrong street, a wrong city, a wrong
// province, or a result with no street at all (city/neighbourhood/province
// centroid).
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
    return { precise: false, reason: `no street in the result's address breakdown -- only a city/neighbourhood/province-level match (${meta})` };
  }
  if (normalizeStreetName(addr.road) !== normalizeStreetName(requestedStreet)) {
    return { precise: false, reason: `resolved street does not match the requested street (${meta})` };
  }
  if (resultCity && normalizePlaceName(resultCity) !== normalizePlaceName(requestedCity)) {
    return { precise: false, reason: `resolved city does not match the requested city (${meta})` };
  }
  if (requestedProvince && addr.state && normalizeProvinceName(addr.state) !== normalizeProvinceName(requestedProvince)) {
    return { precise: false, reason: `resolved province does not match the requested province (${meta})` };
  }

  const precisionNote = addr.house_number
    ? `house_number "${addr.house_number}" present`
    : 'street-level match (no house_number in OSM for this building -- accepted on street+city+province match)';
  return { precise: true, reason: `${precisionNote} (${meta})` };
}

export interface GeocodeOptions {
  // When true:
  //   1. Uses Nominatim's STRUCTURED query fields (street/city/state/country)
  //      instead of one free-text string. Nominatim's own docs note this
  //      resolves more reliably than a single joined string when the caller
  //      genuinely knows which part of the input is the street vs. the
  //      city/region -- which the listing Post/Edit form does (separate
  //      address/city/province fields), unlike a renter's free-text
  //      location search.
  //   2. Evaluates the result against the REQUESTED street/city/province
  //      (see evaluateAddressMatch) and, if it resolves to somewhere else
  //      entirely (or only to a bare city/neighbourhood/province centroid),
  //      falls back to a carefully constructed free-text query and
  //      evaluates THAT result the same way, rather than accepting the
  //      wrong match or giving up after one attempt.
  //   3. Rejects (returns null) if neither attempt resolves to the
  //      requested street/city/province -- a coordinate for the wrong
  //      street, wrong city, or a bare area centroid is not "this address."
  //
  // This does NOT require Nominatim to have building/house-number-level
  // OSM data for the address -- a correctly-located street-level match is
  // accepted. The goal is a geographically useful coordinate for the
  // entered address, not certifying it against OSM's own coverage.
  //
  // Left off (default false) for the renter-facing free-text location
  // search (routes/geocode.ts's GET /geocode), which searches for areas by
  // design ("Scarborough", "downtown Ottawa") and has no specific street to
  // match against in the first place.
  requirePreciseMatch?: boolean;
}

async function fetchNominatimTop(url: string, queryDescription: string): Promise<NominatimResult | null> {
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

  if (!response.ok) {
    logger.error(`Geocoding API returned ${response.status} for ${queryDescription}`);
    return null;
  }

  let results: unknown;
  try {
    results = await response.json();
  } catch (err) {
    logger.error(`Geocoding response was not valid JSON for ${queryDescription}:`, err);
    return null;
  }

  if (!Array.isArray(results) || results.length === 0) {
    logger.warn(`Geocoding found no match for ${queryDescription}`);
    return null;
  }

  return results[0] as NominatimResult;
}

function toGeocodeResult(top: NominatimResult, queryDescription: string): GeocodeResult | null {
  const lat = parseFloat(String(top.lat));
  const lng = parseFloat(String(top.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    logger.error(`Geocoding returned a non-numeric coordinate for ${queryDescription}`);
    return null;
  }
  return { lat, lng };
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

    const top = await fetchNominatimTop(url, queryDescription);
    return top ? toGeocodeResult(top, queryDescription) : null;
  }

  // ── Listing address pipeline: structured query, then a free-text
  // fallback, each evaluated against the requested street/city/province
  // (not against Nominatim's own precision metadata). ─────────────────────
  const provinceName = province ? (PROVINCE_NAMES[province.trim().toUpperCase()] ?? province) : undefined;

  const structuredParams = new URLSearchParams({
    format: 'jsonv2', limit: '1', countrycodes: 'ca', addressdetails: '1',
    street: address, country: 'Canada',
  });
  if (city) structuredParams.set('city', city);
  if (provinceName) structuredParams.set('state', provinceName);
  const structuredUrl = `${NOMINATIM_SEARCH_URL}?${structuredParams.toString()}`;
  const structuredDescription = `street="${address}", city="${city}", state="${provinceName ?? ''}", country="Canada" (structured)`;

  const structuredTop = await fetchNominatimTop(structuredUrl, structuredDescription);
  if (structuredTop) {
    const evaluation = evaluateAddressMatch(structuredTop, address, city, province);
    logger.info(`Geocoding (structured) for [${structuredDescription}]: ${evaluation.precise ? 'ACCEPTED' : 'no match, trying free-text fallback'} -- ${evaluation.reason}`);
    if (evaluation.precise) {
      return toGeocodeResult(structuredTop, structuredDescription);
    }
  }

  // Structured query returned nothing, or returned the wrong street/city/
  // province -- try a free-text query built the same way the renter-search
  // path builds one, in case Nominatim's structured-field matching missed
  // an address its general search finds.
  const freeTextQuery = [address, city, provinceName ?? province, 'Canada'].filter(Boolean).join(', ');
  const freeTextParams = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'ca', addressdetails: '1', q: freeTextQuery });
  const freeTextUrl = `${NOMINATIM_SEARCH_URL}?${freeTextParams.toString()}`;
  const freeTextDescription = `q="${freeTextQuery}" (free-text fallback)`;

  const freeTextTop = await fetchNominatimTop(freeTextUrl, freeTextDescription);
  if (!freeTextTop) {
    logger.warn(`Geocoding rejected for "${address}, ${city}": no result from either structured or free-text fallback query.`);
    return null;
  }

  const fallbackEvaluation = evaluateAddressMatch(freeTextTop, address, city, province);
  logger.info(`Geocoding (free-text fallback) for [${freeTextDescription}]: ${fallbackEvaluation.precise ? 'ACCEPTED' : 'REJECTED'} -- ${fallbackEvaluation.reason}`);
  if (!fallbackEvaluation.precise) {
    // Never silently accept a wrong-street/wrong-city/wrong-province match,
    // or a bare city/neighbourhood/province centroid.
    return null;
  }

  return toGeocodeResult(freeTextTop, freeTextDescription);
}
