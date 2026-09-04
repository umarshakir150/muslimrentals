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
}

// The metadata Nominatim actually returns to judge match quality by --
// requested via `format=jsonv2` (not the default `json`), which is the
// format Nominatim documents as including `place_rank`/`importance`
// alongside the fields plain `json` already has.
interface NominatimResult {
  lat?: unknown;
  lon?: unknown;
  address?: NominatimAddressDetails;
  class?: string;
  type?: string;
  place_rank?: number;
  importance?: number;
  display_name?: string;
}

// Nominatim's own rank_address scale runs 0-30: 4=country, 8=state,
// 12=county, 16=city, ~20-22=suburb/neighbourhood, ~26-27=street/road,
// 28-30=building/address/POI level. 28 is the documented start of
// "resolved to a specific place on that street," not merely "somewhere on
// the street" -- the exact boundary this whole check exists to draw.
const MIN_PRECISE_PLACE_RANK = 28;

interface PrecisionEvaluation {
  precise: boolean;
  // Sanitized, log-safe reasoning -- class/type/rank/importance, an address
  // breakdown, and display_name (all data Nominatim already returns for the
  // address as typed; never the resolved lat/lon, and never surfaced in any
  // API response -- this is diagnostic-log-only, per the explicit ask to
  // "log/report enough sanitized metadata... but do not expose private
  // coordinates").
  reason: string;
}

// Judges whether a Nominatim result is precise enough to treat as "the
// entered address," using its actual returned metadata -- never a single
// `house_number != null` check. A result can be precise without a
// house_number (e.g. a `class=building` footprint match, or a POI/address
// point Nominatim ranks at building level) and a result WITH some address
// breakdown can still be too broad (e.g. a suburb whose breakdown happens
// to include a house_number from context Nominatim guessed at -- unlikely
// but the class/rank checks below don't depend on that field alone either
// way).
function evaluateMatchPrecision(result: NominatimResult): PrecisionEvaluation {
  const meta = `class=${result.class ?? 'unknown'}, type=${result.type ?? 'unknown'}, ` +
    `place_rank=${result.place_rank ?? 'unknown'}, importance=${result.importance ?? 'unknown'}, ` +
    `display_name="${result.display_name ?? 'unknown'}"`;

  if (result.address?.house_number) {
    return { precise: true, reason: `house_number "${result.address.house_number}" present in address breakdown (${meta})` };
  }
  if (result.class === 'building') {
    return { precise: true, reason: `class=building -- a building footprint match, address-level even without a house_number (${meta})` };
  }
  if (typeof result.place_rank === 'number' && result.place_rank >= MIN_PRECISE_PLACE_RANK) {
    return { precise: true, reason: `place_rank ${result.place_rank} >= ${MIN_PRECISE_PLACE_RANK} (building/address/POI level) (${meta})` };
  }

  // Everything else -- streets/roads (class=highway, rank ~26-27), suburbs/
  // neighbourhoods/cities/towns (class=place, rank ~16-22), counties/
  // provinces/countries (class=boundary type=administrative, rank <=12) --
  // is exactly the "silently produces a different location" case this
  // check exists to catch, regardless of whether Nominatim still populated
  // some address fields for it.
  return { precise: false, reason: `too broad for an address match (${meta})` };
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
  //   2. Evaluates the result's actual metadata (class/type/place_rank --
  //      see evaluateMatchPrecision) and, if it's too broad (a street,
  //      neighbourhood, city, or wider match rather than a specific
  //      building/address), falls back to a carefully constructed
  //      free-text query and evaluates THAT result the same way, rather
  //      than accepting the coarse match outright.
  //   3. Rejects (returns null) if neither attempt resolves precisely --
  //      Nominatim will very often still return *something* (the
  //      containing street, neighbourhood, or even just the city) rather
  //      than failing outright, and a coordinate like that is not "this
  //      address": storing it anyway is exactly the "misleading
  //      coordinate" this option exists to prevent.
  //
  // Left off (default false) for the renter-facing free-text location
  // search (routes/geocode.ts's GET /geocode), which searches for areas by
  // design ("Scarborough", "downtown Ottawa") and has no building/address
  // precision to require in the first place.
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
  // fallback, each evaluated for actual match precision (not just
  // "Nominatim returned *a* result"). ──────────────────────────────────────
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
    const evaluation = evaluateMatchPrecision(structuredTop);
    logger.info(`Geocoding (structured) for [${structuredDescription}]: ${evaluation.precise ? 'ACCEPTED' : 'too broad, trying free-text fallback'} -- ${evaluation.reason}`);
    if (evaluation.precise) {
      return toGeocodeResult(structuredTop, structuredDescription);
    }
  }

  // Structured query returned nothing, or returned something too broad
  // (a street/neighbourhood/city/etc.) -- try a free-text query built the
  // same way the renter-search path builds one, in case Nominatim's
  // structured-field matching missed an address its general search finds.
  const freeTextQuery = [address, city, provinceName ?? province, 'Canada'].filter(Boolean).join(', ');
  const freeTextParams = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'ca', addressdetails: '1', q: freeTextQuery });
  const freeTextUrl = `${NOMINATIM_SEARCH_URL}?${freeTextParams.toString()}`;
  const freeTextDescription = `q="${freeTextQuery}" (free-text fallback)`;

  const freeTextTop = await fetchNominatimTop(freeTextUrl, freeTextDescription);
  if (!freeTextTop) {
    logger.warn(`Geocoding rejected for "${address}, ${city}": no result from either structured or free-text fallback query.`);
    return null;
  }

  const fallbackEvaluation = evaluateMatchPrecision(freeTextTop);
  logger.info(`Geocoding (free-text fallback) for [${freeTextDescription}]: ${fallbackEvaluation.precise ? 'ACCEPTED' : 'REJECTED'} -- ${fallbackEvaluation.reason}`);
  if (!fallbackEvaluation.precise) {
    // Never silently accept a city/neighbourhood/street centroid just
    // because it's the best either attempt could do.
    return null;
  }

  return toGeocodeResult(freeTextTop, freeTextDescription);
}
