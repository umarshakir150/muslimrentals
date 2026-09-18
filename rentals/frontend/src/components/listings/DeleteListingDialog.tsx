'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { listingsApi } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import Button from '@/components/ui/Button';

interface DeleteListingDialogProps {
  listingId: string;
  listingTitle: string;
  open: boolean;
  onClose: () => void;
  onDeleted: (listingId: string) => void;
}

export default function DeleteListingDialog({ listingId, listingTitle, open, onClose, onDeleted }: DeleteListingDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await listingsApi.deletePermanent(listingId);
      toast({ title: 'Listing deleted' });
      onDeleted(listingId);
    } catch (err: any) {
      setError(err.message || "Couldn't delete this listing. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget && !deleting) onClose(); }}
          onKeyDown={e => { if (e.key === 'Escape' && !deleting) onClose(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-listing-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
            className="bg-white rounded-3xl shadow-elevated p-6 max-w-md w-full"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-destructive" />
              </div>
              <div>
                <h3 id="delete-listing-title" className="font-serif text-xl leading-snug">Delete this listing?</h3>
              </div>
            </div>

            <p className="text-sm text-neutral-600 leading-relaxed mb-5">
              This will permanently delete &ldquo;{listingTitle}&rdquo; and its photos. This can&apos;t be undone.
              Any existing conversations about this listing will remain, but will no longer link to a live listing.
            </p>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-control px-3 py-2 mb-4">{error}</p>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                autoFocus
                variant="ghost"
                onClick={onClose}
                disabled={deleting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive-solid"
                onClick={handleDelete}
                loading={deleting}
                className="flex-1"
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
