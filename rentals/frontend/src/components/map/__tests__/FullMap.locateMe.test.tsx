import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';

/**
 * Coverage for the "Locate me" button introduced to replace the meaningless
 * green dashed search-radius circle that used to always render on the map
 * regardless of any user action. Real Leaflet is mocked (same established
 * pattern as mapCleanup.test.tsx); the actual permission/error-mapping
 * logic itself is covered on its own, framework-free, in
 * lib/__tests__/geolocation.test.ts -- this file only proves FullMap wires
 * that up correctly: no auto-request on mount, a marker/pan on success,
 * and a visible error (never a silent failure) for every failure reason.
 */

const { requestUserLocationMock } = vi.hoisted(() => ({ requestUserLocationMock: vi.fn() }));
vi.mock('@/lib/geolocation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/geolocation')>();
  return { ...actual, requestUserLocation: requestUserLocationMock };
});

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

function buildFakeLeafletModule() {
  const mapInstance = {
    remove: vi.fn(),
    on: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    invalidateSize: vi.fn(),
    setView: vi.fn(),
    getZoom: vi.fn(() => 7),
    getCenter: vi.fn(() => ({ lat: 43, lng: -79 })),
  };

  const markerInstance = { bindPopup: vi.fn(), addTo: vi.fn(() => markerInstance), on: vi.fn() };

  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => markerInstance),
    circle: vi.fn(() => ({ addTo: vi.fn() })),
    markerClusterGroup: vi.fn(() => ({ addLayer: vi.fn(), clearLayers: vi.fn() })),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance, markerInstance };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function renderMountedFullMap() {
  const { L, mapInstance, markerInstance } = buildFakeLeafletModule();
  vi.doMock('leaflet', () => Promise.resolve({ default: L }));
  vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

  const { default: FullMap } = await import('../FullMap');
  const utils = render(
    createElement(FullMap, {
      listings: [],
      center: [43, -79] as [number, number],
      onCentreChange: vi.fn(),
      onListingClick: vi.fn(),
    })
  );
  await flushMicrotasks();
  return { ...utils, L, mapInstance, markerInstance };
}

beforeEach(() => {
  vi.resetModules();
  requestUserLocationMock.mockReset();
  toastMock.mockReset();
});

describe('FullMap "Locate me" button', () => {
  it('renders a distinct location button and never requests geolocation on mount', async () => {
    await renderMountedFullMap();

    expect(screen.getByRole('button', { name: /show my location/i })).toBeInTheDocument();
    expect(requestUserLocationMock).not.toHaveBeenCalled();
  });

  it('requests geolocation only after the button is pressed', async () => {
    requestUserLocationMock.mockReturnValue(new Promise(() => {})); // never resolves, just checking the call
    await renderMountedFullMap();
    const user = userEvent.setup();

    expect(requestUserLocationMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /show my location/i }));
    expect(requestUserLocationMock).toHaveBeenCalledTimes(1);
  });

  it('on success: pans/centers the map and places a "You are here" marker distinct from a listing marker', async () => {
    requestUserLocationMock.mockResolvedValue({ lat: 45.4215, lng: -75.6972, accuracyM: 20 });
    const { mapInstance, L } = await renderMountedFullMap();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /show my location/i }));
    await waitFor(() => expect(mapInstance.setView).toHaveBeenCalledWith([45.4215, -75.6972], 14, { animate: true }));

    // The marker icon HTML must not reuse the listing/price-bubble class.
    const iconCall = L.divIcon.mock.calls.find((c: any) => typeof c[0]?.html === 'string' && c[0].html.includes('user-location-marker'));
    expect(iconCall).toBeTruthy();
    expect(iconCall[0].html).not.toContain('rental-marker');
  });

  it('removes the previous "You are here" marker before placing a new one on a second locate', async () => {
    requestUserLocationMock.mockResolvedValue({ lat: 45.4215, lng: -75.6972, accuracyM: 20 });
    const { mapInstance } = await renderMountedFullMap();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /show my location/i }));
    await waitFor(() => expect(mapInstance.setView).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /show my location/i }));
    await waitFor(() => expect(mapInstance.setView).toHaveBeenCalledTimes(2));

    expect(mapInstance.removeLayer).toHaveBeenCalledTimes(1); // the first marker, removed before the second is added
  });

  it('shows a visible error (not a silent failure) when permission is denied', async () => {
    requestUserLocationMock.mockRejectedValue({ reason: 'denied', message: 'Location permission was denied.' });
    await renderMountedFullMap();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /show my location/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Location permission denied',
      variant: 'destructive',
    })));
  });

  it('shows a visible error when the browser does not support geolocation', async () => {
    requestUserLocationMock.mockRejectedValue({ reason: 'unsupported', message: "Your browser doesn't support location." });
    await renderMountedFullMap();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /show my location/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Location isn't supported",
    })));
  });

  it('shows a visible error on position-unavailable', async () => {
    requestUserLocationMock.mockRejectedValue({ reason: 'unavailable', message: "Couldn't be determined." });
    await renderMountedFullMap();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /show my location/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't find your location",
    })));
  });

  it('shows a visible error on timeout', async () => {
    requestUserLocationMock.mockRejectedValue({ reason: 'timeout', message: 'Took too long.' });
    await renderMountedFullMap();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /show my location/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Location request timed out',
    })));
  });

  it('does not leave the button stuck in a loading state after a failure', async () => {
    requestUserLocationMock.mockRejectedValue({ reason: 'denied', message: 'Denied.' });
    await renderMountedFullMap();
    const user = userEvent.setup();

    const button = screen.getByRole('button', { name: /show my location/i });
    await user.click(button);

    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
