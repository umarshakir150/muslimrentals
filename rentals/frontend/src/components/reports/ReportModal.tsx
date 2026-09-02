'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag, Loader2, ChevronLeft } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export type ReportTargetType = 'LISTING' | 'USER' | 'MESSAGE';

// Never show a target's reasons to a different target type -- e.g. "Misleading
// or fraudulent listing" only makes sense for LISTING, "Impersonation" only for
// a USER (a single message can't impersonate anyone by itself).
export const REPORT_REASONS: Record<ReportTargetType, string[]> = {
  LISTING: [
    'Misleading or fraudulent listing',
    'Scam or fraud attempt',
    'Inappropriate content',
    'Spam',
    'Other',
  ],
  USER: [
    'Harassment or abusive behavior',
    'Scam or fraud attempt',
    'Impersonation',
    'Inappropriate content',
    'Spam',
    'Other',
  ],
  MESSAGE: [
    'Harassment or abusive behavior',
    'Scam or fraud attempt',
    'Inappropriate content',
    'Spam',
    'Other',
  ],
};

const TARGET_LABEL: Record<ReportTargetType, string> = {
  LISTING: 'listing',
  USER: 'user',
  MESSAGE: 'message',
};

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  /** What's being reported, shown as a short context preview (a listing title, a user's name, a message snippet). */
  contextLabel: string;
  onSubmit: (reason: string, description?: string) => Promise<void>;
}

type Step = 'reason' | 'description';

export default function ReportModal({ open, onClose, targetType, contextLabel, onSubmit }: ReportModalProps) {
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Fresh state every time the modal is (re)opened -- otherwise reopening it
  // for a different target would carry over the previous target's selection.
  useEffect(() => {
    if (open) {
      setStep('reason');
      setReason(null);
      setDescription('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  function selectReason(r: string) {
    setReason(r);
    setStep('description');
  }

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(reason, description.trim() || undefined);
      toast({ title: 'Report submitted', description: 'We review all reports within 24 hours.' });
      onClose();
    } catch (err: any) {
      setError(err?.message || "Couldn't submit this report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center sm:p-4 bg-ink/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
          onKeyDown={e => { if (e.key === 'Escape') handleClose(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-modal-title"
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', damping: 25 }}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-elevated p-6 max-h-[90dvh] overflow-y-auto"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Flag size={18} className="text-red-500" />
              </div>
              <div className="min-w-0">
                <h3 id="report-modal-title" className="font-serif text-xl leading-snug">
                  Report this {TARGET_LABEL[targetType]}
                </h3>
                <p className="text-sm text-muted truncate">{contextLabel}</p>
              </div>
            </div>

            {step === 'reason' && (
              <div className="space-y-2">
                <p className="text-sm font-semibold mb-1">Why are you reporting this?</p>
                {REPORT_REASONS[targetType].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => selectReason(r)}
                    className="w-full min-h-[44px] text-left px-4 py-3 rounded-xl border border-ink/8 hover:bg-brand-50 hover:border-brand-200 transition-colors text-sm font-medium"
                  >
                    {r}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleClose}
                  className="btn-ghost w-full min-h-[44px] py-2.5 text-sm mt-2"
                >
                  Cancel
                </button>
              </div>
            )}

            {step === 'description' && (
              <div>
                <button
                  type="button"
                  onClick={() => setStep('reason')}
                  disabled={submitting}
                  className="flex items-center gap-1 text-sm text-muted hover:text-ink mb-3 min-h-[44px] -ml-2 px-2"
                >
                  <ChevronLeft size={16} /> {reason}
                </button>

                <label htmlFor="report-description" className="text-sm font-semibold mb-1.5 block">
                  Anything else we should know? <span className="font-normal text-muted">(optional)</span>
                </label>
                <textarea
                  id="report-description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={submitting}
                  maxLength={1000}
                  rows={4}
                  placeholder="Add any details that will help us review this report..."
                  className="input-field w-full resize-none mb-4"
                />

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 mb-4">{error}</p>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={submitting}
                    className="btn-ghost flex-1 min-h-[44px] py-2.5 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-1 min-h-[44px] py-2.5 text-sm font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
                    {submitting ? 'Submitting…' : error ? 'Retry' : 'Submit report'}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
