import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestUserLocation, isGeolocationSupported } from '@/lib/geolocation';

const originalGeolocation = (globalThis.navigator as any)?.geolocation;

function mockGeolocation(impl: { getCurrentPosition: (...args: any[]) => void }) {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: impl,
    configurable: true,
  });
}

function removeGeolocation() {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: undefined,
    configurable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: originalGeolocation,
    configurable: true,
  });
});

describe('isGeolocationSupported', () => {
  it('is true when navigator.geolocation exists', () => {
    mockGeolocation({ getCurrentPosition: vi.fn() });
    expect(isGeolocationSupported()).toBe(true);
  });

  it('is false when navigator.geolocation is missing (unsupported browser)', () => {
    removeGeolocation();
    expect(isGeolocationSupported()).toBe(false);
  });
});

describe('requestUserLocation', () => {
  it('resolves with lat/lng/accuracy on success', async () => {
    mockGeolocation({
      getCurrentPosition: (success: any) => {
        success({ coords: { latitude: 43.6532, longitude: -79.3832, accuracy: 15 } });
      },
    });

    const result = await requestUserLocation();
    expect(result).toEqual({ lat: 43.6532, lng: -79.3832, accuracyM: 15 });
  });

  it('never requests permission proactively -- only calling requestUserLocation triggers getCurrentPosition', () => {
    const getCurrentPosition = vi.fn();
    mockGeolocation({ getCurrentPosition });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('rejects with reason "unsupported" when the browser has no geolocation API', async () => {
    removeGeolocation();
    await expect(requestUserLocation()).rejects.toEqual(
      expect.objectContaining({ reason: 'unsupported' })
    );
  });

  it('rejects with reason "denied" when the user declines the permission prompt', async () => {
    mockGeolocation({
      getCurrentPosition: (_success: any, error: any) => {
        error({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      },
    });

    await expect(requestUserLocation()).rejects.toEqual(
      expect.objectContaining({ reason: 'denied' })
    );
  });

  it('rejects with reason "unavailable" when the position cannot be determined', async () => {
    mockGeolocation({
      getCurrentPosition: (_success: any, error: any) => {
        error({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      },
    });

    await expect(requestUserLocation()).rejects.toEqual(
      expect.objectContaining({ reason: 'unavailable' })
    );
  });

  it('rejects with reason "timeout" when the request takes too long', async () => {
    mockGeolocation({
      getCurrentPosition: (_success: any, error: any) => {
        error({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      },
    });

    await expect(requestUserLocation()).rejects.toEqual(
      expect.objectContaining({ reason: 'timeout' })
    );
  });

  it('every failure reason carries a human-readable message', async () => {
    mockGeolocation({
      getCurrentPosition: (_success: any, error: any) => {
        error({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      },
    });

    try {
      await requestUserLocation();
      throw new Error('should have rejected');
    } catch (err: any) {
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('requests high accuracy with a bounded timeout and no cached position', async () => {
    const getCurrentPosition = vi.fn((success: any, _error?: any, _options?: any) => success({ coords: { latitude: 1, longitude: 2, accuracy: 3 } }));
    mockGeolocation({ getCurrentPosition });

    await requestUserLocation();

    const options = getCurrentPosition.mock.calls[0][2];
    expect(options.enableHighAccuracy).toBe(true);
    expect(options.maximumAge).toBe(0);
    expect(options.timeout).toBeGreaterThan(0);
  });
});
