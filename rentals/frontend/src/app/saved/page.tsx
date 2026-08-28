'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { motion } from 'framer-motion';
import Navbar from '@/components/layout/Navbar';
import ListingCard from '@/components/listings/ListingCard';
import AuthModal from '@/components/auth/AuthModal';
import { usersApi, messagesApi } from '@/lib/api';
import { Listing } from '@/types';
import { useIsAuthenticated } from '@/store/authStore';
import { useToast } from '@/components/ui/use-toast';

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });

export default function SavedPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [messageTarget, setMessageTarget] = useState<Listing | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [msgBody, setMsgBody] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  const isAuth = useIsAuthenticated();
  const router = useRouter();
  const { toast } = useToast();

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

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!msgBody.trim() || !messageTarget) return;
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

  if (!isAuth) {
    return (
      <div className="min-h-dvh">
        <Navbar />
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
      <Navbar />

      <div className="pt-[72px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

          <div className="mb-6">
            <h1 className="section-title text-3xl md:text-4xl mb-1">Saved listings</h1>
            <p className="text-muted text-sm">
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
              <p className="text-muted mb-4">Unable to load your saved listings right now.</p>
              <button onClick={fetchSaved} className="btn-brand px-6 py-2.5 text-sm">Try again</button>
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-20">
              <Heart size={32} className="mx-auto mb-3 opacity-20" />
              <h3 className="font-serif text-2xl mb-2">No saved listings yet</h3>
              <p className="text-muted mb-6">Tap the heart on a listing to save it here for later.</p>
              <button onClick={() => router.push('/browse')} className="btn-brand px-8 py-3">
                Browse rentals
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
    </div>
  );
}
