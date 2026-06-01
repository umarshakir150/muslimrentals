'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from './use-toast';
import { cn } from '@/lib/utils';

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.95 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            className={cn(
              'pointer-events-auto bg-white border rounded-2xl px-4 py-3 shadow-elevated flex items-start gap-3',
              t.variant === 'destructive' ? 'border-red-200' : 'border-ink/8'
            )}
          >
            {t.variant === 'destructive'
              ? <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              : <CheckCircle size={18} className="text-brand-600 shrink-0 mt-0.5" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink">{t.title}</p>
              {t.description && <p className="text-xs text-muted mt-0.5">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink transition-colors shrink-0 mt-0.5">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
