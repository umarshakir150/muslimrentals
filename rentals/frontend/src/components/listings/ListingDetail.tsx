'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import Image from 'next/image';
import { X, MapPin, Bed, Bath, Phone, Clock, Heart, Flag, ChevronLeft, ChevronRight, MessageSquare, Trash2, Home as HomeIcon } from 'lucide-react';
import { Listing, ListingImage } from '@/types';
import { formatCAD, audienceLabel, formatTimeAgo, cn } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { listingsApi } from '@/lib/api';
import { useIsAuthenticated, useUser } from '@/store/authStore';
import { useToast } from '@/components/ui/use-toast';
import DeleteListingDialog from './DeleteListingDialog';
import ListingImageLightbox from './ListingImageLightbox';
import ReportModal from '@/components/reports/ReportModal';
import ListingLocationMap from './ListingLocationMap';

const SWIPE_THRESHOLD = 50;

interface ListingDetailProps {
  listing: Listing | null;
  onClose: () => void;
  onMessage: (listing: Listing) => void;
  onDeleted?: (listingId: string) => void;
}

export default function ListingDetail({ listing, onClose, onMessage, onDeleted }: ListingDetailProps) {
  const [imgIdx, setImgIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [saved, setSaved] = useState(listing?.isSaved || false);
  const [saving, setSaving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // `listing` as passed in by every caller (browse/map/saved/my-listings) comes
  // straight from GET /listings, which caps `images` to 1 (take: 1) for list
  // thumbnails -- it is never the full GET /listings/:id detail response. Without
  // this fetch, the gallery/lightbox would never see more than one image no
  // matter how correct their own logic is. `fullImages` overrides the prop's
  // (possibly truncated) array once the real detail response arrives; until
  // then the prop's thumbnail is shown so opening the modal doesn't stall.
  const [fullImages, setFullImages] = useState<ListingImage[] | null>(null);
  const isAuth = useIsAuthenticated();
  const user = useUser();
  const { toast } = useToast();
  const dragDistance = useRef(0);

  // Guard against a stale index/open lightbox carrying over if the `listing`
  // prop swaps to a different listing without this component unmounting
  // (parents don't key ListingDetail by listing id).
  useEffect(() => {
    setImgIdx(0);
    setLightboxOpen(false);
    setFullImages(null);

    if (!listing) return;
    let cancelled = false;
    listingsApi.getById(listing.id)
      .then(res => { if (!cancelled) setFullImages(res.data?.images || []); })
      .catch(() => { /* keep showing the prop's thumbnail; not fatal */ });
    return () => { cancelled = true; };
  }, [listing?.id]);

  if (!listing) return null;
  const imgs = fullImages ?? (listing.images || []);
  const hasImgs = imgs.length > 0;
  const hasMultipleImgs = imgs.length > 1;

  function goPrevImg() { setImgIdx(i => (i - 1 + imgs.length) % imgs.length); }
  function goNextImg() { setImgIdx(i => (i + 1) % imgs.length); }

  async function handleSave() {
    if (!isAuth) { toast({ title: 'Sign in required' }); return; }
    setSaving(true);
    try {
      const res = await listingsApi.save(listing!.id);
      setSaved(res.saved);
      toast({ title: res.saved ? 'Saved!' : 'Removed' });
    } catch { toast({ variant: 'destructive', title: 'Error saving listing' }); }
    finally { setSaving(false); }
  }

  function handleReport() {
    if (!isAuth) { toast({ title: 'Sign in required' }); return; }
    setReportOpen(true);
  }

  const isOwner = user?.id === listing.user?.id;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-ink/60 backdrop-blur-sm"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
          transition={{ type: 'spring', damping: 25 }}
          className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-elevated overflow-hidden max-h-[95dvh] flex flex-col">

          {/* Header -- a plain icon-action strip now that the audience badge
              (below) has moved into the content flow, closer to price/facts. */}
          <div className="flex items-center justify-end gap-1 px-3 py-2.5 border-b border-neutral-200 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              aria-label={saved ? 'Unsave listing' : 'Save listing'}
              className={cn('w-9 h-9 p-0 rounded-full', saved && 'bg-destructive/10 text-destructive hover:bg-destructive/15')}
            >
              <Heart size={18} fill={saved ? 'currentColor' : 'none'} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReport}
              aria-label="Report listing"
              className="w-9 h-9 p-0 rounded-full text-neutral-600"
            >
              <Flag size={18} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close listing details"
              className="w-9 h-9 p-0 rounded-full"
            >
              <X size={18} />
            </Button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {/* Images */}
            {hasImgs ? (
              <div className="relative h-72 sm:h-[400px] bg-neutral-100 overflow-hidden">
                <motion.div
                  key={imgIdx}
                  drag={hasMultipleImgs ? 'x' : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.7}
                  dragMomentum={false}
                  onDrag={(_, info: PanInfo) => { dragDistance.current = info.offset.x; }}
                  onDragEnd={() => {
                    if (dragDistance.current < -SWIPE_THRESHOLD) goNextImg();
                    else if (dragDistance.current > SWIPE_THRESHOLD) goPrevImg();
                    dragDistance.current = 0;
                  }}
                  onTap={() => setLightboxOpen(true)}
                  className="relative w-full h-full cursor-zoom-in touch-pan-y"
                >
                  <Image src={imgs[imgIdx].url} alt={imgs[imgIdx].alt || listing.title} fill className="object-cover pointer-events-none" sizes="672px" priority />
                </motion.div>
                {hasMultipleImgs && (
                  <>
                    <button onClick={goPrevImg} aria-label="Previous photo"
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-elevation1 flex items-center justify-center hover:bg-neutral-50">
                      <ChevronLeft size={18} />
                    </button>
                    <button onClick={goNextImg} aria-label="Next photo"
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-elevation1 flex items-center justify-center hover:bg-neutral-50">
                      <ChevronRight size={18} />
                    </button>
                    <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-neutral-900/70 text-white text-xs font-semibold">
                      {imgIdx + 1} / {imgs.length}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="h-48 sm:h-64 bg-forest-50 flex items-center justify-center">
                <HomeIcon size={48} strokeWidth={1.5} className="text-forest-300" role="img" aria-label="No photos available" />
              </div>
            )}

            {/* Details */}
            <div className="p-5 sm:p-6">
              <Badge variant="emphasis" className="mb-2">{audienceLabel(listing.audience)}</Badge>

              <h2 className="font-serif text-xl leading-snug mb-1">{listing.title}</h2>
              <p className="text-3xl font-bold text-forest-700 mb-3">
                {formatCAD(listing.price)}<span className="text-sm font-normal text-neutral-500">/mo</span>
              </p>

              <div className="mb-4">
                <div className="flex items-center gap-1.5 text-neutral-600 text-sm">
                  <MapPin size={14} className="shrink-0" />
                  <span>{[listing.neighbourhood, listing.city, listing.province].filter(Boolean).join(', ')}</span>
                </div>
                {listing.locationApproximate && (
                  <p className="text-xs text-neutral-500 mt-1">
                    <span className="font-semibold text-neutral-700">Approximate location.</span>{' '}
                    <span className="italic">Exact address hidden for privacy.</span>
                  </p>
                )}
              </div>

              <div className="mb-5">
                <ListingLocationMap listing={listing} />
              </div>

              <div className="flex flex-wrap gap-4 text-sm mb-5 pb-5 border-b border-neutral-200">
                <span className="flex items-center gap-2 font-semibold"><Bed size={16} className="text-neutral-500" /> {listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} bed`}</span>
                <span className="flex items-center gap-2 font-semibold"><Bath size={16} className="text-neutral-500" /> {listing.bathrooms} bath</span>
                <span className="flex items-center gap-2 text-neutral-600 ml-auto"><Clock size={14} /> {formatTimeAgo(listing.createdAt)}</span>
              </div>

              <div className="mb-5">
                <h3 className="font-semibold text-sm mb-2">About this rental</h3>
                <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-line">{listing.description}</p>
              </div>

              {listing.amenities?.length > 0 && (
                <div className="mb-5">
                  <h3 className="font-semibold text-sm mb-2">Amenities & features</h3>
                  <div className="flex flex-wrap gap-2">
                    {listing.amenities.map(a => (
                      <Badge key={a} variant="neutral">{a}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Posted by -- a plain row above a divider, not a card-in-card */}
              <div className="flex items-center gap-3 pt-4 border-t border-neutral-200">
                <div className="w-10 h-10 rounded-full bg-forest-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {listing.user?.name?.charAt(0) || '?'}
                </div>
                <div>
                  <p className="text-sm font-semibold">{listing.user?.name}</p>
                  <p className="text-xs text-neutral-500">Posted {formatTimeAgo(listing.createdAt)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-5 py-4 border-t border-neutral-200 flex items-center gap-3 shrink-0 bg-white">
            {!isOwner && (
              <Button variant="primary" size="lg" onClick={() => onMessage(listing)} className="flex-1">
                <MessageSquare size={16} /> Message landlord
              </Button>
            )}
            {listing.contactInfo && (
              <Button
                variant="secondary"
                size="lg"
                onClick={() => { toast({ title: 'Contact info', description: listing.contactInfo }); }}
              >
                <Phone size={16} /> Contact
              </Button>
            )}
            {isOwner && (
              <Button variant="destructive-ghost" size="sm" onClick={() => setDeleteOpen(true)} className="ml-auto">
                <Trash2 size={15} /> Delete listing
              </Button>
            )}
          </div>
        </motion.div>
      </motion.div>

      <DeleteListingDialog
        listingId={listing.id}
        listingTitle={listing.title}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={(id) => { setDeleteOpen(false); onDeleted?.(id); onClose(); }}
      />

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="LISTING"
        contextLabel={listing.title}
        onSubmit={(reason, description) => listingsApi.report(listing.id, reason, description).then(() => {})}
      />

      {lightboxOpen && hasImgs && (
        <ListingImageLightbox
          images={imgs}
          index={imgIdx}
          onIndexChange={setImgIdx}
          onClose={() => setLightboxOpen(false)}
          title={listing.title}
        />
      )}
    </AnimatePresence>
  );
}
