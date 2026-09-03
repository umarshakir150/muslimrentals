import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';

/**
 * Regression coverage for the production bug where navigating away from
 * /map before Leaflet's dynamically-imported chunk finished loading left a
 * Leaflet map instance (tiles, markers, listeners, global window bridge)
 * dangling in the DOM on top of whatever page the user navigated to.
 *
 * FullMap/MiniMap initialize Leaflet inside an async IIFE nested in a
 * useEffect. The effect's cleanup only removed the map if that async
 * assignment had already completed by the time cleanup ran — if the user
 * unmounted first, cleanup was a no-op, then the async callback finished
 * afterwards and built a full, orphaned Leaflet instance with no
 * registered cleanup.
 *
 * These tests mock `leaflet`/`leaflet.markercluster` behind a promise we
 * control, unmount the component *before* resolving it (reproducing the
 * exact race), then resolve it and assert the component's own
 * cancellation guard tears the map down immediately instead of attaching
 * tiles/markers/listeners to an unmounted tree.
 *
 * What this test CANNOT catch (must be verified in a real browser):
 * real Leaflet DOM/CSS pane leftovers, actual visual overlap/z-index
 * issues, or browser back/forward (bfcache) navigation — jsdom has no
 * real layout/painting and Leaflet is fully mocked here.
 */

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

  const L: any = {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    divIcon: vi.fn(),
    marker: vi.fn(() => ({ bindPopup: vi.fn(), addTo: vi.fn() })),
    circle: vi.fn(() => ({ addTo: vi.fn() })),
    markerClusterGroup: vi.fn(() => ({ addLayer: vi.fn(), clearLayers: vi.fn() })),
    Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
  };

  return { L, mapInstance };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.resetModules();
  delete (window as any).__mapListingClick;
});

describe('FullMap unmount-before-init race', () => {
  it('immediately removes a Leaflet map created after the component has already unmounted', async () => {
    let resolveLeafletImport!: (mod: unknown) => void;
    const leafletImportPromise = new Promise((resolve) => {
      resolveLeafletImport = resolve;
    });

    vi.doMock('leaflet', () => leafletImportPromise);
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const { default: FullMap } = await import('../FullMap');

    const { unmount } = render(
      createElement(FullMap, {
        listings: [],
        center: [43, -79],
        onCentreChange: vi.fn(),
        onListingClick: vi.fn(),
      })
    );

    // Navigate away before the dynamic import('leaflet') resolves.
    unmount();

    const { L } = buildFakeLeafletModule();
    resolveLeafletImport({ default: L });

    await flushMicrotasks();

    // The cancellation guard must bail out before ever constructing the map —
    // nothing should get attached (tiles/markers/listeners/global bridge) to
    // an already-unmounted tree.
    expect(L.map).not.toHaveBeenCalled();
    expect(L.tileLayer).not.toHaveBeenCalled();
    expect(L.markerClusterGroup).not.toHaveBeenCalled();
    expect((window as any).__mapListingClick).toBeUndefined();
  });

  it('tears down a fully-initialized map, its ResizeObserver and its global click bridge on normal unmount', async () => {
    const { L, mapInstance } = buildFakeLeafletModule();

    vi.doMock('leaflet', () => Promise.resolve({ default: L }));
    vi.doMock('leaflet.markercluster', () => Promise.resolve({}));

    const disconnect = vi.fn();
    class FakeResizeObserver {
      observe() {}
      disconnect() {
        disconnect();
      }
    }
    (global as any).ResizeObserver = FakeResizeObserver;

    const { default: FullMap } = await import('../FullMap');

    const { unmount } = render(
      createElement(FullMap, {
        listings: [],
        center: [43, -79],
        onCentreChange: vi.fn(),
        onListingClick: vi.fn(),
      })
    );

    await flushMicrotasks();

    expect(L.map).toHaveBeenCalledTimes(1);
    expect(typeof (window as any).__mapListingClick).toBe('function');

    unmount();

    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect((window as any).__mapListingClick).toBeUndefined();
  });
});

describe('MiniMap unmount-before-init race', () => {
  it('immediately removes a Leaflet map created after the component has already unmounted', async () => {
    let resolveLeafletImport!: (mod: unknown) => void;
    const leafletImportPromise = new Promise((resolve) => {
      resolveLeafletImport = resolve;
    });

    vi.doMock('leaflet', () => leafletImportPromise);

    const { default: MiniMap } = await import('../MiniMap');

    const { unmount } = render(createElement(MiniMap));

    unmount();

    const { L } = buildFakeLeafletModule();
    resolveLeafletImport({ default: L });

    await flushMicrotasks();

    // The cancellation guard must bail out before ever constructing the map.
    expect(L.map).not.toHaveBeenCalled();
    expect(L.tileLayer).not.toHaveBeenCalled();
    expect(L.marker).not.toHaveBeenCalled();
  });

  it('tears down a fully-initialized map on normal unmount', async () => {
    const { L, mapInstance } = buildFakeLeafletModule();

    vi.doMock('leaflet', () => Promise.resolve({ default: L }));

    const { default: MiniMap } = await import('../MiniMap');

    const { unmount } = render(createElement(MiniMap));

    await flushMicrotasks();

    expect(L.map).toHaveBeenCalledTimes(1);

    unmount();

    expect(mapInstance.remove).toHaveBeenCalledTimes(1);
  });
});
