'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Home as HomeIcon, AlertCircle, Search } from 'lucide-react';
import AuthModal from '@/components/auth/AuthModal';
import SendMessageModal from '@/components/messaging/SendMessageModal';
import ListingCard from '@/components/listings/ListingCard';
import CityAutocomplete from '@/components/ui/CityAutocomplete';
import Chip from '@/components/ui/Chip';
import Button, { ButtonLink } from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { listingsApi } from '@/lib/api';
import { Listing, ListingFilters } from '@/types';
import { useFilterStore } from '@/store/filterStore';
import { useIsAuthenticated } from '@/store/authStore';

const ListingDetail = dynamic(() => import('@/components/listings/ListingDetail'), { ssr: false });

// Mirrors ListingFilters.tsx's own audience options exactly -- 'all' is the
// frontend-only sentinel for "no audience filter", the rest are the real
// ListingAudience enum values. Reused for both the hero's lightweight toggle
// and the "browse by who it's for" section below, so both entry points into
// Browse agree on the same five choices.
const AUDIENCE_OPTIONS: { v: NonNullable<ListingFilters['audience']>; label: string }[] = [
  { v: 'all', label: 'Everyone' },
  { v: 'BROTHERS', label: 'Brothers' },
  { v: 'SISTERS', label: 'Sisters' },
  { v: 'COUPLES', label: 'Couples' },
  { v: 'FAMILIES', label: 'Families' },
];

// Paraphrased from the already-published Safety Guidelines page
// (src/app/safety/page.tsx) -- real, approved content, not new copy.
const SAFETY_PRACTICES = [
  'View a property in person, or by video call, before providing any payment.',
  "Keep conversations in the app's messaging so there's a record of what was said.",
  'Report a listing that feels off — our team reviews every report.',
];

type RecentListingsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'loaded'; listings: Listing[] };

export default function Home() {
  const router = useRouter();
  const isAuth = useIsAuthenticated();

  // Hero search -- sets the same global filter store Browse reads from,
  // then navigates there, rather than duplicating filter/search logic.
  const [heroCity, setHeroCity] = useState('');
  const [heroCoords, setHeroCoords] = useState<[number, number] | undefined>();
  const [heroAudience, setHeroAudience] = useState<NonNullable<ListingFilters['audience']>>('all');

  function handleHeroSearch(e: React.FormEvent) {
    e.preventDefault();
    useFilterStore.getState().setFilters({
      city: heroCity,
      ...(heroCoords ? { lat: heroCoords[0], lng: heroCoords[1] } : {}),
      audience: heroAudience,
    });
    router.push('/browse');
  }

  function goToAudience(audience: NonNullable<ListingFilters['audience']>) {
    useFilterStore.getState().setFilters({ audience });
    router.push('/browse');
  }

  // Recently listed -- real platform data (GET /listings, newest first),
  // not a static/marketing section.
  const [recent, setRecent] = useState<RecentListingsState>({ status: 'loading' });
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [messageTarget, setMessageTarget] = useState<Listing | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const fetchRecent = useCallback(async () => {
    setRecent({ status: 'loading' });
    try {
      const res = await listingsApi.getAll({ sort: 'newest', limit: 8 });
      setRecent(res.data.length > 0 ? { status: 'loaded', listings: res.data } : { status: 'empty' });
    } catch {
      setRecent({ status: 'error' });
    }
  }, []);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  return (
    <div className="min-h-dvh">

      {/* Hero -- location-first search, no fabricated stats, no stock photo */}
      <section className="pt-[72px]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">
            Halal-friendly rentals across Canada
          </p>
          <h1 className="font-serif text-[clamp(2.2rem,5vw,3.25rem)] leading-[1.1] text-neutral-900 mb-3">
            Find a home that fits how you live.
          </h1>
          <p className="text-neutral-600 text-base sm:text-lg mb-8">
            Search by city, then filter for brothers-only, sisters-only, couples, or family housing.
          </p>

          <form onSubmit={handleHeroSearch} className="text-left">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <CityAutocomplete
                  value={heroCity}
                  onChange={(city, coords) => { setHeroCity(city); setHeroCoords(coords); }}
                  placeholder="Where are you looking? e.g. Toronto, Mississauga"
                />
              </div>
              <Button type="submit" size="lg" className="w-full sm:w-auto gap-2">
                <Search size={16} /> Search
              </Button>
            </div>

            <div className="flex gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap sm:justify-center mt-4 pb-1">
              {AUDIENCE_OPTIONS.map(opt => (
                <Chip key={opt.v} active={heroAudience === opt.v} onClick={() => setHeroAudience(opt.v)}>
                  {opt.label}
                </Chip>
              ))}
            </div>
          </form>

          <Link
            href="/post"
            className="inline-block mt-6 text-sm font-medium text-neutral-600 hover:text-forest-700 transition-colors"
          >
            Post a listing instead →
          </Link>
        </div>
      </section>

      {/* Recently listed -- real data, proves the marketplace is active */}
      <section className="py-14 sm:py-20 border-t border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-end justify-between gap-4 mb-6">
            <h2 className="font-serif text-2xl sm:text-3xl text-neutral-900">Recently listed</h2>
            {recent.status === 'loaded' && (
              <Link href="/browse" className="text-sm font-semibold text-forest-700 hover:underline whitespace-nowrap">
                See all listings →
              </Link>
            )}
          </div>

          {recent.status === 'loading' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-[320px]" />)}
            </div>
          )}

          {recent.status === 'error' && (
            <EmptyState
              icon={AlertCircle}
              title="Couldn't load listings"
              description="Please refresh the page."
              action={{ label: 'Try again', onClick: fetchRecent }}
            />
          )}

          {recent.status === 'empty' && (
            <EmptyState
              icon={HomeIcon}
              title="No listings yet"
              description="Be the first to post a rental for the community."
              action={{ label: 'Post a listing', onClick: () => router.push('/post') }}
            />
          )}

          {recent.status === 'loaded' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {recent.listings.map((listing, i) => (
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
      </section>

      {/* Browse by who it's for -- the product's real differentiator, no counts implied */}
      <section className="py-14 sm:py-20 border-t border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-2xl sm:text-3xl text-neutral-900 mb-6">Browse by who it&rsquo;s for</h2>
          <div className="flex gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap pb-1">
            {AUDIENCE_OPTIONS.map(opt => (
              <Chip key={opt.v} onClick={() => goToAudience(opt.v)}>
                {opt.label}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      {/* Why this exists / staying safe -- real problem statement + real safety guidance */}
      <section className="py-14 sm:py-20 border-t border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid md:grid-cols-2 gap-10 md:gap-16">
          <div>
            <h2 className="font-serif text-2xl sm:text-3xl text-neutral-900 mb-4">Why Muslim Rentals exists</h2>
            <p className="text-neutral-700 text-[15px] leading-relaxed">
              Finding halal-conscious, community-appropriate housing is hard through general rental sites —
              there&rsquo;s no way to filter for who a unit is being rented to, no roommate matching within the
              community, and a real risk of scams that generic listing sites don&rsquo;t address for this
              audience specifically. Muslim Rentals exists to close that gap.
            </p>
          </div>
          <div>
            <h2 className="font-serif text-2xl sm:text-3xl text-neutral-900 mb-4">Staying safe</h2>
            <ul className="space-y-3 text-[15px] text-neutral-700">
              {SAFETY_PRACTICES.map((practice) => (
                <li key={practice} className="flex gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-forest-600 mt-2 shrink-0" />
                  <span>{practice}</span>
                </li>
              ))}
            </ul>
            <Link href="/safety" className="inline-block mt-4 text-sm font-semibold text-forest-700 hover:underline">
              Read the full safety guidelines →
            </Link>
          </div>
        </div>
      </section>

      {/* Post a listing -- closing strip, not a second hero */}
      <section className="py-12 border-t border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
          <p className="text-neutral-800 text-[15px] font-medium">Have a place to rent out?</p>
          <ButtonLink href="/post" variant="secondary" className="w-full sm:w-auto">
            Post a listing
          </ButtonLink>
        </div>
      </section>

      {/* Modals */}
      {selectedListing && (
        <ListingDetail
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
          onMessage={(l) => { setSelectedListing(null); if (!isAuth) setAuthOpen(true); else setMessageTarget(l); }}
        />
      )}
      {messageTarget && <SendMessageModal listing={messageTarget} onClose={() => setMessageTarget(null)} />}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
