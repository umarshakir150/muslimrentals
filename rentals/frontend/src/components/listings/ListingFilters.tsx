'use client';

import { useState } from 'react';
import { SlidersHorizontal, X, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFilterStore } from '@/store/filterStore';
import { cn, formatCAD } from '@/lib/utils';
import CityAutocomplete from '@/components/ui/CityAutocomplete';

export default function ListingFilters() {
  const { filters, setFilter, setFilters, resetFilters } = useFilterStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const audienceOptions = [
    { v: 'all', label: 'Everyone' },
    { v: 'BROTHERS', label: '🧔 Brothers' },
    { v: 'SISTERS', label: '🧕 Sisters' },
    { v: 'COUPLES', label: '💑 Couples' },
    { v: 'FAMILIES', label: '👨‍👩‍👧 Families' },
  ];

  const FilterPanel = () => (
    <div className="space-y-5">
      {/* Search */}
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Keyword</label>
        <input
          type="text"
          value={filters.keyword || ''}
          onChange={e => setFilter('keyword', e.target.value)}
          placeholder="Search listings..."
          className="input-field"
        />
      </div>

      {/* City */}
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">City</label>
        <CityAutocomplete
          value={filters.city || ''}
          onChange={(city, coords) => {
            setFilters({ city, ...(coords ? { lat: coords[0], lng: coords[1] } : {}) });
          }}
          placeholder="Search city..."
        />
      </div>

      {/* Audience */}
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Suitable for</label>
        <div className="flex flex-wrap gap-2">
          {audienceOptions.map(opt => (
            <button
              key={opt.v}
              onClick={() => setFilter('audience', opt.v as any)}
              className={cn('px-3.5 py-2 rounded-full text-sm font-semibold border-2 transition-all',
                filters.audience === opt.v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink/10 text-muted hover:border-brand-300')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Beds / Baths */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Min. bedrooms</label>
          <select
            value={filters.minBeds || 0}
            onChange={e => setFilter('minBeds', parseInt(e.target.value))}
            className="input-field appearance-none"
          >
            <option value={0}>Any</option>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}+</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Min. bathrooms</label>
          <select
            value={filters.minBaths || 0}
            onChange={e => setFilter('minBaths', parseInt(e.target.value))}
            className="input-field appearance-none"
          >
            <option value={0}>Any</option>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}+</option>)}
          </select>
        </div>
      </div>

      {/* Price range */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-xs font-semibold text-muted uppercase tracking-wider">Max price</label>
          <span className="text-sm font-bold text-brand-700">{formatCAD(filters.maxPrice || 5000)}/mo</span>
        </div>
        <input
          type="range"
          min={500}
          max={10000}
          step={100}
          value={filters.maxPrice || 5000}
          onChange={e => setFilter('maxPrice', parseInt(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted mt-1">
          <span>$500</span>
          <span>$10,000+</span>
        </div>
      </div>

      {/* Radius */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-xs font-semibold text-muted uppercase tracking-wider">Search radius</label>
          <span className="text-sm font-bold text-brand-700">{filters.radiusKm} km</span>
        </div>
        <input
          type="range"
          min={5}
          max={250}
          step={5}
          value={filters.radiusKm || 80}
          onChange={e => setFilter('radiusKm', parseInt(e.target.value))}
          className="w-full"
        />
      </div>

      {/* Amenity toggles */}
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Amenities</label>
        <div className="space-y-2">
          {[
            { key: 'furnished', label: 'Furnished' },
            { key: 'parking', label: 'Parking included' },
            { key: 'utilities', label: 'Utilities included' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between cursor-pointer group">
              <span className="text-sm font-medium group-hover:text-brand-700 transition-colors">{label}</span>
              <div
                onClick={() => setFilter(key as any, !filters[key as keyof typeof filters])}
                className={cn(
                  'w-11 h-6 rounded-full border-2 transition-all relative cursor-pointer',
                  filters[key as keyof typeof filters] ? 'bg-brand-600 border-brand-600' : 'bg-gray-100 border-gray-200'
                )}
              >
                <div className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all',
                  filters[key as keyof typeof filters] ? 'left-5' : 'left-0.5'
                )} />
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Sort by</label>
        <select
          value={filters.sort || 'newest'}
          onChange={e => setFilter('sort', e.target.value as any)}
          className="input-field appearance-none"
        >
          <option value="newest">Newest first</option>
          <option value="priceLow">Price: Low to high</option>
          <option value="priceHigh">Price: High to low</option>
          <option value="beds">Most bedrooms</option>
        </select>
      </div>

      {/* Reset */}
      <button onClick={resetFilters} className="w-full py-2.5 rounded-xl border-2 border-ink/10 text-sm font-semibold text-muted hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all">
        Reset all filters
      </button>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <FilterPanel />
      </div>

      {/* Mobile filter button + drawer */}
      <div className="lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center gap-2 px-5 py-3 bg-white border border-ink/10 rounded-full shadow-card text-sm font-semibold hover:border-brand-400 transition-colors"
        >
          <SlidersHorizontal size={16} />
          Filters
          {(filters.city || filters.audience !== 'all' || filters.furnished || filters.parking) && (
            <span className="w-5 h-5 rounded-full bg-brand-600 text-white text-xs flex items-center justify-center font-bold">!</span>
          )}
        </button>

        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] bg-ink/50 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            >
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 260 }}
                className="absolute left-0 top-0 bottom-0 w-[90vw] max-w-sm bg-white overflow-y-auto shadow-elevated"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-ink/8 sticky top-0 bg-white z-10">
                  <h3 className="font-semibold">Filters</h3>
                  <button onClick={() => setMobileOpen(false)} className="p-2 rounded-full hover:bg-gray-100">
                    <X size={18} />
                  </button>
                </div>
                <div className="p-5">
                  <FilterPanel />
                </div>
                <div className="sticky bottom-0 bg-white border-t border-ink/8 px-5 py-4">
                  <button onClick={() => setMobileOpen(false)} className="btn-brand w-full py-3">Apply filters</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
