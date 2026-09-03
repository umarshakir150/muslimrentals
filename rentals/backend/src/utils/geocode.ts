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

export interface GeocodeResult {
  lat: number;
  lng: number;
}

// Deliberately takes address/city/province only -- never a unit/apartment
// number. A unit is meaningless to a geocoder (it resolves buildings and
// streets, not individual units inside one) and including it risks a
// worse or failed match on an address that would otherwise geocode cleanly.
export async function geocodeAddress(
  address: string,
  city: string,
  province?: string | null
): Promise<GeocodeResult | null> {
  const query = [address, city, province, 'Canada'].filter(Boolean).join(', ');
  const url = `${NOMINATIM_SEARCH_URL}?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    logger.error('Geocoding request failed:', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    logger.error(`Geocoding API returned ${response.status} for query "${query}"`);
    return null;
  }

  let results: unknown;
  try {
    results = await response.json();
  } catch (err) {
    logger.error('Geocoding response was not valid JSON:', err);
    return null;
  }

  if (!Array.isArray(results) || results.length === 0) {
    logger.warn(`Geocoding found no match for "${query}"`);
    return null;
  }

  const top = results[0] as { lat?: unknown; lon?: unknown };
  const lat = parseFloat(String(top.lat));
  const lng = parseFloat(String(top.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    logger.error(`Geocoding returned a non-numeric coordinate for "${query}"`);
    return null;
  }

  return { lat, lng };
}
