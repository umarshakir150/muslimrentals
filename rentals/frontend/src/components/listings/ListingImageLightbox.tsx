'use client';

import { useEffect, useRef } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { ListingImage } from '@/types';

interface ListingImageLightboxProps {
  images: ListingImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  title: string;
}

const SWIPE_THRESHOLD = 50;

export default function ListingImageLightbox({ images, index, onIndexChange, onClose, title }: ListingImageLightboxProps) {
  const hasMultiple = images.length > 1;
  const dragDistance = useRef(0);

  function goPrev() { onIndexChange((index - 1 + images.length) % images.length); }
  function goNext() { onIndexChange((index + 1) % images.length); }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (hasMultiple && e.key === 'ArrowLeft') goPrev();
      if (hasMultiple && e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, hasMultiple]);

  const image = images[index];
  if (!image) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex items-center justify-center bg-ink/90 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center z-10"
      >
        <X size={20} />
      </button>

      {hasMultiple && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/10 text-white text-sm font-semibold">
          {index + 1} / {images.length}
        </div>
      )}

      {hasMultiple && (
        <>
          <button
            onClick={e => { e.stopPropagation(); goPrev(); }}
            aria-label="Previous photo"
            className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center z-10"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); goNext(); }}
            aria-label="Next photo"
            className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center z-10"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      <motion.div
        key={image.id}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        drag={hasMultiple ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        dragMomentum={false}
        onDrag={(_, info: PanInfo) => { dragDistance.current = info.offset.x; }}
        onDragEnd={() => {
          if (dragDistance.current < -SWIPE_THRESHOLD) goNext();
          else if (dragDistance.current > SWIPE_THRESHOLD) goPrev();
          dragDistance.current = 0;
        }}
        onClick={e => e.stopPropagation()}
        className="relative w-full h-full max-w-5xl max-h-[85dvh] touch-pan-y"
      >
        <Image
          src={image.url}
          alt={image.alt || title}
          fill
          className="object-contain select-none pointer-events-none"
          sizes="100vw"
          draggable={false}
          priority
        />
      </motion.div>
    </motion.div>
  );
}
