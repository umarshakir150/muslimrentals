import type { NeighbourhoodEntry } from './api';

/**
 * Resolves a selected neighbourhood name to real, curated coordinates from
 * the fetched entry list for the current city -- never a city-center guess.
 * Returns undefined if the name isn't a known entry (caller keeps whatever
 * coordinates were already set, e.g. the city's).
 */
export function findNeighbourhoodCoords(
  entries: NeighbourhoodEntry[],
  name: string
): [number, number] | undefined {
  const match = entries.find(e => e.name.toLowerCase() === name.trim().toLowerCase());
  return match ? [match.lat, match.lng] : undefined;
}
