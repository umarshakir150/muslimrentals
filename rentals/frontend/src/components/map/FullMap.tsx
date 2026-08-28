'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { Listing } from '@/types';
import { formatShortCAD } from '@/lib/utils';

interface FullMapProps {
  listings: Listing[];
  center: [number, number];
  radiusKm: number;
  onCentreChange: (center: [number, number]) => void;
  onListingClick: (listing: Listing) => void;
}

export default function FullMap({
  listings,
  center,
  radiusKm,
  onCentreChange,
  onListingClick,
}: FullMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const clusterRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const initializedRef = useRef(false);

  // Stable refs so effects never close over stale props
  const listingsRef = useRef(listings);
  const centerRef = useRef(center);
  const radiusKmRef = useRef(radiusKm);
  const onCentreChangeRef = useRef(onCentreChange);
  const onListingClickRef = useRef(onListingClick);

  useEffect(() => { listingsRef.current = listings; }, [listings]);
  useEffect(() => { centerRef.current = center; }, [center]);
  useEffect(() => { radiusKmRef.current = radiusKm; }, [radiusKm]);
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
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 14,
        maxClusterRadius: 50,
        animate: true,
        iconCreateFunction: (c: any) => {
          const n = c.getChildCount();
          return L.divIcon({
            html: `<div class="rental-marker">${n} listings</div>`,
            className: '',
            iconSize: [90, 30],
            iconAnchor: [45, 15],
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
  }, [listings, radiusKm]);

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
        html: `<div class="rental-marker">${formatShortCAD(listing.price)}</div>`,
        className: '',
        iconSize: [70, 26],
        iconAnchor: [35, 13],
      });

      const marker = L.marker([listing.lat, listing.lng], { icon });
      marker.bindPopup(
        `<div style="min-width:190px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${listing.title}</div>
          <div style="color:#5a6e63;font-size:11px;margin-bottom:6px;">${formatShortCAD(listing.price)}/mo &middot; ${listing.city}</div>
          ${listing.thumbnailUrl ? `<img src="${listing.thumbnailUrl}" style="width:100%;height:90px;object-fit:cover;border-radius:6px;margin-bottom:6px;" loading="lazy" />` : ''}
          <button onclick="window.__mapListingClick('${listing.id}')" style="width:100%;background:#0a5c42;color:white;border-radius:999px;padding:7px;font-weight:700;font-size:11px;cursor:pointer;border:none;">View details</button>
        </div>`,
        { maxWidth: 220 }
      );
      cluster.addLayer(marker);
    });

    // Radius circle
    if (radiusCircleRef.current && map.hasLayer(radiusCircleRef.current)) {
      map.removeLayer(radiusCircleRef.current);
    }
    const c = map.getCenter();
    radiusCircleRef.current = L.circle([c.lat, c.lng], {
      radius: radiusKmRef.current * 1000,
      color: '#0a5c42',
      fillColor: '#0a5c42',
      fillOpacity: 0.04,
      weight: 1.5,
      dashArray: '8 6',
    }).addTo(map);
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: '400px' }}
    />
  );
}
