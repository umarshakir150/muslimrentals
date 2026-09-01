import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// RTL's automatic afterEach cleanup only registers itself when it detects Jest's
// globals; since this project imports test APIs explicitly instead of using
// vitest's `globals: true`, unmount rendered trees between tests ourselves.
afterEach(() => {
  cleanup();
});

// jsdom's window.scrollTo is a stub that logs "not implemented" to stderr;
// framer-motion calls it while measuring keyframes. Silence the noise.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', {
    value: () => {},
    writable: true,
    configurable: true,
  });
}

// jsdom does not implement Element.scrollIntoView at all (throws "not a
// function"); Inbox.tsx calls it to keep the message thread scrolled down.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement matchMedia; framer-motion's useReducedMotion calls it on mount.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom does not implement ResizeObserver; FullMap uses it to keep the
// Leaflet map sized correctly when its container resizes.
if (typeof globalThis !== 'undefined' && !(globalThis as any).ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}
