/**
 * Thin, framework-free wrapper around the browser Geolocation API --
 * extracted so the permission/error-mapping logic can be regression-tested
 * by mocking `navigator.geolocation` directly, without mounting a real map.
 *
 * Nothing here requests permission on its own -- `requestUserLocation` only
 * ever runs when a caller (the "Locate me" button's click handler) invokes
 * it, and nothing here persists or sends the result anywhere; it's returned
 * to the caller and that's the end of its lifecycle on our side.
 */

export type GeolocationFailureReason =
  | 'unsupported'   // navigator.geolocation doesn't exist (old/unusual browser)
  | 'denied'        // user declined the permission prompt
  | 'unavailable'   // position could not be determined
  | 'timeout'       // took too long
  | 'unknown';

export interface GeolocationFailure {
  reason: GeolocationFailureReason;
  message: string;
}

export interface GeolocationSuccess {
  lat: number;
  lng: number;
  accuracyM: number;
}

// GeolocationPositionError's codes are 1/2/3 for denied/unavailable/timeout
// respectively (there is no error code for "unsupported" -- that's detected
// separately below, before this function is ever reached).
function describeError(err: GeolocationPositionError): GeolocationFailure {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return { reason: 'denied', message: 'Location permission was denied. You can allow it in your browser settings and try again.' };
    case err.POSITION_UNAVAILABLE:
      return { reason: 'unavailable', message: "Your location couldn't be determined right now. Please try again." };
    case err.TIMEOUT:
      return { reason: 'timeout', message: 'Finding your location took too long. Please try again.' };
    default:
      return { reason: 'unknown', message: "Something went wrong finding your location." };
  }
}

// Shared short toast-title copy per failure reason -- used by every UI that
// calls requestUserLocation (FullMap's "Locate me" button and
// LocationRadiusSearch's "Use my location" button) so the two don't drift
// into slightly different wording for the same underlying failure.
export const GEOLOCATION_ERROR_TITLE: Record<GeolocationFailureReason, string> = {
  unsupported: "Location isn't supported",
  denied: 'Location permission denied',
  unavailable: "Couldn't find your location",
  timeout: 'Location request timed out',
  unknown: "Couldn't find your location",
};

export function isGeolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

// Resolves with the current position, or rejects with a GeolocationFailure
// (never a raw GeolocationPositionError/exception) so callers don't need
// their own switch-on-error-code logic.
export function requestUserLocation(): Promise<GeolocationSuccess> {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      reject({ reason: 'unsupported', message: "Your browser doesn't support location. Try a different browser or enter your address manually." } satisfies GeolocationFailure);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        });
      },
      (err) => reject(describeError(err)),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  });
}
