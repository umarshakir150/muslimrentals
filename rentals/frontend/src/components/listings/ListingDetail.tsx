'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { X, MapPin, Bed, Bath, Phone, Clock, Heart, Flag, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
import { Listing } from '@/types';
import { formatCAD, audienceLabel, audienceColor, formatTimeAgo, cn } from '@/lib/utils';
import { listingsApi } from '@/lib/api';
import { useIsAuthenticated, useUser } from '@/store/authStore';
import { useToast } from '@/components/ui/use-toast';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface ListingDetailProps {
  listing: Listing | null;
  onClose: () => void;
  onMessage: (listing: Listing) => void;
}

export default function ListingDetail({ listing, onClose, onMessage }: ListingDetailProps) {
  const [imgIdx, setImgIdx] = useState(0);
  const [saved, setSaved] = useState(listing?.isSaved || false);
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const isAuth = useIsAuthenticated();
  const user = useUser();
  const { toast } = useToast();

  useEscapeKey(onClose, !!listing);

  if (!listing) return null;
  const imgs = listing.images || [];
  const hasImgs = imgs.length > 0;

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

  async function handleReport() {
    if (!isAuth) { toast({ title: 'Sign in required' }); return; }
    if (!window.confirm('Report this listing as inappropriate?')) return;
    setReporting(true);
    try {
      await listingsApi.report(listing!.id, 'Inappropriate content');
      toast({ title: 'Report submitted', description: 'We review all reports within 24 hours.' });
    } catch { toast({ variant: 'destructive', title: 'Error submitting report' }); }
    finally { setReporting(false); }
  }

  const isOwner = user?.id === listing.user?.id;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-overlay flex items-end sm:items-center justify-center sm:p-4 bg-ink/60 backdrop-blur-sm"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
          transition={{ type: 'spring', damping: 25 }}
          className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-elevated overflow-hidden max-h-[95dvh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-ink/8 shrink-0">
            <span className={cn('px-3 py-1.5 rounded-full text-xs font-bold', audienceColor(listing.audience))}>
              {audienceLabel(listing.audience)}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={handleSave} disabled={saving}
                className={cn('p-2.5 rounded-full transition-colors', saved ? 'bg-red-50 text-red-500' : 'hover:bg-gray-100')}>
                <Heart size={18} fill={saved ? 'currentColor' : 'none'} />
              </button>
              <button onClick={handleReport} disabled={reporting} className="p-2.5 rounded-full hover:bg-gray-100 text-muted">
                <Flag size={18} />
              </button>
              <button onClick={onClose} className="p-2.5 rounded-full hover:bg-gray-100"><X size={18} /></button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {/* Images */}
            {hasImgs ? (
              <div className="relative h-64 sm:h-72 bg-brand-100">
                <Image src={imgs[imgIdx].url} alt={imgs[imgIdx].alt || listing.title} fill className="object-cover" sizes="672px" />
                {imgs.length > 1 && (
                  <>
                    <button onClick={() => setImgIdx(i => (i - 1 + imgs.length) % imgs.length)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white">
                      <ChevronLeft size={18} />
                    </button>
                    <button onClick={() => setImgIdx(i => (i + 1) % imgs.length)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center hover:bg-white">
                      <ChevronRight size={18} />
                    </button>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {imgs.map((_, i) => (
                        <button key={i} onClick={() => setImgIdx(i)}
                          className={cn('w-2 h-2 rounded-full transition-all', i === imgIdx ? 'bg-white w-4' : 'bg-white/60')} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="h-48 bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center">
                <span className="text-6xl opacity-25">🏠</span>
              </div>
            )}

            {/* Details */}
            <div className="p-5">
              <div className="flex items-start justify-between gap-4 mb-1">
                <h2 className="font-serif text-xl leading-snug">{listing.title}</h2>
                <p className="text-2xl font-bold text-brand-700 shrink-0">{formatCAD(listing.price)}<span className="text-sm font-normal text-muted">/mo</span></p>
              </div>

              <div className="flex items-center gap-1.5 text-muted text-sm mb-4">
                <MapPin size={14} className="shrink-0" />
                <span>{[listing.neighbourhood, listing.city, listing.province].filter(Boolean).join(', ')}</span>
              </div>

              <div className="flex flex-wrap gap-4 text-sm mb-5 pb-5 border-b border-ink/8">
                <span className="flex items-center gap-2 font-semibold"><Bed size={16} className="text-muted" /> {listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} bed`}</span>
                <span className="flex items-center gap-2 font-semibold"><Bath size={16} className="text-muted" /> {listing.bathrooms} bath</span>
                <span className="flex items-center gap-2 text-muted ml-auto"><Clock size={14} /> {formatTimeAgo(listing.createdAt)}</span>
              </div>

              <div className="mb-5">
                <h3 className="font-semibold text-sm mb-2">About this rental</h3>
                <p className="text-sm text-muted leading-relaxed whitespace-pre-line">{listing.description}</p>
              </div>

              {listing.amenities?.length > 0 && (
                <div className="mb-5">
                  <h3 className="font-semibold text-sm mb-2">Amenities & features</h3>
                  <div className="flex flex-wrap gap-2">
                    {listing.amenities.map(a => (
                      <span key={a} className="px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold">{a}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Posted by */}
              <div className="flex items-center gap-3 py-3 px-4 bg-gray-50 rounded-2xl mb-5">
                <div className="w-10 h-10 rounded-full bg-brand-gradient flex items-center justify-center text-white font-bold text-sm">
                  {listing.user?.name?.charAt(0) || '?'}
                </div>
                <div>
                  <p className="text-sm font-semibold">{listing.user?.name}</p>
                  <p className="text-xs text-muted">Posted {formatTimeAgo(listing.createdAt)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-5 py-4 border-t border-ink/8 flex gap-3 shrink-0 bg-white">
            {!isOwner && (
              <button onClick={() => onMessage(listing)} className="btn-brand flex-1 py-3 flex items-center justify-center gap-2">
                <MessageSquare size={16} /> Message landlord
              </button>
            )}
            {listing.contactInfo && (
              <button
                onClick={() => { toast({ title: 'Contact info', description: listing.contactInfo }); }}
                className="btn-ghost px-5 py-3 flex items-center gap-2 text-sm">
                <Phone size={16} /> Contact
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
