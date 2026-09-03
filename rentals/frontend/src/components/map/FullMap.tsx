'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { Locate, LocateFixed } from 'lucide-react';
import { Listing } from '@/types';
import { formatShortCAD, cn } from '@/lib/utils';
import { requestUserLocation, type GeolocationFailureReason } from '@/lib/geolocation';
import { useToast } from '@/components/ui/use-toast';
import {
  CLUSTER_OPTIONS,
  MARKER_ICON_SIZE,
  MARKER_ICON_ANCHOR,
  CLUSTER_ICON_SIZE,
  CLUSTER_ICON_ANCHOR,
  USER_LOCATION_ICON_SIZE,
  USER_LOCATION_ICON_ANCHOR,
  buildMarkerHtml,
  buildClusterHtml,
  buildUserLocationMarkerHtml,
  formatMarkerLocationLabel,
  formatApproxRadiusLabel,
  APPROX_LOCATION_CIRCLE_STYLE,
  buildApproxZoneTooltipHtml,
} from '@/lib/mapMarkers';

interface FullMapProps {
  listings: Listing[];
  center: [number, number];
  onCentreChange: (center: [number, number]) => void;
  onListingClick: (listing: Listing) => void;
}

// A user-facing message per failure reason -- kept next to the component
// that renders it (geolocation.ts stays framework-free and returns the raw
// reason/message; this is just which one this particular UI prefers to
// show, e.g. a shorter "unsupported" line than the lib's own generic one).
const LOCATE_ERROR_TITLE: Record<GeolocationFailureReason, string> = {
  unsupported: "Location isn't supported",
  denied: 'Location permission denied',
  unavailable: "Couldn't find your location",
  timeout: 'Location request timed out',
  unknown: "Couldn't find your location",
};

export default function FullMap({
  listings,
  center,
  onCentreChange,
  onListingClick,
}: FullMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const clusterRef = useRef<any>(null);
  const userLocationMarkerRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const { toast } = useToast();
  const [locating, setLocating] = useState(false);

  // Stable refs so effects never close over stale props
  const listingsRef = useRef(listings);
  const centerRef = useRef(center);
  const onCentreChangeRef = useRef(onCentreChange);
  const onListingClickRef = useRef(onListingClick);

  useEffect(() => { listingsRef.current = listings; }, [listings]);
  useEffect(() => { centerRef.current = center; }, [center]);
  useEffect(() => { onCentreChangeRef.current = onCentreChange; }, [onCentreChange]);
  useEffect(() => { onListingClickRef.current = onListingClick; }, [onListingClick]);

  // ── One-time map initialisation ──────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    // Captured so the async init below never touches a ref React may have
    // already nulled out by the time it resolves (route-navigation race).
    let cancelled = false;
    const container = containerRef.current;

    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet.markercluster');

      // Component unmounted (e.g. user navigated away) while these
      // dynamic imports were still in flight — abort before touching the DOM.
      if (cancelled) return;

      // Fix webpack-broken default icon
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

      const map = L.map(container, {
        center: centerRef.current,
        zoom: 7,
        zoomControl: true,
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
      });

      // Unmounted between L.map() creation and here (unlikely, but cheap
      // to guard) — tear the freshly created instance down immediately
      // instead of leaving it orphaned with no registered cleanup.
      if (cancelled) {
        map.remove();
        return;
      }

      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        keepBuffer: 4,
        attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
      }).addTo(map);

      // Cluster group
      const cluster = (L as any).markerClusterGroup({
        ...CLUSTER_OPTIONS,
        iconCreateFunction: (c: any) => {
          const n = c.getChildCount();
          return L.divIcon({
            html: buildClusterHtml(n),
            className: '',
            iconSize: CLUSTER_ICON_SIZE,
            iconAnchor: CLUSTER_ICON_ANCHOR,
          });
        },
      });
      map.addLayer(cluster);
      clusterRef.current = cluster;

      map.on('click', (e) => {
        onCentreChangeRef.current([e.latlng.lat, e.latlng.lng]);
      });

      // Global bridge for popup buttons
      (window as any).__mapListingClick = (id: string) => {
        const listing = listingsRef.current.find((l) => l.id === id);
        if (listing) onListingClickRef.current(listing);
      };

      // Render markers with data available at init time
      renderMarkers(L);

      // ── invalidateSize after paint ─────────────────────────────────────
      // Two staggered calls handle slow paints and CSS transitions.
      requestAnimationFrame(() => {
        if (cancelled) return;
        map.invalidateSize({ animate: false });
        setTimeout(() => {
          if (cancelled) return;
          map.invalidateSize({ animate: false });
        }, 300);
      });

      // ── ResizeObserver keeps the map correct if container resizes ──────
      const ro = new ResizeObserver(() => {
        map.invalidateSize({ animate: false });
      });
      ro.observe(container);

      // Store cleanup
      (container as any).__leaflet_ro = ro;
    })();

    return () => {
      cancelled = true;
      delete (window as any).__mapListingClick;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ro = (container as any)?.__leaflet_ro as ResizeObserver | undefined;
      ro?.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-render markers when listings change ───────────────────────────────
  useEffect(() => {
    if (!initializedRef.current || !mapRef.current || !clusterRef.current) return;
    import('leaflet').then(({ default: L }) => renderMarkers(L));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings]);

  // ── Smooth pan when center prop changes ──────────────────────────────────
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, mapRef.current.getZoom(), { animate: true });
    }
  }, [center]);

  // ── Keep global click bridge current ────────────────────────────────────
  useEffect(() => {
    (window as any).__mapListingClick = (id: string) => {
      const listing = listingsRef.current.find((l) => l.id === id);
      if (listing) onListingClickRef.current(listing);
    };
  }, [listings]);

  function renderMarkers(L: any) {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;

    cluster.clearLayers();

    listingsRef.current.forEach((listing) => {
      if (!listing.lat || !listing.lng) return;

      const icon = L.divIcon({
        html: buildMarkerHtml(formatShortCAD(listing.price)),
        className: '',
        iconSize: MARKER_ICON_SIZE,
        iconAnchor: MARKER_ICON_ANCHOR,
      });

      const marker = L.marker([listing.lat, listing.lng], { icon });
      const locationLabel = formatMarkerLocationLabel(listing.city, listing.neighbourhood);

      // Privacy-area circle: only drawn while this specific listing's
      // popup is open (not for all 200 listings at once, which would just
      // be visual noise) -- makes clear the property is somewhere within
      // this area, not exactly at the pin. Drawn around listing.lat/lng --
      // the SAME already-redacted point the marker itself sits on -- so
      // this never needs, and never receives, a separate real coordinate.
      // Only relevant when the backend actually sent an approximate point
      // (owner/staff viewing their own map get exact coordinates and no
      // radius -- not applicable on this public map page today, but the
      // marker code doesn't assume).
      //
      // A dashed outline alone still puts a solid price pill dead center
      // of "the area", which reads as an exact pin with a decorative ring
      // around it rather than "somewhere in this whole zone" (founder
      // feedback after reviewing the first version of this feature). The
      // permanent tooltip bound to the circle -- not the marker's own
      // popup -- puts the privacy disclosure directly on the zone itself,
      // visible for exactly as long as the zone is on screen.
      let approxCircle: any = null;
      if (listing.locationApproximate && listing.locationPrecisionRadiusM) {
        marker.on('popupopen', () => {
          approxCircle = L.circle([listing.lat, listing.lng], {
            radius: listing.locationPrecisionRadiusM,
            ...APPROX_LOCATION_CIRCLE_STYLE,
          }).addTo(map);
          approxCircle.bindTooltip(buildApproxZoneTooltipHtml(), {
            permanent: true,
            direction: 'center',
            className: 'approx-zone-tooltip',
            interactive: false,
          }).openTooltip();
        });
        marker.on('popupclose', () => {
          if (approxCircle) { map.removeLayer(approxCircle); approxCircle = null; }
        });
      }

      const approxNote = listing.locationApproximate
        ? `<div style="color:#5a6e63;font-size:10px;margin-top:4px;">
            <strong style="color:#3d4f46;">Approximate location</strong><br/>
            Exact address hidden for privacy${listing.locationPrecisionRadiusM ? ` (±${formatApproxRadiusLabel(listing.locationPrecisionRadiusM)})` : ''}
          </div>`
        : '';

      marker.bindPopup(
        `<div style="min-width:190px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${listing.title}</div>
          <div style="color:#5a6e63;font-size:11px;margin-bottom:6px;">${formatShortCAD(listing.price)}/mo &middot; ${locationLabel}</div>
          ${listing.thumbnailUrl ? `<img src="${listing.thumbnailUrl}" style="width:100%;height:90px;object-fit:cover;border-radius:6px;margin-bottom:6px;" loading="lazy" />` : ''}
          <button onclick="window.__mapListingClick('${listing.id}')" style="width:100%;background:#0a5c42;color:white;border-radius:999px;padding:7px;font-weight:700;font-size:11px;cursor:pointer;border:none;">View details</button>
          ${approxNote}
        </div>`,
        { maxWidth: 220 }
      );
      cluster.addLayer(marker);
    });
  }

  async function handleLocateMe() {
    if (!mapRef.current) return;
    setLocating(true);
    try {
      const L = (await import('leaflet')).default;
      const { lat, lng } = await requestUserLocation();

      if (userLocationMarkerRef.current) {
        mapRef.current.removeLayer(userLocationMarkerRef.current);
      }
      const icon = L.divIcon({
        html: buildUserLocationMarkerHtml(),
        className: '',
        iconSize: USER_LOCATION_ICON_SIZE,
        iconAnchor: USER_LOCATION_ICON_ANCHOR,
      });
      userLocationMarkerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000, interactive: false }).addTo(mapRef.current);

      mapRef.current.setView([lat, lng], 14, { animate: true });
      onCentreChangeRef.current([lat, lng]);
    } catch (err: any) {
      const reason: GeolocationFailureReason = err?.reason ?? 'unknown';
      toast({
        title: LOCATE_ERROR_TITLE[reason],
        description: err?.message,
        variant: 'destructive',
      });
    } finally {
      setLocating(false);
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', minHeight: '400px' }}
      />
      <button
        type="button"
        onClick={handleLocateMe}
        disabled={locating}
        aria-label="Show my location on the map"
        title="Show my location"
        className={cn(
          'absolute bottom-5 right-3 z-[500] w-11 h-11 rounded-full bg-white shadow-elevated',
          'flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-60'
        )}
      >
        {locating ? (
          <LocateFixed size={20} className="text-brand-700 animate-pulse" />
        ) : (
          <Locate size={20} className="text-brand-700" />
        )}
      </button>
    </div>
  );
}
