import { describe, it, expect } from 'vitest';
import { findNeighbourhoodCoords } from '@/lib/neighbourhood';
import type { NeighbourhoodEntry } from '@/lib/api';

const TORONTO_CENTER: [number, number] = [43.6532, -79.3832];

const entries: NeighbourhoodEntry[] = [
  { name: 'Kensington Market', city: 'Toronto', lat: 43.6547, lng: -79.4005 },
  { name: 'North York', city: 'Toronto', lat: 43.7615, lng: -79.4111 },
  { name: 'Scarborough', city: 'Toronto', lat: 43.7764, lng: -79.2318 },
];

describe('findNeighbourhoodCoords', () => {
  it('resolves a selected neighbourhood to its own real coordinates, not the city center', () => {
    const coords = findNeighbourhoodCoords(entries, 'Kensington Market');
    expect(coords).toEqual([43.6547, -79.4005]);
    expect(coords).not.toEqual(TORONTO_CENTER);
  });

  it('produces distinct coordinates for distinct neighbourhoods in the same city', () => {
    const a = findNeighbourhoodCoords(entries, 'North York');
    const b = findNeighbourhoodCoords(entries, 'Scarborough');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toEqual(b);
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(findNeighbourhoodCoords(entries, '  kensington market  ')).toEqual([43.6547, -79.4005]);
  });

  it('returns undefined for free text with no curated match, never a fabricated coordinate', () => {
    expect(findNeighbourhoodCoords(entries, 'Somewhere Made Up')).toBeUndefined();
  });

  it('returns undefined when the city has no seeded entries at all', () => {
    expect(findNeighbourhoodCoords([], 'Anything')).toBeUndefined();
  });
});
