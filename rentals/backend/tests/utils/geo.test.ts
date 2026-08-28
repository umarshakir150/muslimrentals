import { describe, it, expect } from 'vitest';
import { distKm } from '../../src/utils/geo';

describe('distKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(distKm(43.6532, -79.3832, 43.6532, -79.3832)).toBe(0);
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
});
