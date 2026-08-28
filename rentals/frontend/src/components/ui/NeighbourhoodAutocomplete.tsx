'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, X } from 'lucide-react';
import { cn, fuzzySearch } from '@/lib/utils';
import { neighbourhoodsApi, NeighbourhoodEntry } from '@/lib/api';
import { findNeighbourhoodCoords } from '@/lib/neighbourhood';

interface NeighbourhoodAutocompleteProps {
  value: string;
  city: string;
  onChange: (neighbourhood: string, coords?: [number, number]) => void;
  placeholder?: string;
  className?: string;
}

// Per-city cache so switching back and forth between cities in the form
// doesn't re-fetch every time.
const cache = new Map<string, NeighbourhoodEntry[]>();

// Unlike CityAutocomplete (a closed list -- you must pick a real city),
// this field accepts free text too: seed coverage of every city's
// neighbourhoods isn't guaranteed yet, and hard-blocking submission for a
// city with zero curated entries would be a posting dead end. Picking a
// suggestion resolves real neighbourhood-level coordinates; typing free
// text still satisfies the "required" validation and keeps whatever
// coordinates were already resolved (city-level, at worst).
export default function NeighbourhoodAutocomplete({
  value,
  city,
  onChange,
  placeholder = 'e.g. Kensington Market, Downtown...',
  className,
}: NeighbourhoodAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [entries, setEntries] = useState<NeighbourhoodEntry[]>([]);
  const [suggestions, setSuggestions] = useState<NeighbourhoodEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    setEntries([]);
    setSuggestions([]);
    setOpen(false);
    setLoaded(false);
    if (!city) return;

    const cached = cache.get(city);
    if (cached) { setEntries(cached); setLoaded(true); return; }

    neighbourhoodsApi.getAll(city)
      .then(res => { cache.set(city, res.data); setEntries(res.data); })
      .catch(() => { setEntries([]); })
      .finally(() => setLoaded(true));
  }, [city]);

  const search = useCallback((q: string) => {
    if (!q.trim() || !entries.length) { setSuggestions([]); setOpen(false); return; }
    const names = fuzzySearch(q, entries.map(e => e.name));
    const matched = names.map(n => entries.find(e => e.name === n)!).filter(Boolean);
    setSuggestions(matched.slice(0, 8));
    setOpen(matched.length > 0);
    setFocusIdx(-1);
  }, [entries]);

  useEffect(() => { search(query); }, [query, search]);

  const select = (entry: NeighbourhoodEntry) => {
    setQuery(entry.name);
    setSuggestions([]);
    setOpen(false);
    onChange(entry.name, [entry.lat, entry.lng]);
  };

  const handleInputChange = (text: string) => {
    setQuery(text);
    // Free text always satisfies the required-field validation immediately;
    // coordinates are only upgraded to neighbourhood-level when a real
    // suggestion is picked (or, on blur, if the typed text turns out to
    // exactly match one -- see handleBlur).
    onChange(text);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setOpen(false);
      const coords = findNeighbourhoodCoords(entries, query);
      if (coords) onChange(query, coords);
    }, 160);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter' && focusIdx >= 0) { e.preventDefault(); select(suggestions[focusIdx]); }
    else if (e.key === 'Escape') { setOpen(false); setFocusIdx(-1); }
  };

  const clear = () => { setQuery(''); onChange(''); setSuggestions([]); setOpen(false); inputRef.current?.focus(); };

  const disabled = !city;

  return (
    <div className="relative">
      <div className="relative">
        <MapPin size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query && suggestions.length && setOpen(true)}
          onBlur={handleBlur}
          placeholder={disabled ? 'Select a city first' : placeholder}
          autoComplete="off"
          className={cn('input-field pl-9 pr-9', disabled && 'opacity-60 cursor-not-allowed', className)}
        />
        {query && !disabled && (
          <button onClick={clear} type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-ink/8 rounded-2xl shadow-elevated z-50 overflow-hidden">
          {suggestions.map((entry, i) => (
            <button
              key={entry.name}
              type="button"
              onMouseDown={() => select(entry)}
              className={cn(
                'w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors text-sm',
                i === focusIdx ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50'
              )}
            >
              <span>
                {entry.name.split(new RegExp(`(${query})`, 'gi')).map((part, j) =>
                  part.toLowerCase() === query.toLowerCase()
                    ? <strong key={j} className="text-brand-600 font-semibold">{part}</strong>
                    : part
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {!disabled && loaded && entries.length === 0 && (
        <p className="text-xs text-muted mt-1.5">
          No verified neighbourhoods for {city} yet — type the closest match manually.
        </p>
      )}
    </div>
  );
}
