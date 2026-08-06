'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/layout/Navbar';
import { listingsApi } from '@/lib/api';
import { Listing } from '@/types';
import { useFilterStore } from '@/store/filterStore';

// FullMap is heavy - load client-side only. No SSR loading fallback needed
// because the map container is always rendered with real dimensions.
const FullMap = dynamic(() => import('@/components/map/FullMap'), { ssr: false });
const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });

export default function MapPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const { filters, mapCenter, setMapCenter } = useFilterStore();

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      // Backend caps `limit` at 50 (see listingQuerySchema in listings.ts) -
      // requesting more always failed validation (422), which silently left
      // the map empty even when listings existed.
      const res = await listingsApi.getAll({ limit: 50, sort: 'newest' });
      setListings(res.data);
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  return (
    // page root: full viewport height, no overflow clip so Leaflet can measure
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <Navbar />

      {/* content area below navbar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingTop: '72px', minHeight: 0 }}>
        <div style={{ maxWidth: '1280px', width: '100%', margin: '0 auto', padding: '24px 24px 0', flexShrink: 0 }}>
          <h1 className="section-title text-2xl md:text-3xl mb-0.5">Rental map</h1>
          <p className="text-muted text-sm mb-4">Find rentals across Canada. Click any marker to view details.</p>
        </div>

        {/*
          Map card: flex-1 so it fills remaining height exactly.
          overflow-hidden + border-radius for visual styling.
          position:relative so the loading overlay can be absolute.
          NO conditional render - FullMap is ALWAYS in the DOM so Leaflet
          measures the real container dimensions.
        */}
        <div
          // `isolate` (isolation: isolate) gives this wrapper its own stacking
          // context so Leaflet's internal panes/controls - which use z-indices
          // up to 1000 internally - are contained here and can never render
          // above the header, dropdowns, or modals, which live in later
          // stacking contexts (see the zIndex scale in tailwind.config.ts).
          className="border border-ink/8 shadow-card bg-white isolate z-map"
          style={{
            flex: 1,
            margin: '0 24px 24px',
            maxWidth: 'calc(1280px - 0px)',
            alignSelf: 'center',
            width: 'calc(100% - 48px)',
            borderRadius: '24px',
            overflow: 'hidden',
            position: 'relative',
            minHeight: '400px',
          }}
        >
          {/* Loading overlay - sits on top of map, doesn't hide it */}
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 1000,
                background: 'rgba(245,240,232,0.85)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div className="text-center">
                <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted">Loading listings...</p>
              </div>
            </div>
          )}

          {/* Empty / error banners - map stays interactive underneath */}
          {!loading && (hasError || listings.length === 0) && (
            <div
              style={{
                position: 'absolute',
                top: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 500,
              }}
              className="bg-white/95 backdrop-blur-sm border border-ink/8 shadow-card rounded-2xl px-5 py-3 text-center max-w-sm mx-4"
              role="status"
            >
              {hasError ? (
                <>
                  <p className="text-sm font-semibold text-ink">Unable to load the map</p>
                  <p className="text-xs text-muted mt-0.5 mb-2">Something went wrong loading listings.</p>
                  <button onClick={fetchListings} className="text-xs font-semibold text-brand-600 hover:underline">
                    Try again
                  </button>
                </>
              ) : (
                <p className="text-sm font-semibold text-ink">
                  No rentals are currently available to display on the map.
                </p>
              )}
            </div>
          )}

          {/* Map always rendered - never conditionally mounted */}
          <FullMap
            listings={listings}
            center={mapCenter}
            radiusKm={filters.radiusKm || 80}
            onCentreChange={setMapCenter}
            onListingClick={setSelectedListing}
          />
        </div>
      </div>

      {selectedListing && (
        <ListingDetail
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          onMessage={() => setSelectedListing(null)}
        />
      )}
    </div>
  );
}
