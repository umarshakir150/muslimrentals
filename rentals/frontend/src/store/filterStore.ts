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
  // Matches the location-search widget's 1-10km slider range (see
  // LocationRadiusSearch.tsx) -- irrelevant until filters.lat/lng are also
  // set (browse/map only ever send radiusKm alongside a real lat/lng), so
  // this is just a sensible starting value for the slider itself.
  radiusKm: 5,
  sort: 'newest',
  furnished: false,
  parking: false,
  utilities: false,
  page: 1,
};

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
