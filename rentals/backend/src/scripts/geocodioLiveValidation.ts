/**
 * LIVE Geocodio validation -- real network calls to api.geocod.io through
 * this repo's actual geocodeAddress/verifyConfirmedPinLocation functions
 * (src/utils/geocode.ts). No mocks, no fixtures, no simulated responses,
 * no Nominatim-derived coordinates -- every coordinate printed here comes
 * back from Geocodio itself.
 *
 * Requires GEOCODIO_API_KEY and GEOCODING_PROVIDER=geocodio in the
 * environment already -- this script never reads, prints, or logs the
 * key itself; it only lets utils/geocode.ts pick it up via process.env.
 *
 * Run from rentals/backend, on the claude/geocodio-spike branch:
 *   GEOCODIO_API_KEY="$(cat /path/to/key/file)" GEOCODING_PROVIDER=geocodio \
 *     npx ts-node src/scripts/geocodioLiveValidation.ts
 *
 * Passing the key via a file/secret-manager substitution like the above
 * (rather than typing it into the command) keeps it out of shell history.
 */
import { geocodeAddress, verifyConfirmedPinLocation } from '../utils/geocode';

async function report(label: string, run: () => Promise<any>) {
  console.log(`\n=== ${label} ===`);
  try {
    const result = await run();
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (e: any) {
    console.log(`THREW: ${e.constructor.name}: ${e.message}`);
    return e;
  }
}

async function main() {
  if (!process.env.GEOCODIO_API_KEY || !process.env.GEOCODIO_API_KEY.trim()) {
    console.error('GEOCODIO_API_KEY is not set in the environment. Aborting -- no request will be made.');
    process.exit(1);
  }
  if ((process.env.GEOCODING_PROVIDER || '').trim().toLowerCase() !== 'geocodio') {
    console.error('GEOCODING_PROVIDER must be set to "geocodio". Aborting.');
    process.exit(1);
  }

  await report(
    '1051 Cedarglen Gate, Mississauga, ON -- LIVE forward geocode',
    () => geocodeAddress('1051 Cedarglen Gate', 'Mississauga', 'ON', { requirePreciseMatch: true }),
  );

  await report(
    '732 Mill St, Windsor, ON -- LIVE forward geocode',
    () => geocodeAddress('732 Mill St', 'Windsor', 'ON', { requirePreciseMatch: true }),
  );

  await report(
    '1031 Askin, Windsor, ON -- LIVE forward geocode (bare street name, no suffix)',
    () => geocodeAddress('1031 Askin', 'Windsor', 'ON', { requirePreciseMatch: true }),
  );

  await report(
    '1031 Askin Avenue, Windsor, ON -- LIVE forward geocode (full street name given directly)',
    () => geocodeAddress('1031 Askin Avenue', 'Windsor', 'ON', { requirePreciseMatch: true }),
  );

  // Reverse: a legitimate pin inside Windsor, ON -- must pass city/province
  // validation. Real, well-known Windsor, ON coordinate (City Hall area).
  await report(
    'Reverse-geocode a legitimate Windsor, ON pin (42.3149, -83.0364) -- should PASS validation',
    () => verifyConfirmedPinLocation(42.3149, -83.0364, 'Windsor', 'ON'),
  );

  // Reverse: deliberately wrong city -- a real Toronto, ON coordinate,
  // verified against Windsor -- must FAIL validation.
  await report(
    'Reverse-geocode a deliberately wrong-city pin (43.6532, -79.3832, actually Toronto) -- verifying against Windsor, ON -- should FAIL validation',
    () => verifyConfirmedPinLocation(43.6532, -79.3832, 'Windsor', 'ON'),
  );

  console.log('\nDone.');
}

main();
