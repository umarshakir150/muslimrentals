'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  SEARCH_RADIUS_CIRCLE_STYLE,
  SEARCH_LOCATION_ICON_SIZE,
  SEARCH_LOCATION_ICON_ANCHOR,
  buildSearchLocationMarkerHtml,
} from '@/lib/mapMarkers';

interface PreviewListing {
  id: string;
  lat: number;
  lng: number;
}

interface SearchRadiusMiniMapProps {
  center: [number, number] | null;
  radiusKm: number | null;
  // Already-filtered-to-the-current-radius listings, if the caller has them
  // handy (browse/page.tsx's own fetched results) -- purely a "yes, there's
  // something here" preview, not a replacement for the full /map page.
  listings?: PreviewListing[];
  className?: string;
}

// Shown before any location is selected -- a wide, unzoomed shot of Canada
// rather than a jarring blank grey box, consistent with this app's
// Canada-only scope.
const DEFAULT_CENTER: [number, number] = [56.1304, -106.3468];
const DEFAULT_ZOOM = 3;
const SELECTED_ZOOM = 13;

// This preview has no clustering machinery (that's FullMap's job) -- past
// this many results, individual dots would just be visual noise in a box
// this small, so it shows none rather than a cluttered mess.
const MAX_PREVIEW_LISTINGS = 30;

/**
 * A small, embedded Leaflet preview living directly in the Browse location/
 * radius controls (LocationRadiusSearch.tsx) -- so a renter can see what a
 * search actually covers without switching to the full /map page. Shows the
 * same distinct search-location marker and radius circle FullMap.tsx draws
 * (reusing the exact same mapMarkers.ts builders/styles, never a second,
 * divergent visual language for "this is what you searched"), auto-fits to
 * the radius on every change, and optionally previews a handful of matching
 * listings as small unobtrusive dots. Deliberately its own lightweight
 * Leaflet instance rather than a scaled-down FullMap: no marker-cluster
 * dependency, no popups/click-through, no spiderfy -- this widget answers
 * "where and how big", not "let me browse listings here".
 */
export default function SearchRadiusMiniMap({ center, radiusKm, listings = [], className }: SearchRadiusMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const listingLayerRef = useRef<any>(null);
  // Tracks the last center+radius this map already fit itself to, so a
  // listings-only re-render (a fresh page of results for the SAME active
  // search) never yanks the view back -- mirrors FullMap's own
  // lastFittedSearchRef pattern for the exact same reason.
  const lastFittedRef = useRef<string | null>(null);

  const centerRef = useRef(center);
  const radiusKmRef = useRef(radiusKm);
  const listingsRef = useRef(listings);
  useEffect(() => { centerRef.current = center; }, [center]);
  useEffect(() => { radiusKmRef.current = radiusKm; }, [radiusKm]);
  useEffect(() => { listingsRef.current = listings; }, [listings]);

  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;
    let cancelled = false;
    const container = containerRef.current;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      leafletRef.current = L;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

      const map = L.map(container, {
        center: centerRef.current ?? DEFAULT_CENTER,
        zoom: centerRef.current ? SELECTED_ZOOM : DEFAULT_ZOOM,
        // No zoom buttons -- fitBounds already frames every search
        // automatically, and +/- controls are mostly clutter at this size.
        // Dragging/tap/pinch-zoom stay on (Leaflet defaults) so the preview
        // is still touch-friendly to pan/zoom by hand.
        zoomControl: false,
        // A small map embedded in normally-scrolling page content must
        // never hijack the page's own scroll on a stray mouse-wheel pass.
        scrollWheelZoom: false,
      });
      if (cancelled) { map.remove(); return; }
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      renderSearch(L);

      requestAnimationFrame(() => {
        if (cancelled) return;
        map.invalidateSize({ animate: false });
      });
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initializedRef.current || !mapRef.current) return;
    if (leafletRef.current) renderSearch(leafletRef.current);
    else import('leaflet').then(({ default: L }) => renderSearch(L));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.[0], center?.[1], radiusKm]);

  useEffect(() => {
    if (!initializedRef.current || !mapRef.current || !leafletRef.current) return;
    renderListings(leafletRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings]);

  function renderSearch(L: any) {
    const map = mapRef.current;
    if (!map) return;

    if (circleRef.current) {
      map.removeLayer(circleRef.current);
      circleRef.current = null;
    }
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }

    const c = centerRef.current;
    const r = radiusKmRef.current;
    if (!c || !r) {
      // Search was cleared -- reset the fit guard so a later new search
      // still triggers a fresh fit, and return to the default wide view.
      lastFittedRef.current = null;
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false });
      renderListings(L);
      return;
    }

    circleRef.current = L.circle(c, {
      radius: r * 1000,
      ...SEARCH_RADIUS_CIRCLE_STYLE,
    }).addTo(map);

    const icon = L.divIcon({
      html: buildSearchLocationMarkerHtml(),
      className: '',
      iconSize: SEARCH_LOCATION_ICON_SIZE,
      iconAnchor: SEARCH_LOCATION_ICON_ANCHOR,
    });
    markerRef.current = L.marker(c, { icon, interactive: false }).addTo(map);

    const key = `${c[0]},${c[1]},${r}`;
    if (lastFittedRef.current !== key) {
      lastFittedRef.current = key;
      map.fitBounds(circleRef.current.getBounds(), { padding: [16, 16] });
    }

    renderListings(L);
  }

  function renderListings(L: any) {
    const map = mapRef.current;
    if (!map) return;

    if (listingLayerRef.current) {
      map.removeLayer(listingLayerRef.current);
      listingLayerRef.current = null;
    }

    const items = listingsRef.current;
    if (!centerRef.current || !radiusKmRef.current) return;
    if (items.length === 0 || items.length > MAX_PREVIEW_LISTINGS) return;

    const layer = L.layerGroup();
    items.forEach((listing) => {
      if (listing.lat == null || listing.lng == null) return;
      L.circleMarker([listing.lat, listing.lng], {
        radius: 4,
        color: '#0a5c42',
        weight: 1,
        fillColor: '#0a5c42',
        fillOpacity: 0.85,
        interactive: false,
      }).addTo(layer);
    });
    layer.addTo(map);
    listingLayerRef.current = layer;
  }

  const hasLocation = center != null && radiusKm != null;

  return (
    <div className={cn('relative', className)}>
      <div
        ref={containerRef}
        role="img"
        aria-label={hasLocation ? 'Map preview of the searched location and radius' : 'Map preview, no location searched yet'}
        className="w-full h-40 sm:h-48 lg:h-full lg:min-h-[220px] rounded-2xl overflow-hidden border border-ink/8 bg-gray-50"
      />
      {!hasLocation && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6">
          <p className="text-xs text-muted text-center bg-white/90 px-3 py-1.5 rounded-full border border-ink/8">
            Search a location above to preview it here
          </p>
        </div>
      )}
    </div>
  );
}
