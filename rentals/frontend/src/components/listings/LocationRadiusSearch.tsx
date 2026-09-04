'use client';

import { useState, useRef, useEffect } from 'react';
import { MapPin, LocateFixed, X, Loader2 } from 'lucide-react';
import { useFilterStore } from '@/store/filterStore';
import { geocodeApi } from '@/lib/api';
import { requestUserLocation, GEOLOCATION_ERROR_TITLE, type GeolocationFailureReason } from '@/lib/geolocation';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 10;

/**
 * Renter-facing "search a location + radius" filter. Sets the SAME
 * `filters.lat`/`filters.lng`/`filters.radiusKm` the app's existing radius
 * filter already reads (browse/page.tsx, map/page.tsx, GET /listings) --
 * this widget only adds a way to populate them from free text or the
 * user's own location, not a second/parallel filtering mechanism.
 *
 * The search text itself is local UI state only, never sent anywhere but
 * the one-off GET /geocode lookup, and never persisted -- clearing or
 * replacing the search loses it, same as the resolved point does once
 * filters are reset.
 */
export default function LocationRadiusSearch() {
  const { filters, setFilters, setMapCenter } = useFilterStore();
  const [query, setQuery] = useState('');
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const { toast } = useToast();

  const hasActiveLocation = filters.lat != null && filters.lng != null;

  // If filters.lat/lng change to something this widget didn't itself just
  // set (e.g. the separate City picker set them instead), the previously
  // resolved label would otherwise keep describing the wrong point --
  // fall back to the generic label instead of a stale, now-inaccurate one.
  const lastSetRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (filters.lat == null || filters.lng == null) return;
    const last = lastSetRef.current;
    if (!last || last.lat !== filters.lat || last.lng !== filters.lng) {
      setResolvedLabel(null);
    }
  }, [filters.lat, filters.lng]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await geocodeApi.search(q);
      lastSetRef.current = { lat: res.data.lat, lng: res.data.lng };
      setFilters({ lat: res.data.lat, lng: res.data.lng, radiusKm: filters.radiusKm || 5 });
      setMapCenter([res.data.lat, res.data.lng]);
      setResolvedLabel(q);
    } catch {
      toast({
        variant: 'destructive',
        title: "Couldn't find that location",
        description: 'Try a different search, e.g. a neighbourhood, city, or address.',
      });
    } finally {
      setSearching(false);
    }
  }

  async function handleUseMyLocation() {
    setLocating(true);
    try {
      const { lat, lng } = await requestUserLocation();
      lastSetRef.current = { lat, lng };
      setFilters({ lat, lng, radiusKm: filters.radiusKm || 5 });
      setMapCenter([lat, lng]);
      setQuery('');
      setResolvedLabel('your current location');
    } catch (err: any) {
      const reason: GeolocationFailureReason = err?.reason ?? 'unknown';
      toast({ variant: 'destructive', title: GEOLOCATION_ERROR_TITLE[reason], description: err?.message });
    } finally {
      setLocating(false);
    }
  }

  function handleClear() {
    lastSetRef.current = null;
    setFilters({ lat: undefined, lng: undefined });
    setQuery('');
    setResolvedLabel(null);
  }

  return (
    <div className="p-4 bg-white border border-ink/8 rounded-2xl shadow-card">
      <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
        Search a location
      </label>
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Scarborough, or an address..."
            className="input-field pl-8 pr-8 py-2 text-sm h-10"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search text"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="btn-brand px-4 py-2 text-sm h-10 disabled:opacity-60 flex items-center gap-1.5"
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
        </button>
        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={locating}
          aria-label="Use my current location"
          title="Use my current location"
          className="w-10 h-10 shrink-0 rounded-full border border-ink/10 flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          <LocateFixed size={16} className={cn('text-brand-700', locating && 'animate-pulse')} />
        </button>
      </form>

      {hasActiveLocation && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-muted">
              Showing listings near <span className="font-semibold text-ink">{resolvedLabel || 'the selected location'}</span>
            </p>
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-600"
            >
              <X size={12} /> Clear
            </button>
          </div>

          <div className="flex justify-between mb-1">
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">Radius</label>
            <span className="text-xs font-bold text-brand-700">{filters.radiusKm || MIN_RADIUS_KM} km</span>
          </div>
          <input
            type="range"
            min={MIN_RADIUS_KM}
            max={MAX_RADIUS_KM}
            step={1}
            value={filters.radiusKm || MIN_RADIUS_KM}
            onChange={(e) => setFilters({ radiusKm: parseInt(e.target.value, 10) })}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>{MIN_RADIUS_KM} km</span><span>{MAX_RADIUS_KM} km</span>
          </div>
        </div>
      )}
    </div>
  );
}
