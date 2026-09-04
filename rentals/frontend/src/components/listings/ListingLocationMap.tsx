'use client';

import { useEffect, useRef } from 'react';
import { Listing } from '@/types';
import {
  MARKER_ICON_SIZE,
  MARKER_ICON_ANCHOR,
  buildMarkerHtml,
  buildApproxZoneTooltipHtml,
  APPROX_LOCATION_CIRCLE_STYLE,
} from '@/lib/mapMarkers';
import { formatShortCAD } from '@/lib/utils';

interface ListingLocationMapProps {
  listing: Listing;
}

/**
 * Compact, single-listing map embedded directly in ListingDetail so a
 * renter can see roughly where a listing is without leaving the modal and
 * navigating to /map. Deliberately not FullMap.tsx cut down -- FullMap
 * carries a lot that has no place here (Locate Me, clustering/spiderfy,
 * multi-listing rendering) -- but it reuses every actual location/privacy
 * primitive FullMap itself uses (mapMarkers.ts's marker/circle/tooltip
 * builders), so the treatment is visually identical, not a second
 * independent implementation of the same idea.
 *
 * Only ever draws from `listing.lat`/`listing.lng` -- for a non-owner/
 * non-staff viewer this is already the redacted, privacy-safe approximate
 * point (see rentals/backend/src/utils/geo.ts's toPublicListingLocation);
 * this component has no way to request or receive the real coordinate, so
 * there's nothing here that could leak it. The privacy circle + label are
 * only drawn when the API actually flagged the point as approximate
 * (`listing.locationApproximate`) -- an owner/staff viewer, who receives
 * the real precise point instead, just sees a plain marker there, exactly
 * mirroring FullMap's own owner/staff behavior.
 */
export default function ListingLocationMap({ listing }: ListingLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;
    if (listing.lat == null || listing.lng == null) return;
    initializedRef.current = true;

    let cancelled = false;
    const container = containerRef.current;
    let map: any;

    (async () => {
      const L = (await import('leaflet')).default;

      if (cancelled) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

      map = L.map(container, {
        center: [listing.lat, listing.lng],
        zoom: 15,
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: false,
      });

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
        html: buildMarkerHtml(formatShortCAD(listing.price)),
        className: '',
        iconSize: MARKER_ICON_SIZE,
        iconAnchor: MARKER_ICON_ANCHOR,
      });
      L.marker([listing.lat, listing.lng], { icon, interactive: false }).addTo(map);

      if (listing.locationApproximate && listing.locationPrecisionRadiusM) {
        L.circle([listing.lat, listing.lng], {
          radius: listing.locationPrecisionRadiusM,
          ...APPROX_LOCATION_CIRCLE_STYLE,
        })
          .addTo(map)
          .bindTooltip(buildApproxZoneTooltipHtml(), {
            permanent: true,
            direction: 'center',
            className: 'approx-zone-tooltip',
            interactive: false,
          })
          .openTooltip();
      }

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
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id]);

  if (listing.lat == null || listing.lng == null) return null;

  return (
    <div className="rounded-2xl overflow-hidden border border-ink/8" style={{ isolation: 'isolate' }}>
      <div ref={containerRef} className="w-full" style={{ height: '160px' }} />
    </div>
  );
}
