'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, AlertCircle } from 'lucide-react';
import ListingCard from '@/components/listings/ListingCard';
import AuthModal from '@/components/auth/AuthModal';
import SendMessageModal from '@/components/messaging/SendMessageModal';
import { usersApi } from '@/lib/api';
import { Listing } from '@/types';
import { useIsAuthenticated } from '@/store/authStore';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });

export default function SavedPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [messageTarget, setMessageTarget] = useState<Listing | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const isAuth = useIsAuthenticated();
  const router = useRouter();

  const fetchSaved = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      const res = await usersApi.getSaved();
      setListings(res.data as Listing[]);
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuth) fetchSaved();
    else setAuthOpen(true);
  }, [isAuth, fetchSaved]);

  function handleSaveChange(listing: Listing, saved: boolean) {
    if (!saved) setListings(prev => prev.filter(l => l.id !== listing.id));
  }

  if (!isAuth) {
    return (
      <div className="min-h-dvh">
        <div className="pt-[72px] flex items-center justify-center min-h-[calc(100dvh-72px)]">
          <div className="text-center px-4">
            <h1 className="section-title text-2xl mb-2">Saved listings</h1>
            <p className="text-muted text-sm">Please log in to view your saved listings.</p>
          </div>
        </div>
        <AuthModal open={authOpen} onClose={() => { setAuthOpen(false); if (!isAuth) router.push('/'); }} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh">

      <div className="pt-[72px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

          <div className="mb-6">
            <h1 className="section-title text-3xl md:text-4xl mb-1">Saved listings</h1>
            <p className="text-neutral-600 text-sm">
              {loading
                ? 'Loading your saved listings...'
                : hasError
                ? 'Could not load your saved listings. Try refreshing.'
                : `${listings.length} listing${listings.length !== 1 ? 's' : ''} saved`}
            </p>
          </div>

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
              title="Couldn't load your saved listings"
              description="Something went wrong. Try refreshing."
              action={{ label: 'Try again', onClick: fetchSaved }}
            />
          ) : listings.length === 0 ? (
            <EmptyState
              icon={Heart}
              title="No saved listings yet"
              description="Tap the heart on a listing to save it here for later."
              action={{ label: 'Browse rentals', onClick: () => router.push('/browse') }}
            />
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {listings.map((listing, i) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  index={i}
                  onView={setSelectedListing}
                  onMap={(l) => router.push(`/map?listingId=${l.id}`)}
                  onMessage={(l) => setMessageTarget(l)}
                  onSaveChange={handleSaveChange}
                />
              ))}
            </div>
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
            setMessageTarget(l);
          }}
        />
      )}

      {messageTarget && (
        <SendMessageModal listing={messageTarget} onClose={() => setMessageTarget(null)} />
      )}
    </div>
  );
}
