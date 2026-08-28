'use client';

import { useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Bed, Bath, MapPin, Heart, Clock, MessageSquare, Map } from 'lucide-react';
import { Listing } from '@/types';
import { formatCAD, audienceLabel, audienceColor, formatTimeAgo, cn } from '@/lib/utils';
import { listingsApi } from '@/lib/api';
import { useIsAuthenticated } from '@/store/authStore';
import { useToast } from '@/components/ui/use-toast';

interface ListingCardProps {
  listing: Listing;
  onView: (listing: Listing) => void;
  onMap: (listing: Listing) => void;
  onMessage: (listing: Listing) => void;
  onSaveChange?: (listing: Listing, saved: boolean) => void;
  index?: number;
}

export default function ListingCard({ listing, onView, onMap, onMessage, onSaveChange, index = 0 }: ListingCardProps) {
  const [saved, setSaved] = useState(listing.isSaved || false);
  const [savingState, setSavingState] = useState(false);
  const isAuth = useIsAuthenticated();
  const { toast } = useToast();

  const isNew = (Date.now() - new Date(listing.createdAt).getTime()) < 48 * 3600 * 1000;
  const imgSrc = listing.thumbnailUrl || listing.images?.[0]?.url;
  const hasCoords = listing.lat != null && listing.lng != null;

  async function handleSave(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isAuth) { toast({ title: 'Sign in required', description: 'Sign in to save listings.' }); return; }
    setSavingState(true);
    try {
      const res = await listingsApi.save(listing.id);
      setSaved(res.saved);
      onSaveChange?.(listing, res.saved);
      toast({ title: res.saved ? 'Saved!' : 'Removed', description: res.saved ? 'Listing saved to your collection.' : 'Removed from saved.' });
    } catch { toast({ variant: 'destructive', title: 'Error', description: 'Could not save listing.' }); }
    finally { setSavingState(false); }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="bg-white border border-ink/8 rounded-3xl overflow-hidden card-hover cursor-pointer group"
      onClick={() => onView(listing)}
    >
      {/* Image */}
      <div className="relative h-48 bg-brand-100 overflow-hidden">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={listing.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center">
            <span className="text-4xl opacity-40">🏠</span>
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-3 left-3 right-3 flex justify-between items-start">
          <div className="flex gap-2">
            <span className={cn('px-3 py-1 rounded-full text-xs font-bold', audienceColor(listing.audience))}>
              {audienceLabel(listing.audience)}
            </span>
            {isNew && <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-gold-400 text-white">NEW</span>}
          </div>
          <button
            onClick={handleSave}
            disabled={savingState}
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200',
              saved ? 'bg-red-500 text-white' : 'bg-white/90 text-ink hover:bg-red-50 hover:text-red-500'
            )}
          >
            <Heart size={14} fill={saved ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Price */}
        <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-sm px-3 py-1 rounded-full border border-ink/8 text-sm font-bold text-brand-700">
          {formatCAD(listing.price)}<span className="font-normal text-muted">/mo</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        <h3 className="font-semibold text-base leading-snug mb-2 line-clamp-2 group-hover:text-brand-700 transition-colors">
          {listing.title}
        </h3>

        <div className="flex items-center gap-1 text-muted text-xs mb-3">
          <MapPin size={12} className="shrink-0" />
          <span className="truncate">{listing.neighbourhood ? `${listing.neighbourhood}, ` : ''}{listing.city}</span>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted mb-3">
          <span className="flex items-center gap-1.5"><Bed size={13} /> {listing.bedrooms} bed{listing.bedrooms !== 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1.5"><Bath size={13} /> {listing.bathrooms} bath</span>
          <span className="flex items-center gap-1.5 ml-auto text-xs"><Clock size={11} /> {formatTimeAgo(listing.createdAt)}</span>
        </div>

        {listing.amenities.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-3">
            {listing.amenities.slice(0, 3).map(a => (
              <span key={a} className="px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-[11px] font-semibold">{a}</span>
            ))}
          </div>
        )}

        <div className="flex gap-2 mt-1 pt-3 border-t border-ink/6">
          <button
            onClick={(e) => { e.stopPropagation(); onMessage(listing); }}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-muted bg-gray-50 rounded-xl py-2.5 hover:bg-brand-50 hover:text-brand-700 transition-colors"
          >
            <MessageSquare size={13} /> Message
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); if (hasCoords) onMap(listing); }}
            disabled={!hasCoords}
            aria-disabled={!hasCoords}
            title={hasCoords ? undefined : 'Location not available for this listing'}
            className={cn(
              'flex items-center justify-center gap-1.5 px-4 text-xs font-semibold rounded-xl py-2.5 transition-colors',
              hasCoords
                ? 'text-muted bg-gray-50 hover:bg-brand-50 hover:text-brand-700'
                : 'text-muted/40 bg-gray-50 cursor-not-allowed'
            )}
          >
            <Map size={13} /> Map
          </button>
        </div>
      </div>
    </motion.article>
  );
}
