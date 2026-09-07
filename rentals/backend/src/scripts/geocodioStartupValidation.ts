/**
 * TEMPORARY: one-time live Geocodio validation, run from inside the server
 * process at startup -- not a publicly reachable endpoint. Gated by
 * RUN_GEOCODIO_LIVE_VALIDATION=true so it never runs unless explicitly
 * armed for this one evaluation. Uses the exact same geocodeAddress/
 * verifyConfirmedPinLocation functions the listing-posting flow calls --
 * no mocks, no fixtures, real calls to whichever provider
 * GEOCODING_PROVIDER is currently set to (Geocodio during this
 * evaluation).
 *
 * Logs ONLY sanitized fields (label, coordinates, city/province,
 * accuracy/accuracy_type, our own confidence classification, pass/fail).
 * Never logs the API key, any request URL (which would contain
 * api_key=...), or any other credential -- utils/geocode.ts's own
 * request-building code already never logs the URL either; this file
 * additionally never even sees the key or the URL, since it only calls
 * the already-abstracted geocodeAddress/verifyConfirmedPinLocation
 * functions.
 *
 * Removed, along with the RUN_GEOCODIO_LIVE_VALIDATION flag, immediately
 * after this one evaluation is complete.
 */
import { logger } from '../utils/logger';
import { geocodeAddress, verifyConfirmedPinLocation } from '../utils/geocode';

const MARK = '[geocodio-startup-validation]';

async function runForward(label: string, address: string, city: string, province: string) {
  try {
    const result = await geocodeAddress(address, city, province, { requirePreciseMatch: true });
    if (!result) {
      logger.warn(`${MARK} FORWARD FAIL -- "${label}": no candidate resolved to the requested street/city/province.`);
      return;
    }
    logger.info(
      `${MARK} FORWARD ${result.confidence === 'precise' ? 'PASS' : 'PARTIAL'} -- "${label}": ` +
      `lat=${result.lat}, lng=${result.lng}, confidence=${result.confidence ?? 'unknown'}`
    );
  } catch (err: any) {
    logger.error(`${MARK} FORWARD ERROR -- "${label}": ${err.constructor.name}: ${err.message}`);
  }
}

async function runReverse(label: string, lat: number, lng: number, city: string, province: string, expectPass: boolean) {
  try {
    const result = await verifyConfirmedPinLocation(lat, lng, city, province);
    const matchesExpectation = result.ok === expectPass;
    logger.info(
      `${MARK} REVERSE ${matchesExpectation ? 'PASS' : 'FAIL'} -- "${label}": ` +
      `ok=${result.ok} (expected ${expectPass}), reason="${result.reason}"`
    );
  } catch (err: any) {
    logger.error(`${MARK} REVERSE ERROR -- "${label}": ${err.constructor.name}: ${err.message}`);
  }
}

export async function runGeocodioStartupValidation(): Promise<void> {
  if ((process.env.RUN_GEOCODIO_LIVE_VALIDATION || '').trim().toLowerCase() !== 'true') return;

  logger.info(`${MARK} START -- provider=${process.env.GEOCODING_PROVIDER || 'nominatim'}`);

  await runForward('1051 Cedarglen Gate, Mississauga, ON', '1051 Cedarglen Gate', 'Mississauga', 'ON');
  await runForward('732 Mill St, Windsor, ON', '732 Mill St', 'Windsor', 'ON');
  await runForward('1031 Askin, Windsor, ON (bare street name)', '1031 Askin', 'Windsor', 'ON');
  await runForward('1031 Askin Avenue, Windsor, ON (full street name)', '1031 Askin Avenue', 'Windsor', 'ON');

  // Legitimate Windsor, ON pin -- must PASS.
  await runReverse('Legitimate Windsor, ON pin', 42.3149, -83.0364, 'Windsor', 'ON', true);
  // Deliberately wrong-city pin (real Toronto coordinates, checked against Windsor) -- must FAIL.
  await runReverse('Deliberately wrong-city pin (Toronto coords vs Windsor)', 43.6532, -79.3832, 'Windsor', 'ON', false);

  logger.info(`${MARK} END`);
}
