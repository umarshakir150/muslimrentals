'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Listing } from '@/types';
import { messagesApi } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';

interface SendMessageModalProps {
  listing: Listing;
  onClose: () => void;
  onSent?: () => void;
}

export default function SendMessageModal({ listing, onClose, onSent }: SendMessageModalProps) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await messagesApi.startConversation(listing.id, body.trim());
      toast({ title: 'Message sent!', description: 'The landlord will be notified.' });
      onSent?.();
      onClose();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-elevated p-6 max-w-md w-full"
      >
        <h3 className="font-serif text-xl mb-1">Send a message</h3>
        <p className="text-sm text-muted mb-4">Re: {listing.title}</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="I'm interested in your listing..."
            rows={4}
            className="input-field resize-none w-full"
            autoFocus
          />
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={!body.trim() || sending} className="btn-brand flex-1 py-2.5 text-sm">
              {sending ? 'Sending...' : 'Send message'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
