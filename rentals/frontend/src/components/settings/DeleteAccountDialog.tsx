'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/use-toast';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';

interface DeleteAccountDialogProps {
  open: boolean;
  onClose: () => void;
  hasPassword: boolean;
  userEmail: string;
}

export default function DeleteAccountDialog({ open, onClose, hasPassword, userEmail }: DeleteAccountDialogProps) {
  const [password, setPassword] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearAuth = useAuthStore(s => s.clearAuth);
  const router = useRouter();
  const { toast } = useToast();

  const canSubmit = hasPassword ? password.length > 0 : confirmEmail.trim().length > 0;

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await usersApi.deleteAccount(hasPassword ? { currentPassword: password } : { confirmEmail });
      clearAuth();
      toast({ title: 'Account deleted', description: 'Sorry to see you go.' });
      router.push('/');
    } catch (err: any) {
      setError(err.message || "Couldn't delete your account. Try again.");
      setDeleting(false);
    }
  }

  function handleClose() {
    if (deleting) return;
    setPassword('');
    setConfirmEmail('');
    setError(null);
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
          onKeyDown={e => { if (e.key === 'Escape') handleClose(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
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
                <h3 id="delete-account-title" className="font-serif text-xl leading-snug">Delete your account?</h3>
              </div>
            </div>

            <p className="text-sm text-neutral-600 leading-relaxed mb-4">
              This permanently deletes your login and profile. It can&apos;t be undone. Your listings will be removed
              from the site. Messages you&apos;ve already sent stay visible to the people you messaged, shown as
              from &ldquo;Deleted user.&rdquo;
            </p>

            {hasPassword ? (
              <Input
                label="Enter your password to confirm"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                placeholder="Current password"
                wrapperClassName="mb-4"
              />
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium text-neutral-900 mb-1.5">
                  Type your account email to confirm: <span className="font-mono normal-case">{userEmail}</span>
                </label>
                <Input
                  type="email"
                  value={confirmEmail}
                  onChange={e => setConfirmEmail(e.target.value)}
                  autoFocus
                  placeholder={userEmail}
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-control px-3 py-2 mb-4">{error}</p>
            )}

            <div className="flex gap-3">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={deleting} className="flex-1">
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive-solid"
                onClick={handleDelete}
                disabled={deleting || !canSubmit}
                loading={deleting}
                className="flex-1"
              >
                {deleting ? 'Deleting…' : 'Delete my account'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
