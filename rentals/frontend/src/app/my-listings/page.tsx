'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Home, Trash2, Pencil, AlertCircle } from 'lucide-react';
import AuthModal from '@/components/auth/AuthModal';
import DeleteListingDialog from '@/components/listings/DeleteListingDialog';
import { usersApi } from '@/lib/api';
import { Listing } from '@/types';
import { useIsAuthenticated } from '@/store/authStore';
import { formatCAD } from '@/lib/utils';
import Surface from '@/components/ui/Surface';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });
const PostListingModal = dynamic(() => import('@/components/listings/PostListingModal'), { ssr: false });

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  PENDING: 'Pending review',
  REMOVED: 'Removed',
};

// ACTIVE/INACTIVE/PENDING/REMOVED is a status indicator, not the audience/
// suitability rainbow-color bug fixed in Milestone 3 -- these three tones
// carry real, distinct meaning for an owner (a light positive accent for
// the normal live state; one neutral tone covering both paused states,
// differentiated by label text; a destructive flag for REMOVED, since that
// can mean moderation took it down, the one state an owner most needs to
// notice), not decorative per-category color-coding.
const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-forest-50 text-forest-700',
  INACTIVE: 'bg-neutral-100 text-neutral-600',
  PENDING: 'bg-neutral-100 text-neutral-600',
  REMOVED: 'bg-destructive/10 text-destructive',
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

      <div className="pt-[72px]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="mb-6">
            <h1 className="section-title text-3xl md:text-4xl mb-1">My listings</h1>
            <p className="text-neutral-600 text-sm">
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
                <div key={i} className="bg-white rounded-surface border border-neutral-200 p-4 flex gap-4">
                  <Skeleton className="w-20 h-20 rounded-control shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasError ? (
            <EmptyState
              icon={AlertCircle}
              title="Couldn't load your listings"
              description="Something went wrong. Try refreshing."
              action={{ label: 'Try again', onClick: fetchMyListings }}
            />
          ) : listings.length === 0 ? (
            <EmptyState
              icon={Home}
              title="No listings yet"
              description="Post a rental listing to reach the community."
              action={{ label: 'Post a listing', onClick: () => router.push('/post') }}
            />
          ) : (
            <div className="space-y-3">
              {listings.map(listing => (
                <Surface
                  key={listing.id}
                  hoverable
                  className="p-4 flex items-center gap-4 cursor-pointer"
                  onClick={() => setSelectedListing(listing)}
                >
                  <div className="w-20 h-20 rounded-control bg-neutral-100 overflow-hidden shrink-0 relative">
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
                      <Badge className={STATUS_STYLE[listing.status] || 'bg-neutral-100 text-neutral-600'}>
                        {STATUS_LABEL[listing.status] || listing.status}
                      </Badge>
                    </div>
                    <h3 className="font-semibold text-sm truncate mb-0.5">{listing.title}</h3>
                    <p className="text-xs text-neutral-600 truncate">
                      {[listing.neighbourhood, listing.city].filter(Boolean).join(', ')} · {formatCAD(listing.price)}/mo
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setEditTarget(listing); }}
                    >
                      <Pencil size={14} /> Edit
                    </Button>
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(listing); }}
                    >
                      <Trash2 size={14} /> Delete
                    </Button>
                  </div>
                </Surface>
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
