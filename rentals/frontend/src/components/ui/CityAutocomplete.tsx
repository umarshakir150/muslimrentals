'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, X } from 'lucide-react';
import { cn, fuzzySearch } from '@/lib/utils';
import { citiesApi } from '@/lib/api';

interface CityAutocompleteProps {
  value: string;
  onChange: (city: string, coords?: [number, number]) => void;
  placeholder?: string;
  className?: string;
}

interface CityEntry { name: string; province: string; lat?: number | null; lng?: number | null; }

// Module-level cache
let citiesCache: CityEntry[] | null = null;
let cityNamesCache: string[] | null = null;

export default function CityAutocomplete({ value, onChange, placeholder = 'Search cities...', className }: CityAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<CityEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [cities, setCities] = useState<CityEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (citiesCache) { setCities(citiesCache); return; }
    citiesApi.getAll()
      .then(res => { citiesCache = res.data; cityNamesCache = res.data.map(c => c.name); setCities(res.data); })
      .catch(() => {});
  }, []);

  useEffect(() => { setQuery(value); }, [value]);

  const search = useCallback((q: string) => {
    if (!q.trim() || !cities.length) { setSuggestions([]); setOpen(false); return; }
    const names = fuzzySearch(q, cities.map(c => c.name));
    const matched = names.map(n => cities.find(c => c.name === n)!).filter(Boolean);
    setSuggestions(matched.slice(0, 8));
    setOpen(matched.length > 0);
    setFocusIdx(-1);
  }, [cities]);

  useEffect(() => { search(query); }, [query, search]);

  const select = (city: CityEntry) => {
    setQuery(city.name);
    setSuggestions([]);
    setOpen(false);
    const coords: [number, number] | undefined = city.lat && city.lng ? [city.lat, city.lng] : undefined;
    onChange(city.name, coords);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter' && focusIdx >= 0) { e.preventDefault(); select(suggestions[focusIdx]); }
    else if (e.key === 'Escape') { setOpen(false); setFocusIdx(-1); }
  };

  const clear = () => { setQuery(''); onChange(''); setSuggestions([]); setOpen(false); inputRef.current?.focus(); };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query && open && setSuggestions(suggestions)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          placeholder={placeholder}
          autoComplete="off"
          className={cn('input-field pl-9 pr-9', className)}
        />
        {query && (
          <button onClick={clear} type="button" aria-label="Clear city" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div ref={dropRef} className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-ink/8 rounded-2xl shadow-elevated z-50 overflow-hidden">
          {suggestions.map((city, i) => (
            <button
              key={`${city.name}-${city.province}`}
              type="button"
              onMouseDown={() => select(city)}
              className={cn(
                'w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors text-sm',
                i === focusIdx ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50'
              )}
            >
              <span>
                {city.name.split(new RegExp(`(${query})`, 'gi')).map((part, j) =>
                  part.toLowerCase() === query.toLowerCase()
                    ? <strong key={j} className="text-brand-600 font-semibold">{part}</strong>
                    : part
                )}
              </span>
              <span className="text-xs text-muted font-medium shrink-0">{city.province}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
