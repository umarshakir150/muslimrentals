import { describe, it, expect } from 'vitest';
import { distKm } from '../../src/utils/geo';

describe('distKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(distKm(43.6532, -79.3832, 43.6532, -79.3832)).toBeCloseTo(0, 5);
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
