'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MapPin, LocateFixed, X, Loader2, Search } from 'lucide-react';
import { useFilterStore } from '@/store/filterStore';
import { geocodeApi, PlaceSuggestion } from '@/lib/api';
import { requestUserLocation, GEOLOCATION_ERROR_TITLE, type GeolocationFailureReason } from '@/lib/geolocation';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import SearchRadiusMiniMap from './SearchRadiusMiniMap';

const MIN_RADIUS_KM = 0.5;
const MAX_RADIUS_KM = 10;
const RADIUS_STEP_KM = 0.5;

// Matches the backend's own `q: z.string().trim().min(2)` -- no point
// firing a request for a query the API will reject outright.
const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 350;
// Caps the in-memory per-query-text suggestion cache (see
// suggestionCacheRef) -- comfortably more than a renter would type in one
// sitting, without letting it grow unbounded.
const SUGGESTION_CACHE_MAX_ENTRIES = 30;

/**
 * Renter-facing "search a location + radius" filter. Sets the SAME
 * `filters.lat`/`filters.lng`/`filters.radiusKm` the app's existing radius
 * filter already reads (browse/page.tsx, map/page.tsx, GET /listings) --
 * this widget only adds a way to populate them from a selected place/
 * address/city, the user's own location, or -- unchanged -- an existing
 * city/neighbourhood pick made elsewhere (CityAutocomplete), not a second/
 * parallel filtering mechanism.
 *
 * As-you-type autocomplete (GET /geocode/suggestions) rather than a single
 * resolve-on-submit lookup: resolves specific places/addresses (e.g. "Toldo
 * Lancer Centre"), not just areas, and a genuinely ambiguous query (a street
 * name that exists in more than one city) surfaces multiple candidates for
 * the renter to pick from instead of silently guessing the top one.
 *
 * The search text itself is local UI state only, sent only to the one-off
 * GET /geocode/suggestions lookup on each debounced keystroke, and never
 * persisted -- clearing or replacing the search loses it, same as the
 * resolved point does once filters are reset.
 *
 * Also renders a small embedded map preview (SearchRadiusMiniMap) right
 * alongside these controls -- so a renter can see what a search covers
 * without switching to the full /map page. `listings` is optional and
 * purely a display nicety for that preview (already-filtered results the
 * caller has on hand); this widget's own filtering behavior never depends
 * on it.
 */
interface LocationRadiusSearchProps {
  listings?: { id: string; lat: number; lng: number }[];
}

export default function LocationRadiusSearch({ listings = [] }: LocationRadiusSearchProps) {
  const { filters, setFilters, setMapCenter } = useFilterStore();
  const [query, setQuery] = useState('');
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  // Distinguishes "haven't searched yet" from "searched, found nothing" --
  // the latter shows an explicit "No matching places found" row instead of
  // just an empty (and therefore closed) dropdown, so an ambiguous/no-result
  // search is a visible state, not indistinguishable from not having typed
  // anything yet.
  const [searchedEmpty, setSearchedEmpty] = useState(false);
  // Feedback for the manual Enter/Search path (handleDirectSearch) only --
  // distinct from `searchedEmpty` above, which describes the autocomplete
  // dropdown's own "no suggestions" state. 'not_found' shows a persistent
  // inline message (never a transient toast) and deliberately leaves the
  // typed query text untouched so the renter can edit and retry, per the
  // explicit requirement that a manual search never blocks/clears on
  // failure.
  const [directSearchState, setDirectSearchState] = useState<'idle' | 'searching' | 'not_found'>('idle');
  // Only ever set true by a manual-search address resolve whose Geocodio
  // result was accepted but not rooftop-confirmed (accuracyType
  // 'range_interpolation', see geocodeApi.resolve's own doc comment) --
  // never presented as if it were exact. Reset alongside resolvedLabel
  // wherever that's reset, since both describe the same resolved point.
  const [isApproximateLocation, setIsApproximateLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const { toast } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Small in-memory cache (this render session only, never persisted) keyed
  // by normalized query text -- avoids re-fetching identical suggestions
  // when a renter retypes/backspaces-then-retypes the same text, or revisits
  // a query they already typed earlier in the same search. Only successful
  // results are cached (never an error/rate-limit outcome, so a transient
  // failure doesn't get "stuck" for that text). Capped and FIFO-evicted
  // (Map preserves insertion order) so this can never grow unbounded across
  // a long browsing session.
  const suggestionCacheRef = useRef<Map<string, PlaceSuggestion[]>>(new Map());

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
      setIsApproximateLocation(false);
    }
  }, [filters.lat, filters.lng]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const runSearch = useCallback(async (q: string) => {
    const cacheKey = q.trim().toLowerCase();
    const cached = suggestionCacheRef.current.get(cacheKey);
    if (cached) {
      // Still bumps requestIdRef so any earlier, still-in-flight network
      // request for a DIFFERENT query correctly finds itself superseded --
      // a cache hit is a valid, newer "result" for staleness purposes too.
      ++requestIdRef.current;
      setSuggestions(cached);
      setSearchedEmpty(cached.length === 0);
      setOpen(true);
      setFocusIdx(-1);
      return;
    }

    const requestId = ++requestIdRef.current;
    setSearching(true);
    try {
      const res = await geocodeApi.suggestions(q);
      if (requestIdRef.current !== requestId) return; // superseded by a newer keystroke

      const cache = suggestionCacheRef.current;
      cache.set(cacheKey, res.data);
      if (cache.size > SUGGESTION_CACHE_MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }

      setSuggestions(res.data);
      setSearchedEmpty(res.data.length === 0);
      setOpen(true);
      setFocusIdx(-1);
    } catch {
      if (requestIdRef.current !== requestId) return;
      // A transient/rate-limit failure while typing shouldn't interrupt
      // typing with a disruptive toast -- just show the same "no results"
      // row a genuine no-match would; "Use my location" and manually typing
      // a plainer query remain available. Deliberately NOT cached -- a
      // retry of the same text should hit the network again rather than
      // being stuck on a transient failure for the rest of the session.
      setSuggestions([]);
      setSearchedEmpty(true);
      setOpen(true);
    } finally {
      if (requestIdRef.current === requestId) setSearching(false);
    }
  }, []);

  // Manual "search whatever I typed" path -- autocomplete suggestions are
  // assistance, never a required gate. Always resolves the COMPLETE current
  // input text via GET /geocode/resolve (see geocodeApi.resolve's own doc
  // comment for why that's a distinct, purpose-built lookup rather than
  // just taking suggestions[0]) -- never the highlighted/top suggestion,
  // since the renter may have kept typing past the last suggestion fetch,
  // or want a place the dropdown never surfaced at all. On success this has
  // the exact same effect as selecting a suggestion (filters + mini-map);
  // on "not found" the typed text is deliberately left in place so the
  // renter can edit and retry, rather than being cleared.
  const handleDirectSearch = useCallback(async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestIdRef.current++; // supersede any in-flight/cached autocomplete write
    setOpen(false);
    setSearching(true);
    setDirectSearchState('searching');
    try {
      const res = await geocodeApi.resolve(q);
      const { lat, lng, precision } = res.data;
      lastSetRef.current = { lat, lng };
      setFilters({ lat, lng, radiusKm: filters.radiusKm || 5 });
      setMapCenter([lat, lng]);
      setResolvedLabel(q);
      setIsApproximateLocation(precision === 'approximate');
      setSuggestions([]);
      setSearchedEmpty(false);
      setDirectSearchState('idle');
    } catch (err: any) {
      if (err?.status === 404) {
        setDirectSearchState('not_found');
      } else {
        setDirectSearchState('idle');
        toast({
          variant: 'destructive',
          title: 'Search failed',
          description: err?.message || 'Please try again in a minute.',
        });
      }
    } finally {
      setSearching(false);
    }
  }, [filters.radiusKm, setFilters, setMapCenter, toast]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setDirectSearchState('idle');
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestIdRef.current++; // invalidate any in-flight search
      setSuggestions([]);
      setSearchedEmpty(false);
      setOpen(false);
      setSearching(false);
      return;
    }

    debounceRef.current = setTimeout(() => runSearch(trimmed), SEARCH_DEBOUNCE_MS);
  }

  function selectSuggestion(suggestion: PlaceSuggestion) {
    lastSetRef.current = { lat: suggestion.lat, lng: suggestion.lng };
    setFilters({ lat: suggestion.lat, lng: suggestion.lng, radiusKm: filters.radiusKm || 5 });
    setMapCenter([suggestion.lat, suggestion.lng]);
    setResolvedLabel(suggestion.label);
    setIsApproximateLocation(false);
    setQuery(suggestion.label);
    setSuggestions([]);
    setSearchedEmpty(false);
    setOpen(false);
    setFocusIdx(-1);
    setDirectSearchState('idle');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && suggestions.length > 0 && focusIdx >= 0) {
        // An explicit keyboard-highlighted suggestion -- honor it.
        selectSuggestion(suggestions[focusIdx]);
      } else {
        // No explicit highlight -- whether because there are no
        // suggestions, they're irrelevant, or the renter simply hasn't
        // arrowed to one -- resolve the complete text they actually typed,
        // never whichever suggestion happens to be listed first.
        handleDirectSearch(query);
      }
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Escape') { setOpen(false); setFocusIdx(-1); }
  }

  async function handleUseMyLocation() {
    setLocating(true);
    try {
      const { lat, lng } = await requestUserLocation();
      lastSetRef.current = { lat, lng };
      setFilters({ lat, lng, radiusKm: filters.radiusKm || 5 });
      setMapCenter([lat, lng]);
      setQuery('');
      setSuggestions([]);
      setSearchedEmpty(false);
      setDirectSearchState('idle');
      setOpen(false);
      setResolvedLabel('your current location');
      setIsApproximateLocation(false);
    } catch (err: any) {
      const reason: GeolocationFailureReason = err?.reason ?? 'unknown';
      toast({ variant: 'destructive', title: GEOLOCATION_ERROR_TITLE[reason], description: err?.message });
    } finally {
      setLocating(false);
    }
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestIdRef.current++;
    lastSetRef.current = null;
    setFilters({ lat: undefined, lng: undefined });
    setQuery('');
    setSuggestions([]);
    setSearchedEmpty(false);
    setDirectSearchState('idle');
    setOpen(false);
    setResolvedLabel(null);
    setIsApproximateLocation(false);
  }

  function clearQueryText() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestIdRef.current++;
    setQuery('');
    setSuggestions([]);
    setSearchedEmpty(false);
    setDirectSearchState('idle');
    setOpen(false);
    inputRef.current?.focus();
  }

  const miniMapCenter: [number, number] | null =
    hasActiveLocation ? [filters.lat as number, filters.lng as number] : null;
  const miniMapRadiusKm = hasActiveLocation ? (filters.radiusKm || MIN_RADIUS_KM) : null;

  return (
    <div className="p-4 bg-white border border-ink/8 rounded-2xl shadow-card">
      {/* The grid (and the mini-map itself) only exists once a location is
          active -- showing an empty map before any search feels redundant,
          so the widget starts in its plain, compact single-column form and
          only grows into the 2-column layout on a successful resolve. Once
          shown, it stacks under the radius slider on mobile/narrow layouts
          (natural DOM order) and sits beside the controls at lg+. */}
      <div className={hasActiveLocation ? 'lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start' : undefined}>
      <div>
      <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
        Search a location
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0 || searchedEmpty) setOpen(true); }}
            onBlur={() => setTimeout(() => setOpen(false), 160)}
            placeholder="e.g. a place, address, or neighbourhood..."
            autoComplete="off"
            aria-label="Search a location"
            className="input-field pl-8 pr-16 py-2 text-sm h-10"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searching && <Loader2 size={13} className="text-muted animate-spin" />}
            {query && !searching && (
              <button
                type="button"
                onClick={clearQueryText}
                aria-label="Clear search text"
                className="text-muted hover:text-ink transition-colors p-1"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {open && (suggestions.length > 0 || searchedEmpty) && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-ink/8 rounded-2xl shadow-elevated z-50 overflow-hidden">
              {suggestions.length > 0 ? (
                suggestions.map((s, i) => (
                  <button
                    key={`${s.lat}-${s.lng}-${i}`}
                    type="button"
                    onMouseDown={() => selectSuggestion(s)}
                    className={cn(
                      'w-full text-left px-4 py-2.5 text-sm transition-colors',
                      i === focusIdx ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50'
                    )}
                  >
                    {s.label}
                  </button>
                ))
              ) : (
                <p className="px-4 py-3 text-sm text-muted">No matching places found. Try a different search.</p>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleDirectSearch(query)}
          disabled={!query.trim() || searching}
          aria-label="Search this location"
          title="Search this location"
          className="w-10 h-10 shrink-0 rounded-full bg-brand-600 text-white flex items-center justify-center hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Search size={16} />
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
      </div>

      {directSearchState === 'not_found' && (
        <p className="mt-1.5 text-xs font-medium text-red-500">
          Location not found. Try refining your search, or pick a suggestion from the dropdown.
        </p>
      )}

      {hasActiveLocation && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-muted">
              Showing listings near <span className="font-semibold text-ink">{resolvedLabel || 'the selected location'}</span>
              {isApproximateLocation && (
                <span className="ml-1.5 text-amber-600" title="This address wasn't confirmed to rooftop precision -- the marker is an estimate along the correct street.">
                  (Approximate location)
                </span>
              )}
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
            step={RADIUS_STEP_KM}
            value={filters.radiusKm || MIN_RADIUS_KM}
            onChange={(e) => setFilters({ radiusKm: parseFloat(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>{MIN_RADIUS_KM} km</span><span>{MAX_RADIUS_KM} km</span>
          </div>
        </div>
      )}
      </div>

      {hasActiveLocation && (
        <SearchRadiusMiniMap
          center={miniMapCenter}
          radiusKm={miniMapRadiusKm}
          listings={listings}
          className="mt-4 lg:mt-0"
        />
      )}
      </div>
    </div>
  );
}
