import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver; FullMap uses it to keep the
// Leaflet map sized correctly when its container resizes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;
