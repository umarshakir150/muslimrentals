'use client';

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { MapPin, X, Loader2, AlertCircle, Check } from 'lucide-react';
import { cn, fuzzySearch } from '@/lib/utils';
import { citiesApi } from '@/lib/api';

interface CityAutocompleteProps {
  value: string;
  onChange: (city: string, coords?: [number, number]) => void;
  placeholder?: string;
  className?: string;
  /** Visible or screen-reader label. Falls back to `placeholder` for a11y if omitted. */
  label?: string;
  /** Set true to visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
}

interface CityEntry { name: string; province: string; lat?: number | null; lng?: number | null; }

// Module-level cache - all entries are Canadian cities (backend only seeds
// Canadian cities), so no client-side country filtering is needed.
let citiesCache: CityEntry[] | null = null;
let citiesCachePromise: Promise<CityEntry[]> | null = null;

function loadCities(): Promise<CityEntry[]> {
  if (citiesCache) return Promise.resolve(citiesCache);
  if (!citiesCachePromise) {
    citiesCachePromise = citiesApi.getAll()
      .then(res => {
        citiesCache = res.data;
        return citiesCache;
      })
      .catch(err => {
        citiesCachePromise = null; // allow retry
        throw err;
      });
  }
  return citiesCachePromise;
}

const DEBOUNCE_MS = 180;

export default function CityAutocomplete({
  value,
  onChange,
  placeholder = 'Search cities...',
  className,
  label,
  hideLabel = true,
}: CityAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [selected, setSelected] = useState<CityEntry | null>(null);
  const [suggestions, setSuggestions] = useState<CityEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [cities, setCities] = useState<CityEntry[]>(citiesCache || []);
  const [loading, setLoading] = useState(!citiesCache);
  const [error, setError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const listboxId = useId();
  const inputId = useId();
  const getOptionId = (i: number) => `${listboxId}-option-${i}`;

  const fetchCities = useCallback(() => {
    setLoading(true);
    setError(false);
    loadCities()
      .then(list => setCities(list))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchCities(); }, [fetchCities]);

  // Keep local text in sync when the parent resets/changes `value` externally
  // (e.g. "Clear filters"). Also resolve a matching cached city so the
  // "confirmed" checkmark state is correct even on initial load.
  useEffect(() => {
    setQuery(value);
    if (!value) { setSelected(null); return; }
    const match = cities.find(c => c.name.toLowerCase() === value.toLowerCase());
    setSelected(match || null);
  }, [value, cities]);

  // Debounced, client-side filtering. Cities are fetched once and cached, so
  // this never issues a network request per keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim() || !cities.length) {
      setSuggestions([]);
      setActiveIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const names = fuzzySearch(query, cities.map(c => c.name));
      const matched = names.map(n => cities.find(c => c.name === n)!).filter(Boolean);
      setSuggestions(matched.slice(0, 8));
      setActiveIndex(-1);
    }, DEBOUNCE_MS);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, cities]);

  // Close on outside click/tap.
  useEffect(() => {
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        revertUnconfirmedText();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, query]);

  // If the user leaves the field without confirming a suggestion, don't let a
  // half-typed / invalid value masquerade as a selection - revert the visible
  // text back to the last confirmed city (or clear it).
  function revertUnconfirmedText() {
    setQuery(selected?.name || '');
  }

  function selectCity(city: CityEntry) {
    setSelected(city);
    setQuery(city.name);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    const coords: [number, number] | undefined = city.lat && city.lng ? [city.lat, city.lng] : undefined;
    onChange(city.name, coords);
  }

  function clear() {
    setQuery('');
    setSelected(null);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    onChange('');
    inputRef.current?.focus();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    // Any edit invalidates the previous confirmed selection until re-picked.
    if (selected && e.target.value !== selected.name) setSelected(null);
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        selectCity(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        revertUnconfirmedText();
      }
    }
  }

  const showNoResults = open && !loading && query.trim().length > 0 && suggestions.length === 0;
  const showSuggestions = open && suggestions.length > 0;
  const isConfirmed = !!selected && selected.name === query;
  const labelText = label || placeholder;

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className={cn(hideLabel && 'sr-only', 'block text-xs font-semibold text-muted mb-1.5')}>
        {labelText}
      </label>

      <div className="relative">
        <MapPin size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? getOptionId(activeIndex) : undefined}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim() && suggestions.length > 0) setOpen(true); }}
          placeholder={placeholder}
          autoComplete="off"
          className={cn('input-field pl-9 pr-16', className)}
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {loading && <Loader2 size={14} className="animate-spin text-muted" aria-hidden="true" />}
          {!loading && isConfirmed && <Check size={14} className="text-brand-600" aria-hidden="true" />}
          {query && !loading && (
            <button
              onClick={clear}
              type="button"
              aria-label={`Clear ${labelText}`}
              className="text-muted hover:text-ink transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1.5">
          <AlertCircle size={12} />
          Couldn&apos;t load cities.
          <button type="button" onClick={fetchCities} className="underline font-semibold hover:text-red-700">
            Retry
          </button>
        </p>
      )}

      {(showSuggestions || showNoResults) && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${labelText} suggestions`}
          className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-ink/8 rounded-2xl shadow-elevated z-dropdown overflow-hidden max-h-64 overflow-y-auto"
        >
          {showNoResults ? (
            <li className="px-4 py-3 text-sm text-muted text-center" role="status">
              No cities found for &ldquo;{query}&rdquo;
            </li>
          ) : (
            suggestions.map((city, i) => (
              <li key={`${city.name}-${city.province}`} role="presentation">
                <button
                  id={getOptionId(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); selectCity(city); }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors text-sm',
                    i === activeIndex ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50'
                  )}
                >
                  <span>
                    {city.name.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')).map((part, j) =>
                      part.toLowerCase() === query.toLowerCase()
                        ? <strong key={j} className="text-brand-600 font-semibold">{part}</strong>
                        : part
                    )}
                  </span>
                  <span className="text-xs text-muted font-medium shrink-0">{city.province}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
