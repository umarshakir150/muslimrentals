import { describe, it, expect } from 'vitest';
import { CANADIAN_CITIES } from '../../src/data/cities';
import { NEIGHBOURHOODS } from '../../src/data/neighbourhoods';

describe('neighbourhood coordinate coverage/resolution', () => {
  it('gives every seeded city at least one real neighbourhood option', () => {
    const covered = new Set(NEIGHBOURHOODS.map(n => `${n.city}|${n.province}`));
    const missing = CANADIAN_CITIES.filter(c => !covered.has(`${c.name}|${c.province}`));
    expect(missing).toEqual([]);
  });

  it('has no duplicate (city, province, name) entries', () => {
    const keys = NEIGHBOURHOODS.map(n => `${n.city}|${n.province}|${n.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every neighbourhood has real, in-range Canadian-ish coordinates', () => {
    for (const n of NEIGHBOURHOODS) {
      expect(n.lat).toBeGreaterThan(41);
      expect(n.lat).toBeLessThan(84);
      expect(n.lng).toBeGreaterThan(-141);
      expect(n.lng).toBeLessThan(-52);
    }
  });

  it('multi-neighbourhood cities resolve to distinct coordinates, not one shared city-center point', () => {
    const byCity = new Map<string, typeof NEIGHBOURHOODS>();
    for (const n of NEIGHBOURHOODS) {
      const key = `${n.city}|${n.province}`;
      byCity.set(key, [...(byCity.get(key) ?? []), n]);
    }
    for (const [key, list] of byCity) {
      if (list.length < 2) continue;
      const coordKeys = new Set(list.map(n => `${n.lat},${n.lng}`));
      expect(coordKeys.size, `${key} neighbourhoods should have distinct coordinates`).toBe(list.length);
    }
  });

  it('a multi-neighbourhood city like Toronto resolves each option to a coordinate that is not the raw city-center fallback', () => {
    const toronto = CANADIAN_CITIES.find(c => c.name === 'Toronto')!;
    const torontoNeighbourhoods = NEIGHBOURHOODS.filter(n => n.city === 'Toronto' && n.province === 'ON');
    expect(torontoNeighbourhoods.length).toBeGreaterThan(1);
    const allMatchCityCenter = torontoNeighbourhoods.every(
      n => n.lat === toronto.lat && n.lng === toronto.lng
    );
    expect(allMatchCityCenter).toBe(false);
  });
});
