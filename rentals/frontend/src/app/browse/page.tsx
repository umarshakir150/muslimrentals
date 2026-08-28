'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/layout/Navbar';
import ListingCard from '@/components/listings/ListingCard';
import ListingFilters from '@/components/listings/ListingFilters';
import { listingsApi, messagesApi } from '@/lib/api';
import { Listing } from '@/types';
import { useFilterStore } from '@/store/filterStore';
import { useToast } from '@/components/ui/use-toast';
import { useIsAuthenticated } from '@/store/authStore';
import AuthModal from '@/components/auth/AuthModal';
import { motion } from 'framer-motion';

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });
const PostListingModal = dynamic(() => import('@/components/listings/PostListingModal'), { ssr: false });

export default function BrowsePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [messageTarget, setMessageTarget] = useState<Listing | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [msgBody, setMsgBody] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  const { filters } = useFilterStore();
  const { toast } = useToast();
  const isAuth = useIsAuthenticated();
  const router = useRouter();

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setHasError(false);
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
        page:  filters.page  || 1,
        limit: 24,
        ...(filters.lat && { lat: filters.lat, lng: filters.lng, radiusKm: filters.radiusKm }),
      };
      const res = await listingsApi.getAll(params);
      setListings(res.data);
      setTotal(res.pagination?.total ?? res.data.length);
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!msgBody.trim() || !messageTarget) return;
    if (!isAuth) { setAuthOpen(true); return; }
    setSendingMsg(true);
    try {
      await messagesApi.startConversation(messageTarget.id, msgBody);
      toast({ title: 'Message sent!', description: 'The landlord will be notified.' });
      setMessageTarget(null);
      setMsgBody('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSendingMsg(false);
    }
  }

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
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setMessageTarget(null); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl shadow-elevated p-6 max-w-md w-full"
          >
            <h3 className="font-serif text-xl mb-1">Send a message</h3>
            <p className="text-sm text-muted mb-4">Re: {messageTarget.title}</p>
            <form onSubmit={handleSendMessage} className="space-y-3">
              <textarea
                value={msgBody}
                onChange={e => setMsgBody(e.target.value)}
                placeholder="I'm interested in your listing..."
                rows={4}
                className="input-field resize-none w-full"
                autoFocus
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => setMessageTarget(null)} className="btn-ghost flex-1 py-2.5 text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={!msgBody.trim() || sendingMsg} className="btn-brand flex-1 py-2.5 text-sm">
                  {sendingMsg ? 'Sending...' : 'Send message'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <PostListingModal open={postOpen} onClose={() => setPostOpen(false)} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
