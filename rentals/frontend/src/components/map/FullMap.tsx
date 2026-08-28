'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { Listing } from '@/types';
import { formatShortCAD } from '@/lib/utils';
import {
  CLUSTER_OPTIONS,
  MARKER_ICON_SIZE,
  MARKER_ICON_ANCHOR,
  CLUSTER_ICON_SIZE,
  CLUSTER_ICON_ANCHOR,
  buildMarkerHtml,
  buildClusterHtml,
  formatMarkerLocationLabel,
} from '@/lib/mapMarkers';

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

    let map: LeafletMap;

    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet.markercluster');

      // Fix webpack-broken default icon
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

      map = L.map(containerRef.current!, {
        center: centerRef.current,
        zoom: 7,
        zoomControl: true,
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
      });
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
        map.invalidateSize({ animate: false });
        setTimeout(() => map.invalidateSize({ animate: false }), 300);
      });

      // ── ResizeObserver keeps the map correct if container resizes ──────
      const ro = new ResizeObserver(() => {
        map.invalidateSize({ animate: false });
      });
      ro.observe(containerRef.current!);

      // Store cleanup
      (containerRef.current as any).__leaflet_ro = ro;
    })();

    return () => {
      delete (window as any).__mapListingClick;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ro = (containerRef.current as any)?.__leaflet_ro as ResizeObserver | undefined;
      ro?.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        initializedRef.current = false;
      }
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
        html: buildMarkerHtml(formatShortCAD(listing.price)),
        className: '',
        iconSize: MARKER_ICON_SIZE,
        iconAnchor: MARKER_ICON_ANCHOR,
      });

      const marker = L.marker([listing.lat, listing.lng], { icon });
      const locationLabel = formatMarkerLocationLabel(listing.city, listing.neighbourhood);
      marker.bindPopup(
        `<div style="min-width:190px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${listing.title}</div>
          <div style="color:#5a6e63;font-size:11px;margin-bottom:6px;">${formatShortCAD(listing.price)}/mo &middot; ${locationLabel}</div>
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
