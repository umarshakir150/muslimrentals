'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/layout/Navbar';
import ListingCard from '@/components/listings/ListingCard';
import ListingFilters from '@/components/listings/ListingFilters';
import { listingsApi } from '@/lib/api';
import { Listing } from '@/types';
import { useFilterStore } from '@/store/filterStore';
import { useIsAuthenticated } from '@/store/authStore';
import AuthModal from '@/components/auth/AuthModal';
import SendMessageModal from '@/components/messaging/SendMessageModal';

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });
const PostListingModal = dynamic(() => import('@/components/listings/PostListingModal'), { ssr: false });

export default function BrowsePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [messageTarget, setMessageTarget] = useState<Listing | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);

  const { filters } = useFilterStore();
  const isAuth = useIsAuthenticated();
  const router = useRouter();

  const page = filters.page || 1;

  // Guards against a slower, earlier request (e.g. a page-2+ "Load more" fetch)
  // resolving after a newer one (e.g. a filter change back to page 1) and
  // overwriting/appending onto its results.
  const requestIdRef = useRef(0);

  const fetchListings = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isFirstPage = page === 1;
    if (isFirstPage) {
      setLoading(true);
      setHasError(false);
    } else {
      setLoadingMore(true);
      setLoadMoreError(false);
    }
    try {
      const params: Record<string, any> = {
        ...(filters.keyword   && { keyword: filters.keyword }),
        ...(filters.city      && { city: filters.city }),
        ...(filters.audience && filters.audience !== 'all' && { audience: filters.audience }),
        ...(filters.minBeds   && { minBeds: filters.minBeds }),
        ...(filters.minBaths  && { minBaths: filters.minBaths }),
        ...(filters.maxPrice  && { maxPrice: filters.maxPrice }),
        ...(filters.furnished && { furnished: true }),
        ...(filters.parking   && { parking: true }),
        ...(filters.utilities && { utilities: true }),
        sort:  filters.sort  || 'newest',
        page,
        limit: 24,
        ...(filters.lat && { lat: filters.lat, lng: filters.lng, radiusKm: filters.radiusKm }),
      };
      const res = await listingsApi.getAll(params);
      if (requestIdRef.current !== requestId) return; // superseded by a newer request
      setListings(prev => (isFirstPage ? res.data : [...prev, ...res.data]));
      setTotal(res.pagination?.total ?? res.data.length);
    } catch {
      if (requestIdRef.current !== requestId) return;
      if (isFirstPage) setHasError(true);
      else setLoadMoreError(true);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filters, page]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  const handleLoadMore = () => useFilterStore.getState().setFilter('page', page + 1);

  return (
    <div className="min-h-dvh">
      <Navbar />

      <div className="pt-[72px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

          {/* Page header */}
          <div className="mb-5">
            <h1 className="section-title text-3xl md:text-4xl mb-1">Browse rentals</h1>
            <p className="text-muted text-sm">
              {loading
                ? 'Loading listings...'
                : hasError
                ? 'Could not load listings. Try refreshing.'
                : `${total} listing${total !== 1 ? 's' : ''} across Canada`}
            </p>
          </div>

          {/* Horizontal filter bar - full width, no sidebar */}
          <div className="mb-6">
            <ListingFilters />
          </div>

          {/* Listing grid - full width */}
          {loading ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-3xl overflow-hidden border border-ink/8 animate-pulse">
                  <div className="h-48 bg-gray-100" />
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-gray-100 rounded-lg w-3/4" />
                    <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasError ? (
            <div className="text-center py-20">
              <p className="text-muted mb-4">Unable to load listings right now.</p>
              <button onClick={fetchListings} className="btn-brand px-6 py-2.5 text-sm">Try again</button>
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-20">
              <h3 className="font-serif text-2xl mb-2">No listings found</h3>
              <p className="text-muted mb-6">Try adjusting your filters or searching a different city.</p>
              <button onClick={() => useFilterStore.getState().resetFilters()} className="btn-brand px-8 py-3">
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {listings.map((listing, i) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    index={i}
                    onView={setSelectedListing}
                    onMap={(l) => router.push(`/map?listingId=${l.id}`)}
                    onMessage={(l) => { if (!isAuth) setAuthOpen(true); else setMessageTarget(l); }}
                  />
                ))}
              </div>

              {listings.length < total && (
                <div className="flex flex-col items-center gap-2 mt-8">
                  {loadMoreError ? (
                    <>
                      <p className="text-sm text-muted">Could not load more listings.</p>
                      <button onClick={fetchListings} className="btn-ghost px-6 py-2.5 text-sm min-h-[44px]">
                        Try again
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="btn-ghost px-8 py-2.5 text-sm min-h-[44px] disabled:opacity-60"
                    >
                      {loadingMore ? 'Loading more...' : 'Load more listings'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
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

      <PostListingModal open={postOpen} onClose={() => setPostOpen(false)} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
