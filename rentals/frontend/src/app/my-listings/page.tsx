'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Home, Trash2, Pencil } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import AuthModal from '@/components/auth/AuthModal';
import DeleteListingDialog from '@/components/listings/DeleteListingDialog';
import { usersApi } from '@/lib/api';
import { Listing } from '@/types';
import { useIsAuthenticated } from '@/store/authStore';
import { formatCAD, cn } from '@/lib/utils';

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });
const PostListingModal = dynamic(() => import('@/components/listings/PostListingModal'), { ssr: false });

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  PENDING: 'Pending',
  REMOVED: 'Removed',
};

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-600',
  PENDING: 'bg-gold-50 text-gold-700',
  REMOVED: 'bg-red-50 text-red-700',
};

export default function MyListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Listing | null>(null);
  const [editTarget, setEditTarget] = useState<Listing | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const isAuth = useIsAuthenticated();
  const router = useRouter();

  const fetchMyListings = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      const res = await usersApi.getMyListings();
      setListings(res.data as Listing[]);
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuth) fetchMyListings();
    else setAuthOpen(true);
  }, [isAuth, fetchMyListings]);

  function handleDeleted(listingId: string) {
    setListings(prev => prev.filter(l => l.id !== listingId));
    setDeleteTarget(null);
  }

  // Called by PostListingModal (mode="edit") once a PATCH save actually
  // succeeds -- replaces just that one row in place rather than
  // re-fetching the whole list, so the rest of the page's scroll
  // position/state isn't disturbed by an edit elsewhere in the list.
  function handleUpdated(updated: Listing) {
    setListings(prev => prev.map(l => (l.id === updated.id ? { ...l, ...updated } : l)));
  }

  if (!isAuth) {
    return (
      <div className="min-h-dvh">
        <Navbar />
        <div className="pt-[72px] flex items-center justify-center min-h-[calc(100dvh-72px)]">
          <div className="text-center px-4">
            <h1 className="section-title text-2xl mb-2">My listings</h1>
            <p className="text-muted text-sm">Please log in to view your listings.</p>
          </div>
        </div>
        <AuthModal open={authOpen} onClose={() => { setAuthOpen(false); if (!isAuth) router.push('/'); }} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <Navbar />

      <div className="pt-[72px]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="mb-6">
            <h1 className="section-title text-3xl md:text-4xl mb-1">My listings</h1>
            <p className="text-muted text-sm">
              {loading
                ? 'Loading your listings...'
                : hasError
                ? 'Could not load your listings. Try refreshing.'
                : `${listings.length} listing${listings.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-ink/8 p-4 flex gap-4 animate-pulse">
                  <div className="w-20 h-20 rounded-xl bg-gray-100 shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 bg-gray-100 rounded-lg w-1/2" />
                    <div className="h-3 bg-gray-100 rounded-lg w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasError ? (
            <div className="text-center py-20">
              <p className="text-muted mb-4">Unable to load your listings right now.</p>
              <button onClick={fetchMyListings} className="btn-brand px-6 py-2.5 text-sm">Try again</button>
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-20">
              <Home size={32} className="mx-auto mb-3 opacity-20" />
              <h3 className="font-serif text-2xl mb-2">No listings yet</h3>
              <p className="text-muted mb-6">Post a rental listing to reach the community.</p>
              <button onClick={() => router.push('/post')} className="btn-brand px-8 py-3">
                Post a listing
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {listings.map(listing => (
                <div
                  key={listing.id}
                  className="bg-white rounded-2xl border border-ink/8 p-4 flex items-center gap-4 cursor-pointer card-hover"
                  onClick={() => setSelectedListing(listing)}
                >
                  <div className="w-20 h-20 rounded-xl bg-brand-100 overflow-hidden shrink-0 relative">
                    {listing.thumbnailUrl || listing.images?.[0]?.url ? (
                      <Image
                        src={listing.thumbnailUrl || listing.images[0].url}
                        alt={listing.title}
                        fill
                        className="object-cover"
                        sizes="80px"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">🏠</div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-bold', STATUS_STYLE[listing.status] || 'bg-gray-100 text-gray-600')}>
                        {STATUS_LABEL[listing.status] || listing.status}
                      </span>
                    </div>
                    <h3 className="font-semibold text-sm truncate mb-0.5">{listing.title}</h3>
                    <p className="text-xs text-muted truncate">
                      {[listing.neighbourhood, listing.city].filter(Boolean).join(', ')} · {formatCAD(listing.price)}/mo
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditTarget(listing); }}
                      className="flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 px-3 py-2"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(listing); }}
                      className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 px-3 py-2"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedListing && (
        <ListingDetail
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          onMessage={() => {}}
          onDeleted={handleDeleted}
        />
      )}

      {deleteTarget && (
        <DeleteListingDialog
          listingId={deleteTarget.id}
          listingTitle={deleteTarget.title}
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}

      <PostListingModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        mode="edit"
        listing={editTarget ?? undefined}
        onSaved={handleUpdated}
      />
    </div>
  );
}
