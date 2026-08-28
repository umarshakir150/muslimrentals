'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/layout/Navbar';
import { listingsApi } from '@/lib/api';
import { Listing } from '@/types';
import { useFilterStore } from '@/store/filterStore';
import { useToast } from '@/components/ui/use-toast';

// FullMap is heavy - load client-side only. No SSR loading fallback needed
// because the map container is always rendered with real dimensions.
const FullMap = dynamic(() => import('@/components/map/FullMap'), { ssr: false });
const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });

function MapPageInner() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const { filters, mapCenter, setMapCenter } = useFilterStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listingsApi.getAll({ limit: 200, sort: 'newest' });
      setListings(res.data);
    } catch {
      // Silently fail - map shows empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  // Deep-link support: /map?listingId=<id> from a listing card's "Map" button.
  useEffect(() => {
    if (loading) return;
    const listingId = searchParams.get('listingId');
    if (!listingId) return;

    const target = listings.find((l) => l.id === listingId);
    if (target && target.lat != null && target.lng != null) {
      setMapCenter([target.lat, target.lng]);
      setSelectedListing(target);
    } else {
      toast({ title: 'Listing not found', description: "This listing couldn't be located on the map right now." });
    }
    router.replace('/map', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, listings, searchParams]);

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
          className="border border-ink/8 shadow-card bg-white"
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

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <MapPageInner />
    </Suspense>
  );
}
