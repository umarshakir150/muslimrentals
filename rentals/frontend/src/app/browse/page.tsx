'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, SearchX } from 'lucide-react';
import ListingCard from '@/components/listings/ListingCard';
import ListingFilters from '@/components/listings/ListingFilters';
import { listingsApi } from '@/lib/api';
import { Listing } from '@/types';
import { useFilterStore } from '@/store/filterStore';
import { useIsAuthenticated } from '@/store/authStore';
import AuthModal from '@/components/auth/AuthModal';
import SendMessageModal from '@/components/messaging/SendMessageModal';
import { buildListingSearchParams } from '@/lib/listingSearchParams';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';

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
        ...buildListingSearchParams(filters),
        sort:  filters.sort  || 'newest',
        page,
        limit: 24,
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

      <div className="pt-[72px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

          {/* Page header */}
          <div className="mb-5">
            <h1 className="section-title text-3xl md:text-4xl mb-1">Browse rentals</h1>
            <p className="text-neutral-600 text-sm">
              {loading
                ? 'Loading listings...'
                : hasError
                ? 'Could not load listings. Try refreshing.'
                : `${total} listing${total !== 1 ? 's' : ''} across Canada`}
            </p>
          </div>

          {/* Horizontal filter bar - full width, no sidebar */}
          <div className="mb-6">
            <ListingFilters listings={listings.map(({ id, lat, lng }) => ({ id, lat, lng }))} />
          </div>

          {/* Listing grid - full width */}
          {loading ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-surface overflow-hidden border border-neutral-200">
                  <Skeleton className="h-48 rounded-none" />
                  <div className="p-4 space-y-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasError ? (
            <EmptyState
              icon={AlertCircle}
              title="Couldn't load listings"
              description="Something went wrong. Try refreshing."
              action={{ label: 'Try again', onClick: fetchListings }}
            />
          ) : listings.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No listings found"
              description="Try adjusting your filters or searching a different city."
              action={{ label: 'Clear filters', onClick: () => useFilterStore.getState().resetFilters() }}
            />
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
                      <p className="text-sm text-neutral-600">Could not load more listings.</p>
                      <Button variant="secondary" onClick={fetchListings}>
                        Try again
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={handleLoadMore} loading={loadingMore}>
                      {loadingMore ? 'Loading more...' : 'Load more listings'}
                    </Button>
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
