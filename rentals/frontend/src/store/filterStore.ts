import { create } from 'zustand';
import { ListingFilters } from '@/types';

interface FilterStore {
  filters: ListingFilters;
  mapCenter: [number, number];
  setFilter: <K extends keyof ListingFilters>(key: K, value: ListingFilters[K]) => void;
  setFilters: (filters: Partial<ListingFilters>) => void;
  resetFilters: () => void;
  setMapCenter: (center: [number, number]) => void;
}

const DEFAULT_FILTERS: ListingFilters = {
  keyword: '',
  city: '',
  audience: 'all',
  minBeds: 0,
  minBaths: 0,
  maxPrice: 5000,
  radiusKm: 80,
  sort: 'newest',
  furnished: false,
  parking: false,
  utilities: false,
  page: 1,
};

// Single source of truth for "does the user currently have any filter applied"
// - reused by the filter bar's active-filter indicator and by pages deciding
// between a "no listings at all" vs. "no listings match your filters" empty state.
export function hasActiveFilters(filters: ListingFilters): boolean {
  return !!(
    filters.keyword ||
    filters.city ||
    (filters.audience && filters.audience !== 'all') ||
    filters.furnished ||
    filters.parking ||
    filters.utilities ||
    (filters.minBeds && filters.minBeds > 0) ||
    (filters.minBaths && filters.minBaths > 0) ||
    (filters.maxPrice && filters.maxPrice < (DEFAULT_FILTERS.maxPrice ?? 5000))
  );
}

export const useFilterStore = create<FilterStore>((set) => ({
  filters: { ...DEFAULT_FILTERS },
  mapCenter: [43.6532, -79.3832],

  setFilter: (key, value) =>
    set((s) => ({ filters: { ...s.filters, [key]: value, page: key !== 'page' ? 1 : s.filters.page } })),

  setFilters: (filters) =>
    set((s) => ({ filters: { ...s.filters, ...filters, page: 1 } })),

  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS }, mapCenter: [43.6532, -79.3832] }),

  setMapCenter: (mapCenter) => set({ mapCenter }),
}));
