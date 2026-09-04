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

interface NominatimResult {
  lat?: unknown;
  lon?: unknown;
  address?: NominatimAddressDetails;
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
  //   2. REJECTS (returns null) any match that didn't resolve to a specific
  //      house/building -- i.e. Nominatim's response has no `house_number`
  //      in its address breakdown. Nominatim will very often still return
  //      *something* for an address it can't precisely match (the
  //      containing street, neighbourhood, or even just the city) rather
  //      than failing outright, and a coordinate like that is not "this
  //      address" -- storing it anyway is exactly the "misleading
  //      coordinate" this option exists to prevent.
  //
  // Left off (default false) for the renter-facing free-text location
  // search (routes/geocode.ts's GET /geocode), which searches for areas by
  // design ("Scarborough", "downtown Ottawa") and has no house number to
  // require in the first place.
  requirePreciseMatch?: boolean;
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

  const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'ca' });
  let queryDescription: string;

  if (requirePreciseMatch) {
    params.set('street', address);
    if (city) params.set('city', city);
    if (province) {
      const provinceName = PROVINCE_NAMES[province.trim().toUpperCase()] ?? province;
      params.set('state', provinceName);
    }
    params.set('country', 'Canada');
    // Needed to inspect whether the match actually resolved to a specific
    // house/building (see the house_number check below) rather than a
    // coarser street/area-level fallback.
    params.set('addressdetails', '1');
    queryDescription = `street="${address}", city="${city}", state="${province ?? ''}", country="Canada" (structured)`;
  } else {
    const q = [address, city, province, 'Canada'].filter(Boolean).join(', ');
    params.set('q', q);
    queryDescription = `q="${q}" (free-text)`;
  }

  const url = `${NOMINATIM_SEARCH_URL}?${params.toString()}`;

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

  const top = results[0] as NominatimResult;
  const lat = parseFloat(String(top.lat));
  const lng = parseFloat(String(top.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    logger.error(`Geocoding returned a non-numeric coordinate for ${queryDescription}`);
    return null;
  }

  if (requirePreciseMatch && !top.address?.house_number) {
    logger.warn(
      `Geocoding for ${queryDescription} matched only at street/area level (no house_number in the ` +
      `result's address breakdown) -- rejecting rather than storing an imprecise coordinate as exact.`
    );
    return null;
  }

  return { lat, lng };
}
