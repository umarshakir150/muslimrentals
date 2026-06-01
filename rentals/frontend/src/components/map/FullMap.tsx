'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
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

  const initMap = useCallback(async () => {
    if (initialized.current || !mapDivRef.current) return;
    initialized.current = true;

    const L = (await import('leaflet')).default;
    await import('leaflet.markercluster');

    // Fix default icon
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

    const map = L.map(mapDivRef.current, {
      center,
      zoom: 7,
      zoomControl: true,
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Rental cluster layer
    rentalLayerRef.current = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 14,
      maxClusterRadius: 50,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div style="background:#0a5c42;color:white;border-radius:999px;padding:6px 12px;font-weight:700;font-size:12px;border:2.5px solid white;box-shadow:0 4px 14px rgba(0,0,0,0.22);font-family:var(--font-outfit),sans-serif;">${count} listings</div>`,
          className: '',
          iconSize: [90, 30],
          iconAnchor: [45, 15],
        });
      },
    });

    map.addLayer(rentalLayerRef.current);

    map.on('click', (e) => {
      onCentreChange([e.latlng.lat, e.latlng.lng]);
    });

    // Initial render
    renderMarkers(L, map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderMarkers = useCallback(async (LIn?: any, mapIn?: LeafletMap) => {
    const L = LIn || (await import('leaflet')).default;
    const map = mapIn || mapRef.current;
    if (!map || !rentalLayerRef.current) return;

    // Clear existing
    rentalLayerRef.current.clearLayers();

    // Rental markers
    listings.forEach(listing => {
      const icon = L.divIcon({
        html: `<div class="rental-marker">${formatShortCAD(listing.price)}</div>`,
        className: '',
        iconSize: [70, 30],
        iconAnchor: [35, 15],
      });

      const marker = L.marker([listing.lat, listing.lng], { icon });
      marker.bindPopup(`
        <div style="min-width:200px">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;font-family:var(--font-outfit)">${listing.title}</div>
          <div style="color:#5a6e63;font-size:12px;margin-bottom:8px">${formatShortCAD(listing.price)}/mo · ${listing.audience.charAt(0) + listing.audience.slice(1).toLowerCase()} · ${listing.city}</div>
          ${listing.thumbnailUrl ? `<img src="${listing.thumbnailUrl}" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px" />` : ''}
          <button onclick="window.__mapListingClick('${listing.id}')" style="width:100%;background:#0a5c42;color:white;border-radius:999px;padding:8px;font-weight:700;font-size:12px;cursor:pointer;border:none;font-family:var(--font-outfit)">View details</button>
        </div>
      `, { maxWidth: 240 });
      rentalLayerRef.current.addLayer(marker);
    });



    // Radius circle
    if (radiusRef.current) map.removeLayer(radiusRef.current);
    radiusRef.current = L.circle(center, {
      radius: radiusKm * 1000,
      color: '#0a5c42',
      fillColor: '#0a5c42',
      fillOpacity: 0.05,
      weight: 1.5,
      dashArray: '8 6',
    }).addTo(map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, center, radiusKm]);

  useEffect(() => { initMap(); }, [initMap]);

  useEffect(() => {
    if (!initialized.current) return;
    renderMarkers();
  }, [renderMarkers]);

  useEffect(() => {
    if (mapRef.current) mapRef.current.setView(center, mapRef.current.getZoom());
  }, [center]);

  // Global bridge for popup button clicks
  useEffect(() => {
    (window as any).__mapListingClick = (id: string) => {
      const listing = listings.find(l => l.id === id);
      if (listing) onListingClick(listing);
    };
    return () => { delete (window as any).__mapListingClick; };
  }, [listings, onListingClick]);

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
    <div ref={mapDivRef} className="w-full h-full" style={{ minHeight: 560 }} />
  );
}
