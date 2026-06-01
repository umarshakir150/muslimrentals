'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Search, ChevronDown, MapIcon, Users, Star, Shield, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/layout/Navbar';
import ListingCard from '@/components/listings/ListingCard';
import ListingFilters from '@/components/listings/ListingFilters';
import { listingsApi } from '@/lib/api';
import { Listing } from '@/types';
import { useFilterStore } from '@/store/filterStore';
import { useToast } from '@/components/ui/use-toast';
import { messagesApi } from '@/lib/api';
import { useIsAuthenticated } from '@/store/authStore';
import AuthModal from '@/components/auth/AuthModal';
import { cn } from '@/lib/utils';

const MiniMap = dynamic(() => import('@/components/map/MiniMap'), { ssr: false });
const FullMap = dynamic(() => import('@/components/map/FullMap'), { ssr: false, loading: () => (
  <div className="w-full h-full bg-brand-50 flex items-center justify-center">
    <div className="text-center"><div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-sm text-muted">Loading map...</p></div>
  </div>
) });

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });
const PostListingModal = dynamic(() => import('@/components/listings/PostListingModal'), { ssr: false });

export default function Home() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [messageTarget, setMessageTarget] = useState<Listing | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [msgBody, setMsgBody] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const { filters, mapCenter, setMapCenter } = useFilterStore();
  const { toast } = useToast();
  const isAuth = useIsAuthenticated();
  const mapSectionRef = useRef<HTMLDivElement>(null);
  const browseSectionRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 400], [0, -60]);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        ...(filters.keyword && { keyword: filters.keyword }),
        ...(filters.city && { city: filters.city }),
        ...(filters.audience && filters.audience !== 'all' && { audience: filters.audience }),
        ...(filters.minBeds && { minBeds: filters.minBeds }),
        ...(filters.minBaths && { minBaths: filters.minBaths }),
        ...(filters.maxPrice && { maxPrice: filters.maxPrice }),
        ...(filters.furnished && { furnished: true }),
        ...(filters.parking && { parking: true }),
        ...(filters.utilities && { utilities: true }),
        sort: filters.sort || 'newest',
        page: filters.page || 1,
        limit: 24,
        ...(filters.lat && { lat: filters.lat, lng: filters.lng, radiusKm: filters.radiusKm }),
      };
      const res = await listingsApi.getAll(params);
      setListings(res.data);
      setTotal(res.pagination?.total || res.data.length);
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load listings' });
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  function scrollToMap() {
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
  function scrollToBrowse() {
    browseSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

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
    } finally { setSendingMsg(false); }
  }

  const stats = [
    { icon: '🏠', label: 'Active listings', value: `${total > 0 ? total : '–'}` },
    { icon: '🇨🇦', label: 'Cities across Canada', value: '80+' },
    { icon: '🔒', label: 'Verified platform', value: 'Trusted' },
    { icon: '🤝', label: 'Community-first', value: 'Always' },
  ];

  return (
    <div className="min-h-dvh">
      <Navbar />

      {/* ─── HERO ────────────────────────────────────────────────────────────── */}
      <section className="relative pt-[72px] overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-8 items-center min-h-[calc(100dvh-72px)] py-16">

            {/* Left: text */}
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <div className="inline-flex items-center gap-2.5 bg-brand-50 border border-brand-200 rounded-full px-4 py-2 mb-6">
                <span className="text-sm font-semibold text-brand-700">🇨🇦 Muslim-focused rentals in Canada</span>
              </div>

              <h1 className="section-title text-[clamp(2.4rem,5vw,3.8rem)] mb-6 leading-[1.04]">
                Find a home <em className="text-brand-600 not-italic">rooted</em> in your values
              </h1>

              <p className="text-lg text-muted mb-8 max-w-lg leading-relaxed">
                Browse halal-friendly rentals across Canada — priced fairly, posted by your community.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={scrollToBrowse} className="btn-brand text-base px-8 py-4 flex items-center justify-center gap-2">
                  Browse listings <ArrowRight size={18} />
                </button>
                <button onClick={() => setPostOpen(true)} className="btn-ghost text-base px-8 py-4">
                  Post a listing
                </button>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-10">
                {stats.map((s, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.1 }}
                    className="bg-white border border-ink/8 rounded-2xl px-4 py-4 text-center shadow-card">
                    <div className="text-2xl mb-1">{s.icon}</div>
                    <div className="font-bold text-lg text-brand-700">{s.value}</div>
                    <div className="text-xs text-muted">{s.label}</div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Right: hero mini map card */}
            <motion.div initial={{ opacity: 0, scale: 0.97, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
              className="relative" style={{ y: heroY }}>
              <div className="relative bg-white border border-ink/8 rounded-3xl shadow-elevated overflow-hidden aspect-[4/3]">
                {/* Map */}
                <div className="absolute inset-0">
                  <MiniMap />
                </div>

                {/* Glass overlay with listing pill */}
                <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none">
                  <div className="glass rounded-2xl px-4 py-2.5 shadow-card">
                    <p className="text-xs text-muted font-medium">Featured area</p>
                    <p className="font-semibold text-sm">Greater Toronto Area</p>
                  </div>
                  <div className="glass rounded-2xl px-3.5 py-2.5 shadow-card flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse" />
                    <p className="text-xs font-semibold text-brand-700">{total} listings</p>
                  </div>
                </div>

                {/* Bottom: Open full map button */}
                <div className="absolute bottom-4 left-4 right-4">
                  <button onClick={scrollToMap}
                    className="w-full glass rounded-2xl py-3 px-5 flex items-center justify-between text-sm font-semibold hover:bg-white/90 transition-all shadow-card group">
                    <span className="flex items-center gap-2"><MapIcon size={16} className="text-brand-600" /> Open full map</span>
                    <ArrowRight size={16} className="text-muted group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>


            </motion.div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="flex justify-center pb-8">
          <motion.button
            onClick={scrollToBrowse}
            animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.5 }}
            className="flex flex-col items-center gap-2 text-muted hover:text-brand-600 transition-colors"
          >
            <span className="text-xs font-semibold">Scroll to browse</span>
            <ChevronDown size={20} />
          </motion.button>
        </div>
      </section>

      {/* ─── BROWSE SECTION ──────────────────────────────────────────────────── */}
      <section ref={browseSectionRef} id="browse" className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="section-title text-3xl md:text-4xl mb-2">Browse rentals</h2>
              <p className="text-muted">{total > 0 ? `${total} listings across Canada` : 'Loading listings...'}</p>
            </div>
            <div className="flex items-center gap-3">
              <ListingFilters />
            </div>
          </div>

          <div className="lg:grid lg:grid-cols-[280px_1fr] gap-8">
            {/* Desktop filter sidebar */}
            <div className="hidden lg:block">
              <div className="bg-white border border-ink/8 rounded-2xl p-5 shadow-card sticky top-[88px]">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Search size={16} className="text-muted" /> Filter listings
                </h3>
                <ListingFilters />
              </div>
            </div>

            {/* Listing grid */}
            <div>
              {loading ? (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-white rounded-3xl overflow-hidden border border-ink/8 animate-pulse">
                      <div className="h-48 bg-gray-100" />
                      <div className="p-4 space-y-3">
                        <div className="h-4 bg-gray-100 rounded-lg w-3/4" />
                        <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
                        <div className="h-3 bg-gray-100 rounded-lg w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : listings.length === 0 ? (
                <div className="text-center py-20">
                  <div className="text-6xl mb-4">🏘️</div>
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
                      onMap={(l) => { setMapCenter([l.lat, l.lng]); scrollToMap(); }}
                      onMessage={(l) => { if (!isAuth) setAuthOpen(true); else setMessageTarget(l); }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── FULL MAP SECTION ────────────────────────────────────────────────── */}
      <section ref={mapSectionRef} id="map" className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <h2 className="section-title text-3xl md:text-4xl mb-2">Explore the map</h2>
            <p className="text-muted">Find rentals across Canada. Click any marker to view details.</p>
          </div>

          <div className="bg-white border border-ink/8 rounded-3xl shadow-card overflow-hidden" style={{ height: '70vh', minHeight: 500 }}>
            <FullMap
              listings={listings}
              center={mapCenter}
              radiusKm={filters.radiusKm || 80}
              onCentreChange={setMapCenter}
              onListingClick={setSelectedListing}
            />
          </div>
        </div>
      </section>

      {/* ─── FEATURES SECTION ────────────────────────────────────────────────── */}
      <section className="py-20 bg-brand-gradient">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center text-white">
          <h2 className="section-title text-3xl md:text-5xl mb-4 text-white">Built for the Ummah</h2>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-14">
            Muslim Rentals is a community-first platform designed with Muslim values in mind.
          </p>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: '🤝', title: 'Community-first', desc: 'A trusted platform built by and for Canada's Muslim community.' },
              { icon: '🛡️', title: 'Safe community', desc: 'Listings reviewed for safety. Report issues easily.' },
              { icon: '💬', title: 'Real-time chat', desc: 'Message landlords securely. No email required.' },
              { icon: '🇨🇦', title: 'Across Canada', desc: 'From Vancouver to Halifax — every province covered.' },
            ].map((f, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} viewport={{ once: true }}
                className="bg-white/10 border border-white/15 rounded-3xl p-6 backdrop-blur-sm text-left">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-white/70 text-sm leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer className="bg-ink text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-10">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-[13px] bg-brand-gradient flex items-center justify-center">
                  <span className="text-white text-lg">M</span>
                </div>
                <span className="font-serif text-xl">Muslim Rentals</span>
              </div>
              <p className="text-white/60 text-sm leading-relaxed max-w-xs">
                A halal-friendly rental platform built for Canada's Muslim community. Find your home with trust.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-4 text-white/80">Platform</h4>
              <ul className="space-y-2">
                {[['Browse listings', '/#browse'], ['Post a listing', '#'], ['Map view', '/#map'], ['Messages', '/messages']].map(([label, href]) => (
                  <li key={label}><Link href={href} className="text-white/50 hover:text-white text-sm transition-colors">{label}</Link></li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-4 text-white/80">Legal</h4>
              <ul className="space-y-2">
                {[['Terms of Service', '/terms'], ['Privacy Policy', '/privacy'], ['Safety Guidelines', '/safety'], ['Contact Us', '/contact']].map(([label, href]) => (
                  <li key={label}><Link href={href} className="text-white/50 hover:text-white text-sm transition-colors">{label}</Link></li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
            <p className="text-white/40 text-sm">© {new Date().getFullYear()} Muslim Rentals. All rights reserved.</p>
            <p className="text-white/30 text-xs">Made with 💚 for the Canadian Ummah</p>
          </div>
        </div>
      </footer>

      {/* ─── Modals ──────────────────────────────────────────────────────────── */}
      {selectedListing && (
        <ListingDetail
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          onMessage={(l) => { setSelectedListing(null); if (!isAuth) setAuthOpen(true); else setMessageTarget(l); }}
        />
      )}

      {messageTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setMessageTarget(null); }}>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl shadow-elevated p-6 max-w-md w-full">
            <h3 className="font-serif text-xl mb-1">Send a message</h3>
            <p className="text-sm text-muted mb-4">Re: {messageTarget.title}</p>
            <form onSubmit={handleSendMessage} className="space-y-3">
              <textarea
                value={msgBody}
                onChange={e => setMsgBody(e.target.value)}
                placeholder="Assalamu alaikum, I'm interested in your listing..."
                rows={4}
                className="input-field resize-none w-full"
                autoFocus
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => setMessageTarget(null)} className="btn-ghost flex-1 py-2.5 text-sm">Cancel</button>
                <button type="submit" disabled={!msgBody.trim() || sendingMsg} className="btn-brand flex-1 py-2.5 text-sm">
                  {sendingMsg ? 'Sending…' : 'Send message'}
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
