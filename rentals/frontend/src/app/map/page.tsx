'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/layout/Navbar';
import { listingsApi } from '@/lib/api';
import { Listing } from '@/types';
import { useFilterStore } from '@/store/filterStore';

const FullMap = dynamic(() => import('@/components/map/FullMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-brand-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-muted">Loading map...</p>
      </div>
    </div>
  )
});

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });

export default function MapPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const { filters, mapCenter, setMapCenter } = useFilterStore();

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listingsApi.getAll({ limit: 200, sort: 'newest' });
      setListings(res.data);
    } catch {
      // Silently fail - map will just show empty
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  return (
    <div className="min-h-dvh flex flex-col">
      <Navbar />
      <div className="pt-[72px] flex-1 flex flex-col">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full">
          <div className="mb-4">
            <h1 className="section-title text-2xl md:text-3xl mb-1">Rental map</h1>
            <p className="text-muted text-sm">Find rentals across Canada. Click any marker to view details.</p>
          </div>
          <div
            className="bg-white border border-ink/8 rounded-3xl shadow-card overflow-hidden"
            style={{ height: 'calc(100dvh - 200px)', minHeight: 450, position: 'relative' }}
          >
            {loading ? (
              <div className="w-full h-full bg-brand-50 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-muted">Loading map...</p>
                </div>
              </div>
            ) : (
              <div style={{ position: 'absolute', inset: 0 }}>
                <FullMap
                  listings={listings}
                  center={mapCenter}
                  radiusKm={filters.radiusKm || 80}
                  onCentreChange={setMapCenter}
                  onListingClick={setSelectedListing}
                />
              </div>
            )}
          </div>
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
