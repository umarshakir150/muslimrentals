'use client';

import { useEffect, useRef } from 'react';

interface ConfirmLocationMapProps {
  // The geocoder's best (street-level) match -- used only as the map's
  // initial center/pin position. Uncontrolled after that: the marker's own
  // drag state is the source of truth while the user is moving it, so
  // typing/re-render churn elsewhere in the modal can't yank the pin back
  // to its starting point mid-drag.
  initialLat: number;
  initialLng: number;
  onChange: (lat: number, lng: number) => void;
}

/**
 * The landlord-confirmed-pin map for the "we found the street, not the
 * building" flow (see routes/listings.ts's resolveGeocodedLocation /
 * `confidence: 'street'`). Centered on the geocoder's matched street point
 * with a single draggable marker; every drag reports the marker's new
 * position via onChange so the parent can resubmit it as
 * confirmedLat/confirmedLng.
 *
 * Same raw-Leaflet, dynamic-import approach as ListingLocationMap.tsx /
 * FullMap.tsx (no react-leaflet wrapper in this codebase) -- kept
 * consistent rather than introducing a second way to stand up a map.
 * Unlike those, this one is never handed a privacy-approximate point: the
 * whole reason it exists is to let the landlord pin their EXACT private
 * location, so no privacy circle is drawn here.
 */
export default function ConfirmLocationMap({ initialLat, initialLng, onChange }: ConfirmLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
        zoom: 17,
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: false,
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
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onChangeRef.current(pos.lat, pos.lng);
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
    // re-running as the marker moves (the marker's own drag state owns its
    // position from then on; re-centering on every onChange would fight the
    // user's own drag).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl overflow-hidden border border-ink/8" style={{ isolation: 'isolate' }}>
      <div ref={containerRef} className="w-full" style={{ height: '260px' }} />
    </div>
  );
}
