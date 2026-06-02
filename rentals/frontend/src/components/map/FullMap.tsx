'use client';

import { useEffect, useRef, useCallback } from 'react';
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

export default function FullMap({ listings, center, radiusKm, onCentreChange, onListingClick }: FullMapProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const rentalLayerRef = useRef<any>(null);
  const radiusRef = useRef<any>(null);
  const initialized = useRef(false);
  // Keep stable refs for callbacks so markers/listeners don't go stale
  const onCentreChangeRef = useRef(onCentreChange);
  const onListingClickRef = useRef(onListingClick);
  const listingsRef = useRef(listings);

  useEffect(() => { onCentreChangeRef.current = onCentreChange; }, [onCentreChange]);
  useEffect(() => { onListingClickRef.current = onListingClick; }, [onListingClick]);
  useEffect(() => { listingsRef.current = listings; }, [listings]);

  // ── Init map once ──────────────────────────────────────────────────────────
  const initMap = useCallback(async () => {
    if (initialized.current || !mapDivRef.current) return;
    initialized.current = true;

    const L = (await import('leaflet')).default;
    await import('leaflet.markercluster');

    // Fix default icon paths broken by webpack
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

    const map = L.map(mapDivRef.current, {
      center,
      zoom: 7,
      zoomControl: true,
      // Smooth animations
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      // Avoid jump when container size not yet finalised
      preferCanvas: false,
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
      // Keep tiles while panning - smoother feel
      keepBuffer: 4,
    }).addTo(map);

    rentalLayerRef.current = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 14,
      maxClusterRadius: 50,
      animate: true,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div style="background:#0a5c42;color:white;border-radius:999px;padding:6px 12px;font-weight:700;font-size:12px;border:2.5px solid white;box-shadow:0 4px 14px rgba(0,0,0,0.22);font-family:var(--font-outfit),sans-serif;white-space:nowrap;">${count} listings</div>`,
          className: '',
          iconSize: [90, 30],
          iconAnchor: [45, 15],
        });
      },
    });
    map.addLayer(rentalLayerRef.current);

    map.on('click', (e) => {
      onCentreChangeRef.current([e.latlng.lat, e.latlng.lng]);
    });

    // CRITICAL: invalidate size after the container has painted so all tiles load
    setTimeout(() => map.invalidateSize({ animate: false }), 100);
    setTimeout(() => map.invalidateSize({ animate: false }), 400);

    // Global bridge for popup button clicks
    (window as any).__mapListingClick = (id: string) => {
      const listing = listingsRef.current.find(l => l.id === id);
      if (listing) onListingClickRef.current(listing);
    };

    // Render initial markers
    renderMarkersOnMap(L, map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render markers (pure function, no closure over stale props) ───────────
  const renderMarkersOnMap = useCallback(async (LIn?: any, mapIn?: LeafletMap) => {
    const L = LIn ?? (await import('leaflet')).default;
    const map = mapIn ?? mapRef.current;
    if (!map || !rentalLayerRef.current) return;

    rentalLayerRef.current.clearLayers();

    listingsRef.current.forEach(listing => {
      if (!listing.lat || !listing.lng) return;
      const icon = L.divIcon({
        html: `<div style="background:#0a5c42;color:white;border-radius:999px;padding:4px 10px;font-weight:700;font-size:11px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.2);white-space:nowrap;">${formatShortCAD(listing.price)}</div>`,
        className: '',
        iconSize: [70, 26],
        iconAnchor: [35, 13],
      });

      const marker = L.marker([listing.lat, listing.lng], { icon });
      marker.bindPopup(`
        <div style="min-width:190px;font-family:var(--font-outfit),sans-serif;">
          <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${listing.title}</div>
          <div style="color:#5a6e63;font-size:11px;margin-bottom:6px;">${formatShortCAD(listing.price)}/mo - ${listing.city}</div>
          ${listing.thumbnailUrl ? `<img src="${listing.thumbnailUrl}" style="width:100%;height:90px;object-fit:cover;border-radius:6px;margin-bottom:6px;" />` : ''}
          <button onclick="window.__mapListingClick('${listing.id}')" style="width:100%;background:#0a5c42;color:white;border-radius:999px;padding:7px;font-weight:700;font-size:11px;cursor:pointer;border:none;">View details</button>
        </div>
      `, { maxWidth: 220 });
      rentalLayerRef.current.addLayer(marker);
    });

    // Radius circle
    if (radiusRef.current && map.hasLayer(radiusRef.current)) {
      map.removeLayer(radiusRef.current);
    }
    const currentCenter = mapRef.current ? mapRef.current.getCenter() : { lat: center[0], lng: center[1] };
    radiusRef.current = L.circle([currentCenter.lat, currentCenter.lng], {
      radius: radiusKm * 1000,
      color: '#0a5c42',
      fillColor: '#0a5c42',
      fillOpacity: 0.04,
      weight: 1.5,
      dashArray: '8 6',
    }).addTo(map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => { initMap(); }, [initMap]);

  // Re-render markers when listings change (but map is already up)
  useEffect(() => {
    if (!initialized.current || !mapRef.current) return;
    renderMarkersOnMap();
  }, [listings, renderMarkersOnMap]);

  // Pan to new centre without reinitialising
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, mapRef.current.getZoom(), { animate: true });
    }
  }, [center]);

  // Update global click bridge whenever listings change
  useEffect(() => {
    (window as any).__mapListingClick = (id: string) => {
      const listing = listingsRef.current.find(l => l.id === id);
      if (listing) onListingClickRef.current(listing);
    };
    return () => { delete (window as any).__mapListingClick; };
  }, [listings]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        initialized.current = false;
      }
    };
  }, []);

  return (
    <div
      ref={mapDivRef}
      style={{ width: '100%', height: '100%', minHeight: 400 }}
    />
  );
}
