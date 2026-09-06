'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { geocodeApi } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';

const CONFIRM_MAP_ZOOM = 17;

interface ConfirmLocationMapProps {
  // The geocoder's best (street-level) match -- used only as the map's
  // initial center/pin position. Uncontrolled after that: the marker's own
  // drag/click/search state is the source of truth while the user is
  // moving it, so typing/re-render churn elsewhere in the modal can't yank
  // the pin back to its starting point mid-adjustment.
  initialLat: number;
  initialLng: number;
  onChange: (lat: number, lng: number) => void;
}

/**
 * The landlord-confirmed-pin map for the "we found the street, not the
 * building" flow (see routes/listings.ts's resolveGeocodedLocation /
 * `confidence: 'street'`). Centered on the geocoder's matched street point
 * with a single marker the landlord can reposition three ways -- drag,
 * click/tap anywhere on the map, or search a place/address -- all three
 * report the marker's new position via the same `onChange`, so the parent
 * can resubmit it as confirmedLat/confirmedLng. Reused as-is for both
 * Create Listing and Edit Listing (see PostListingModal.tsx) -- this
 * component knows nothing about which flow it's in, only initialLat/
 * initialLng/onChange.
 *
 * The search box only ever MOVES the candidate pin, exactly like a drag or
 * a click would -- it never confirms anything itself. Confirming is a
 * separate, explicit action the parent modal owns (its own "Confirm
 * location" button); this component has no such action at all, so a
 * search result can't accidentally skip the landlord's explicit
 * confirmation step.
 *
 * Same raw-Leaflet, dynamic-import approach as ListingLocationMap.tsx /
 * FullMap.tsx (no react-leaflet wrapper in this codebase) -- kept
 * consistent rather than introducing a second way to stand up a map.
 * Unlike those, this one is never handed a privacy-approximate point: the
 * whole reason it exists is to let the landlord pin their EXACT private
 * location, so no privacy circle is drawn here. The public-facing 250m
 * approximate-location behavior (utils/geo.ts) is entirely unrelated to
 * this component and untouched by it.
 */
export default function ConfirmLocationMap({ initialLat, initialLng, onChange }: ConfirmLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;
    let map: any;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !container) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

      map = L.map(container, {
        center: [initialLat, initialLng],
        zoom: CONFIRM_MAP_ZOOM,
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: false,
        // `tap` defaults to true in Leaflet's own touch handling, which is
        // what makes a touch tap fire the same 'click' event a mouse click
        // does below -- left unset (not disabled) so click-to-move works
        // identically on mobile/touch and desktop, with no separate touch
        // handler needed.
      });
      mapRef.current = map;

      if (cancelled) {
        map.remove();
        map = null;
        return;
      }

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const icon = L.divIcon({
        html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;background:#0f766e;transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>`,
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 34],
      });

      const marker = L.marker([initialLat, initialLng], { icon, draggable: true }).addTo(map);
      markerRef.current = marker;
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onChangeRef.current(pos.lat, pos.lng);
      });

      // Click (and, via Leaflet's default tap handling, touch-tap) anywhere
      // on the map moves the same marker the same way a drag would -- one
      // shared way of updating the pin, not a second parallel mechanism.
      map.on('click', (e: any) => {
        marker.setLatLng(e.latlng);
        onChangeRef.current(e.latlng.lat, e.latlng.lng);
      });

      requestAnimationFrame(() => {
        if (cancelled) return;
        map.invalidateSize({ animate: false });
      });
    })();

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
        map = null;
      }
    };
    // Initialize once with the geocoder's matched point -- deliberately not
    // re-running as the marker moves (the marker's own drag/click/search
    // state owns its position from then on; re-centering on every onChange
    // would fight the user's own adjustments).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await geocodeApi.search(q);
      const { lat, lng } = res.data;
      // Same effect as a drag or a click -- move the marker, recenter/zoom
      // the map on it, and report it via the same onChange. Never confirms
      // anything: the landlord still has to press the parent's own
      // "Confirm location" button afterward.
      mapRef.current?.setView([lat, lng], CONFIRM_MAP_ZOOM);
      markerRef.current?.setLatLng([lat, lng]);
      onChangeRef.current(lat, lng);
    } catch {
      toast({
        variant: 'destructive',
        title: "Couldn't find that location",
        description: 'Try a different search, or drag/tap the pin directly.',
      });
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search an address or place..."
            aria-label="Search an address or place to move the pin"
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
          className="btn-brand px-4 py-2 text-sm h-10 disabled:opacity-60 flex items-center gap-1.5 shrink-0"
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
        </button>
      </form>

      <div className="rounded-2xl overflow-hidden border border-ink/8" style={{ isolation: 'isolate' }}>
        <div ref={containerRef} className="w-full" style={{ height: '260px' }} />
      </div>
    </div>
  );
}
