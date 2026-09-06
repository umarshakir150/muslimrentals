'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/layout/Navbar';
import AuthModal from '@/components/auth/AuthModal';
import SendMessageModal from '@/components/messaging/SendMessageModal';
import { listingsApi } from '@/lib/api';
import { Listing } from '@/types';
import { useFilterStore } from '@/store/filterStore';
import { useIsAuthenticated } from '@/store/authStore';
import { useToast } from '@/components/ui/use-toast';
import { buildListingSearchParams } from '@/lib/listingSearchParams';

// FullMap is heavy - load client-side only. No SSR loading fallback needed
// because the map container is always rendered with real dimensions.
const FullMap = dynamic(() => import('@/components/map/FullMap'), { ssr: false });
const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });

function MapPageInner() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [messageTarget, setMessageTarget] = useState<Listing | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const { filters, mapCenter, setMapCenter } = useFilterStore();
  const isAuth = useIsAuthenticated();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Shares the exact same filter-composition logic as /browse (keyword,
  // city, audience, beds/baths, price, amenities, location-radius search)
  // so the two pages' results stay consistent with each other -- this used
  // to always fetch every active listing regardless of /browse's filters.
  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listingsApi.getAll({ ...buildListingSearchParams(filters), limit: 200, sort: 'newest' });
      setListings(res.data);
    } catch {
      // Silently fail - map shows empty
    } finally {
      setLoading(false);
    }
  }, [filters]);

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
            // This wrapper has position:relative but no z-index, so on its
            // own it never becomes a stacking context -- its children's
            // z-index values (the loading overlay below is z-index:1000,
            // and Leaflet's own internal panes go up to ~700) paint directly
            // in whatever stacking context contains this whole card, i.e.
            // the same one AuthModal/PostListingModal/ListingDetail's
            // z-[100] backdrops live in. 1000 > 100, so while `loading` is
            // true (a real, not-rare window -- e.g. a slow/cold-started
            // backend, see the initial-load performance work) the loading
            // overlay physically painted above any modal opened during
            // that window, confirmed with document.elementFromPoint() hit
            // testing against a real production build. isolation: isolate
            // contains everything inside this card (map, tiles, popups,
            // the loading overlay) to its own local stacking order,
            // regardless of how high any of their z-index values are, so
            // none of it can ever compete with page-level UI like a modal
            // again -- the same fix already applied to .leaflet-container
            // itself, just at the level that actually needed it.
            isolation: 'isolate',
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
            onCentreChange={setMapCenter}
            onListingClick={setSelectedListing}
            searchCenter={filters.lat != null && filters.lng != null ? [filters.lat, filters.lng] : null}
            searchRadiusKm={filters.radiusKm}
          />
        </div>
      </div>

      {selectedListing && (
        <ListingDetail
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          onMessage={(l) => {
            setSelectedListing(null);
            if (!isAuth) setAuthOpen(true);
            else setMessageTarget(l);
          }}
        />
      )}

      {messageTarget && (
        <SendMessageModal listing={messageTarget} onClose={() => setMessageTarget(null)} />
      )}

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
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
