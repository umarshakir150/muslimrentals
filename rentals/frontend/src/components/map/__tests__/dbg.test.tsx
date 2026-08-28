import { describe, it, expect } from 'vitest';

describe('test environment', () => {
  it('provides a ResizeObserver stub (FullMap depends on it existing)', () => {
    expect(typeof (globalThis as any).ResizeObserver).toBe('function');
  });
});
