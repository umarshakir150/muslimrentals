'use client';

import { useState } from 'react';
import { SlidersHorizontal, X, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFilterStore } from '@/store/filterStore';
import { cn, formatCAD } from '@/lib/utils';
import CityAutocomplete from '@/components/ui/CityAutocomplete';
import { Input, SelectField } from '@/components/ui/Field';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import Surface from '@/components/ui/Surface';
import LocationRadiusSearch from './LocationRadiusSearch';

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
  { v: 'beds',      label: 'Most beds' },
];

interface ListingFiltersProps {
  // Passed through to LocationRadiusSearch's embedded mini-map preview only
  // -- see its own doc comment. Never used for filtering here.
  listings?: { id: string; lat: number; lng: number }[];
}

export default function ListingFilters({ listings }: ListingFiltersProps) {
  const { filters, setFilter, setFilters, resetFilters } = useFilterStore();
  const [moreOpen, setMoreOpen] = useState(false);

  const hasActiveFilters =
    !!filters.city ||
    filters.lat != null ||
    (filters.audience && filters.audience !== 'all') ||
    filters.furnished ||
    filters.parking ||
    filters.utilities ||
    (filters.minBeds && filters.minBeds > 0) ||
    (filters.minBaths && filters.minBaths > 0) ||
    (filters.maxPrice && filters.maxPrice < 5000);

  return (
    <div className="w-full">
      {/* ── Row 1: main search + city + audience + sort + more button ── */}
      <div className="flex flex-wrap gap-2 items-center">

        {/* Keyword search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none z-10" />
          <Input
            type="text"
            value={filters.keyword || ''}
            onChange={e => setFilter('keyword', e.target.value)}
            placeholder="Search listings..."
            className="pl-8"
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
            className="h-10 py-2.5 text-sm"
          />
        </div>

        {/* Audience pills -- already the correct neutral toggle pattern, not touched */}
        <div className="flex gap-1.5 flex-wrap">
          {AUDIENCE_OPTIONS.map(opt => (
            <button
              key={opt.v}
              onClick={() => setFilter('audience', opt.v as any)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap',
                filters.audience === opt.v
                  ? 'border-forest-500 bg-forest-50 text-forest-700'
                  : 'border-neutral-300 text-neutral-600 bg-white hover:border-forest-300 hover:text-neutral-900'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <SelectField
          value={filters.sort || 'newest'}
          onChange={e => setFilter('sort', e.target.value as any)}
          className="w-[150px]"
          aria-label="Sort listings"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.v} value={o.v}>{o.label}</option>
          ))}
        </SelectField>

        {/* More filters toggle */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setMoreOpen(v => !v)}
          className={cn('gap-1.5', (moreOpen || hasActiveFilters) && 'border-forest-500 bg-forest-50 text-forest-700')}
        >
          <SlidersHorizontal size={13} />
          More
          {hasActiveFilters && (
            <span className="w-4 h-4 rounded-full bg-forest-600 text-white text-[9px] flex items-center justify-center font-bold">
              !
            </span>
          )}
        </Button>

        {/* Reset (only shown when filters are active) */}
        {hasActiveFilters && (
          <Button type="button" variant="destructive-ghost" size="sm" onClick={resetFilters} className="gap-1">
            <X size={12} /> Reset
          </Button>
        )}
      </div>

      {/* ── Row 2: location + radius search -- always visible, composes with
          keyword/city/other filters rather than replacing them ── */}
      <div className="mt-3">
        <LocationRadiusSearch listings={listings} />
      </div>

      {/* ── Row 3: expandable "more filters" panel ── */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <Surface className="mt-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">

                {/* Min beds */}
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-1.5">
                    Min beds
                  </label>
                  <SelectField
                    value={filters.minBeds || 0}
                    onChange={e => setFilter('minBeds', parseInt(e.target.value))}
                  >
                    <option value={0}>Any</option>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}+</option>)}
                  </SelectField>
                </div>

                {/* Min baths */}
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-1.5">
                    Min baths
                  </label>
                  <SelectField
                    value={filters.minBaths || 0}
                    onChange={e => setFilter('minBaths', parseInt(e.target.value))}
                  >
                    <option value={0}>Any</option>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}+</option>)}
                  </SelectField>
                </div>

                {/* Max price */}
                <div className="col-span-2 sm:col-span-1">
                  <div className="flex justify-between mb-1.5">
                    <label className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">Max price</label>
                    <span className="text-xs font-bold text-forest-700">{formatCAD(filters.maxPrice || 5000)}/mo</span>
                  </div>
                  <input
                    type="range"
                    min={500} max={10000} step={100}
                    value={filters.maxPrice || 5000}
                    onChange={e => setFilter('maxPrice', parseInt(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-neutral-500 mt-0.5">
                    <span>$500</span><span>$10k+</span>
                  </div>
                </div>

                {/* Amenity toggles */}
                <div className="col-span-2 sm:col-span-2">
                  <label className="block text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-2">Amenities</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'furnished', label: 'Furnished' },
                      { key: 'parking',   label: 'Parking' },
                      { key: 'utilities', label: 'Utilities incl.' },
                    ].map(({ key, label }) => (
                      <Chip
                        key={key}
                        active={!!filters[key as keyof typeof filters]}
                        onClick={() => setFilter(key as any, !filters[key as keyof typeof filters])}
                      >
                        {label}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>
            </Surface>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
