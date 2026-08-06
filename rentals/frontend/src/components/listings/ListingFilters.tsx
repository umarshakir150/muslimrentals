'use client';

import { useState } from 'react';
import { SlidersHorizontal, X, Search, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFilterStore, hasActiveFilters } from '@/store/filterStore';
import { cn, formatCAD } from '@/lib/utils';
import CityAutocomplete from '@/components/ui/CityAutocomplete';

// Audience labels without emojis for a cleaner horizontal bar
const AUDIENCE_OPTIONS = [
  { v: 'all',      label: 'Everyone' },
  { v: 'BROTHERS', label: 'Brothers' },
  { v: 'SISTERS',  label: 'Sisters' },
  { v: 'COUPLES',  label: 'Couples' },
  { v: 'FAMILIES', label: 'Families' },
];

const SORT_OPTIONS = [
  { v: 'newest',    label: 'Newest' },
  { v: 'priceLow',  label: 'Price: Low' },
  { v: 'priceHigh', label: 'Price: High' },
];

// Shared by the "Min beds" and "Min baths" selects: 1-4 show a bare number,
// 5 is the top bucket and reads "5+" (selecting it means "5 or more").
const MIN_COUNT_OPTIONS = [1, 2, 3, 4, 5].map(n => ({ value: n, label: n === 5 ? '5+' : String(n) }));

export default function ListingFilters() {
  const { filters, setFilter, setFilters, resetFilters } = useFilterStore();
  const [moreOpen, setMoreOpen] = useState(false);

  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="w-full">
      {/* ── Row 1: main search + city + audience + sort + more button ── */}
      <div className="flex flex-wrap gap-2 items-center">

        {/* Keyword search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={filters.keyword || ''}
            onChange={e => setFilter('keyword', e.target.value)}
            placeholder="Search listings..."
            className="input-field pl-8 py-2.5 text-sm h-10"
          />
        </div>

        {/* City */}
        <div className="flex-1 min-w-[160px] max-w-xs">
          <CityAutocomplete
            value={filters.city || ''}
            onChange={(city, coords) =>
              setFilters({ city, ...(coords ? { lat: coords[0], lng: coords[1] } : {}) })
            }
            placeholder="City..."
            label="City"
            className="py-2.5 text-sm h-10"
          />
        </div>

        {/* Audience pills */}
        <div className="flex gap-1.5 flex-wrap">
          {AUDIENCE_OPTIONS.map(opt => (
            <button
              key={opt.v}
              onClick={() => setFilter('audience', opt.v as any)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap',
                filters.audience === opt.v
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-ink/10 text-muted bg-white hover:border-brand-300 hover:text-ink'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="relative">
          <select
            value={filters.sort || 'newest'}
            onChange={e => setFilter('sort', e.target.value as any)}
            className="appearance-none bg-white border border-ink/10 rounded-full px-4 pr-8 py-2 text-xs font-semibold text-ink cursor-pointer hover:border-brand-300 focus:outline-none focus:border-brand-500 h-9"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        </div>

        {/* More filters toggle */}
        <button
          onClick={() => setMoreOpen(v => !v)}
          className={cn(
            'flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-semibold transition-all h-9',
            moreOpen || filtersActive
              ? 'border-brand-500 bg-brand-50 text-brand-700'
              : 'border-ink/10 bg-white text-muted hover:border-brand-300 hover:text-ink'
          )}
        >
          <SlidersHorizontal size={13} />
          More
          {filtersActive && (
            <span className="w-4 h-4 rounded-full bg-brand-600 text-white text-[9px] flex items-center justify-center font-bold">
              !
            </span>
          )}
        </button>

        {/* Reset (only shown when filters are active) */}
        {filtersActive && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 px-3 py-2 rounded-full border border-red-200 text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 transition-all h-9"
          >
            <X size={12} /> Reset
          </button>
        )}
      </div>

      {/* ── Row 2: expandable "more filters" panel ── */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-3 p-4 bg-white border border-ink/8 rounded-2xl shadow-card">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">

                {/* Min beds */}
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                    Min beds
                  </label>
                  <select
                    value={filters.minBeds || 0}
                    onChange={e => setFilter('minBeds', parseInt(e.target.value))}
                    className="input-field appearance-none py-2 text-sm"
                  >
                    <option value={0}>Any</option>
                    {MIN_COUNT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {/* Min baths */}
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                    Min baths
                  </label>
                  <select
                    value={filters.minBaths || 0}
                    onChange={e => setFilter('minBaths', parseInt(e.target.value))}
                    className="input-field appearance-none py-2 text-sm"
                  >
                    <option value={0}>Any</option>
                    {MIN_COUNT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {/* Max price */}
                <div className="col-span-2 sm:col-span-1">
                  <div className="flex justify-between mb-1.5">
                    <label className="text-xs font-semibold text-muted uppercase tracking-wider">Max price</label>
                    <span className="text-xs font-bold text-brand-700">{formatCAD(filters.maxPrice || 5000)}/mo</span>
                  </div>
                  <input
                    type="range"
                    min={500} max={10000} step={100}
                    value={filters.maxPrice || 5000}
                    onChange={e => setFilter('maxPrice', parseInt(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-muted mt-0.5">
                    <span>$500</span><span>$10k+</span>
                  </div>
                </div>

                {/* Radius */}
                <div className="col-span-2 sm:col-span-1">
                  <div className="flex justify-between mb-1.5">
                    <label className="text-xs font-semibold text-muted uppercase tracking-wider">Radius</label>
                    <span className="text-xs font-bold text-brand-700">{filters.radiusKm} km</span>
                  </div>
                  <input
                    type="range"
                    min={5} max={250} step={5}
                    value={filters.radiusKm || 80}
                    onChange={e => setFilter('radiusKm', parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                {/* Amenity toggles */}
                <div className="col-span-2 sm:col-span-2">
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Amenities</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'furnished', label: 'Furnished' },
                      { key: 'parking',   label: 'Parking' },
                      { key: 'utilities', label: 'Utilities incl.' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setFilter(key as any, !filters[key as keyof typeof filters])}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                          filters[key as keyof typeof filters]
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-ink/10 text-muted bg-white hover:border-brand-300 hover:text-ink'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
