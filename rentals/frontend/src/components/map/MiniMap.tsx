'use client';

import { useEffect, useRef } from 'react';

const DEMO_LISTINGS = [
  { lat: 43.7764, lng: -79.2318, price: 875 },
  { lat: 43.4723, lng: -80.5449, price: 1050 },
  { lat: 43.5441, lng: -79.7292, price: 3100 },
  { lat: 45.4245, lng: -75.6812, price: 720 },
];


export default function MiniMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !mapRef.current) return;
    initialized.current = true;

    let map: any;
    (async () => {
      const L = (await import('leaflet')).default;
      delete (L.Icon.Default.prototype as any)._getIconUrl;

      map = L.map(mapRef.current!, {
        center: [43.6532, -79.3832],
        zoom: 8,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        keyboard: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      // Rental markers
      DEMO_LISTINGS.forEach(l => {
        const icon = L.divIcon({
          html: `<div style="background:#0a5c42;color:white;border-radius:999px;padding:5px 9px;font-weight:700;font-size:11px;border:2px solid white;box-shadow:0 3px 10px rgba(0,0,0,0.2);white-space:nowrap;font-family:sans-serif">$${l.price >= 1000 ? (l.price/1000).toFixed(1) + 'k' : l.price}</div>`,
          className: '',
          iconSize: [60, 28],
          iconAnchor: [30, 14],
        });
        L.marker([l.lat, l.lng], { icon }).addTo(map);
      });


    })();

    return () => { if (map) { map.remove(); initialized.current = false; } };
  }, []);

  return <div ref={mapRef} className="w-full h-full" />;
}
