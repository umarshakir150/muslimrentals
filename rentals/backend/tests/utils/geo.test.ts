import { describe, it, expect } from 'vitest';
import { distKm, getApproximateLocation, toPublicListingLocation, PRIVACY_RADIUS_METERS, MAX_DISPLACEMENT_METERS } from '../../src/utils/geo';

describe('distKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(distKm(43.6532, -79.3832, 43.6532, -79.3832)).toBeCloseTo(0, 5);
  });

  it('computes a known great-circle distance (Toronto to Ottawa, ~350km)', () => {
    const km = distKm(43.6532, -79.3832, 45.4215, -75.6972);
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(360);
  });

  it('is symmetric regardless of point order', () => {
    const a = distKm(43.6532, -79.3832, 45.4215, -75.6972);
    const b = distKm(45.4215, -75.6972, 43.6532, -79.3832);
    expect(a).toBeCloseTo(b, 10);
  });

  it('respects a radius filter boundary (inside vs. outside)', () => {
    const centerLat = 43.6532;
    const centerLng = -79.3832;
    const nearby = distKm(centerLat, centerLng, 43.66, -79.39); // a few km away
    const farAway = distKm(centerLat, centerLng, 45.4215, -75.6972); // ~350km away

    expect(nearby).toBeLessThan(10);
    expect(farAway).toBeGreaterThan(10);
  });

  it('returns a small positive distance between two nearby Toronto neighbourhoods', () => {
    // Kensington Market vs. Financial District, Toronto
    const d = distKm(43.6547, -79.4005, 43.6488, -79.3818);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(5);
  });

  it('returns a large distance between two distant cities', () => {
    // Toronto vs. Vancouver
    const d = distKm(43.6532, -79.3832, 49.2827, -123.1207);
    expect(d).toBeGreaterThan(3000);
  });
});

describe('getApproximateLocation', () => {
  const TORONTO = { lat: 43.6532, lng: -79.3832 };

  it('is stable: the same id + coordinates always produce the exact same offset point', () => {
    const a = getApproximateLocation('listing-1', TORONTO.lat, TORONTO.lng);
    const b = getApproximateLocation('listing-1', TORONTO.lat, TORONTO.lng);
    expect(a).toEqual(b);
  });

  it('never returns the real coordinates unchanged', () => {
    const p = getApproximateLocation('listing-1', TORONTO.lat, TORONTO.lng);
    expect(p.lat).not.toBe(TORONTO.lat);
    expect(p.lng).not.toBe(TORONTO.lng);
  });

  it('always offsets the real point by less than PRIVACY_RADIUS_METERS (the "somewhere in this circle" guarantee)', () => {
    // A handful of different real-world-ish seeds/coordinates, not just one.
    const cases: [string, number, number][] = [
      ['listing-a', 43.6532, -79.3832],
      ['listing-b', 45.4215, -75.6972],
      ['listing-c', 49.2827, -123.1207],
      ['00000000-0000-4000-8000-000000000000', 43.6547, -79.4005],
    ];
    for (const [id, lat, lng] of cases) {
      const p = getApproximateLocation(id, lat, lng);
      const offsetMeters = distKm(lat, lng, p.lat, p.lng) * 1000;
      expect(offsetMeters).toBeGreaterThan(0);
      expect(offsetMeters).toBeLessThan(PRIVACY_RADIUS_METERS);
    }
  });

  it('never offsets suspiciously close to the real point either (stays at least MIN_DISPLACEMENT_METERS away)', () => {
    const p = getApproximateLocation('listing-1', TORONTO.lat, TORONTO.lng);
    const offsetMeters = distKm(TORONTO.lat, TORONTO.lng, p.lat, p.lng) * 1000;
    expect(offsetMeters).toBeGreaterThanOrEqual(50 - 1); // MIN_DISPLACEMENT_METERS; -1 for floating-point slack
  });

  it('never offsets beyond MAX_DISPLACEMENT_METERS either (the safety margin that makes "guaranteed inside the circle" hold even after the equirectangular-vs-geodesic rounding, not just approximately)', () => {
    // Exhaustively over many seeds rather than trusting one sample -- the
    // upper bound is the one that matters for the "always inside the
    // circle" guarantee, so it gets the most scrutiny here.
    for (let i = 0; i < 200; i++) {
      const p = getApproximateLocation(`margin-check-${i}`, TORONTO.lat, TORONTO.lng);
      const offsetMeters = distKm(TORONTO.lat, TORONTO.lng, p.lat, p.lng) * 1000;
      expect(offsetMeters).toBeLessThanOrEqual(MAX_DISPLACEMENT_METERS + 1); // +1 for floating-point slack
    }
  });

  it('keeps a clear numeric margin between MAX_DISPLACEMENT_METERS and PRIVACY_RADIUS_METERS -- the actual mathematical fact the "guaranteed inside the circle" claim rests on', () => {
    expect(MAX_DISPLACEMENT_METERS).toBeLessThan(PRIVACY_RADIUS_METERS);
    // Sanity-check the margin is comfortably larger than the equirectangular
    // approximation's error bound (~1e-9 relative, i.e. sub-millimeter
    // absolute at these distances -- see the comment on
    // getApproximateLocation) so this isn't a hairline-close boundary.
    expect(PRIVACY_RADIUS_METERS - MAX_DISPLACEMENT_METERS).toBeGreaterThanOrEqual(5);
  });

  it('different listing ids at the same real coordinates get different approximate points', () => {
    const a = getApproximateLocation('listing-1', TORONTO.lat, TORONTO.lng);
    const b = getApproximateLocation('listing-2', TORONTO.lat, TORONTO.lng);
    expect(a).not.toEqual(b);
  });

  it('moving the real coordinates changes the approximate point, even for the same id', () => {
    const a = getApproximateLocation('listing-1', TORONTO.lat, TORONTO.lng);
    const b = getApproximateLocation('listing-1', TORONTO.lat + 0.01, TORONTO.lng);
    expect(a).not.toEqual(b);
  });

  // Regression coverage added after a founder-reported live observation of
  // a ~1km-off public marker. This computes the REAL geodesic (haversine)
  // distance -- not the equirectangular approximation getApproximateLocation
  // itself uses to build the offset -- between the real and approximate
  // point for a large batch of ids across several cities/latitudes
  // (equator-adjacent, mid-latitude, and near-polar all behave differently
  // for the longitude/cosine scaling this function does), and asserts none
  // of them ever exceed PRIVACY_RADIUS_METERS. It also reports the actual
  // observed maximum so that figure is a real measured value, not a claim.
  describe('real-world geodesic distance never exceeds the configured privacy radius (multi-city, multi-latitude)', () => {
    // Deliberately spans representative Canadian coordinates/latitudes --
    // this app's actual serving area -- east/west/north/south across the
    // country, PLUS non-Canadian equatorial/southern-hemisphere points so
    // the longitude/cosine scaling in getApproximateLocation (which behaves
    // differently at each latitude) is exercised well beyond just "one city."
    const CITIES: [string, number, number][] = [
      ['Toronto, ON', 43.6532, -79.3832],
      ['Vancouver, BC', 49.2827, -123.1207],
      ['Ottawa, ON', 45.4215, -75.6972],
      ['Calgary, AB', 51.0447, -114.0719],
      ['Montreal, QC', 45.5019, -73.5674],
      ['Winnipeg, MB', 49.8951, -97.1384],
      ['Halifax, NS', 44.6488, -63.5752],
      ['Yellowknife, NT (subarctic)', 62.4540, -114.3718],
      ['Iqaluit, NU (near-polar, extreme longitude scaling)', 63.7467, -68.5170],
      ['Alert, NU (Canada high-arctic, most extreme case this app can plausibly serve)', 82.5018, -62.3481],
      ['Quito (near-equator, minimal longitude scaling)', -0.1807, -78.4678],
      ['Singapore (near-equator, other hemisphere)', 1.3521, 103.8198],
      ['Sydney (mid-latitude, southern hemisphere)', -33.8688, 151.2093],
      ['Ushuaia (high-latitude, southern hemisphere)', -54.8019, -68.3030],
    ];
    const SAMPLES_PER_CITY = 100;

    it('stays STRICTLY within PRIVACY_RADIUS_METERS for every sample across every city/latitude, and reports the real observed range', () => {
      let maxObservedMeters = 0;
      let minObservedMeters = Infinity;

      for (const [city, lat, lng] of CITIES) {
        for (let i = 0; i < SAMPLES_PER_CITY; i++) {
          const id = `${city}-listing-${i}`;
          const approx = getApproximateLocation(id, lat, lng);
          const offsetMeters = distKm(lat, lng, approx.lat, approx.lng) * 1000;

          // Strictly less than the displayed radius -- this is the "real
          // property is guaranteed inside the displayed circle" claim,
          // checked against the REAL (haversine) distance, not the
          // flat-plane approximation the offset itself was built from.
          expect(offsetMeters).toBeLessThan(PRIVACY_RADIUS_METERS);
          expect(offsetMeters).toBeGreaterThanOrEqual(50 - 1); // MIN_DISPLACEMENT_METERS
          expect(offsetMeters).toBeLessThanOrEqual(MAX_DISPLACEMENT_METERS + 1);

          maxObservedMeters = Math.max(maxObservedMeters, offsetMeters);
          minObservedMeters = Math.min(minObservedMeters, offsetMeters);
        }
      }

      // Not a fixed assertion on the exact figure (it depends on the PRNG
      // sequence for these specific ids) -- logged so the real measured
      // maximum is visible in CI output/test review, per the explicit ask
      // to report the actual maximum displacement after this fix.
      // eslint-disable-next-line no-console
      console.log(
        `getApproximateLocation: observed displacement range across ${CITIES.length} cities x ${SAMPLES_PER_CITY} samples = ` +
        `${minObservedMeters.toFixed(1)}m - ${maxObservedMeters.toFixed(1)}m (configured radius: ${PRIVACY_RADIUS_METERS}m)`
      );
      expect(maxObservedMeters).toBeLessThan(PRIVACY_RADIUS_METERS);
    });
  });

  // Directly proves the exact invariant the founder asked for --
  // distance(privateCoordinate, approximatePublicCenter) <= displayedPrivacyRadius
  // -- using `toPublicListingLocation`'s OWN returned `locationPrecisionRadiusM`
  // as "displayedPrivacyRadius" (the actual value the client draws its circle
  // with) rather than re-importing PRIVACY_RADIUS_METERS a second time. This
  // is what actually rules out the two numbers ever drifting apart (the
  // literal "mismatch" scenario this pass was asked to guard against),
  // exercised through the same function GET /listings and GET /listings/:id
  // call for every public response.
  describe('distance(privateCoordinate, approximatePublicCenter) <= displayedPrivacyRadius', () => {
    const SAMPLE_COORDINATES: [number, number][] = [
      [43.6532, -79.3832],   // Toronto
      [49.2827, -123.1207],  // Vancouver
      [45.5019, -73.5674],   // Montreal
      [62.4540, -114.3718],  // Yellowknife
      [63.7467, -68.5170],   // Iqaluit
      [82.5018, -62.3481],   // Alert, Nunavut
      [-0.1807, -78.4678],   // Quito
      [-33.8688, 151.2093],  // Sydney
    ];

    it('holds for hundreds of deterministic listings across every sample coordinate', () => {
      for (const [lat, lng] of SAMPLE_COORDINATES) {
        for (let i = 0; i < 100; i++) {
          const listing = { id: `invariant-check-${lat}-${lng}-${i}`, lat, lng, address: '123 Real St', unit: null };
          const pub = toPublicListingLocation(listing);

          const privateCoordinate = { lat, lng };
          const approximatePublicCenter = { lat: pub.lat, lng: pub.lng };
          const displayedPrivacyRadius = pub.locationPrecisionRadiusM;

          const distanceMeters = distKm(
            privateCoordinate.lat, privateCoordinate.lng,
            approximatePublicCenter.lat, approximatePublicCenter.lng
          ) * 1000;

          expect(distanceMeters).toBeLessThanOrEqual(displayedPrivacyRadius);
        }
      }
    });
  });
});

describe('toPublicListingLocation', () => {
  const listing = {
    id: 'listing-1',
    title: 'Cozy 2BR',
    lat: 43.6532,
    lng: -79.3832,
    address: '123 Real Street',
    unit: 'Unit 4',
  };

  it('drops the address entirely', () => {
    const result = toPublicListingLocation(listing);
    expect(result).not.toHaveProperty('address');
  });

  it('drops the unit/apartment number entirely', () => {
    const result = toPublicListingLocation(listing);
    expect(result).not.toHaveProperty('unit');
  });

  it('replaces lat/lng with the approximate point, not the real one', () => {
    const result = toPublicListingLocation(listing);
    expect(result.lat).not.toBe(listing.lat);
    expect(result.lng).not.toBe(listing.lng);
  });

  it('flags the result as approximate with its precision radius', () => {
    const result = toPublicListingLocation(listing);
    expect(result.locationApproximate).toBe(true);
    expect(result.locationPrecisionRadiusM).toBe(PRIVACY_RADIUS_METERS);
  });

  it('preserves every other field unchanged', () => {
    const result = toPublicListingLocation(listing);
    expect(result.id).toBe(listing.id);
    expect(result.title).toBe(listing.title);
  });

  it('is stable across repeated calls on the same listing', () => {
    const a = toPublicListingLocation(listing);
    const b = toPublicListingLocation(listing);
    expect(a.lat).toBe(b.lat);
    expect(a.lng).toBe(b.lng);
  });
});
