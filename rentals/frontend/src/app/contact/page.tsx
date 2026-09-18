'use client';

import { useState } from 'react';
import Surface from '@/components/ui/Surface';
import Button from '@/components/ui/Button';
import { Input, Textarea, SelectField } from '@/components/ui/Field';
import { contactApi } from '@/lib/api';

const SUBJECT_LABELS: Record<string, string> = {
  listing: 'Listing issue',
  account: 'Account help',
  safety: 'Safety concern',
  report: 'Report a user',
  other: 'Other',
};

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  // Submits directly to POST /contact (utils/email.ts's existing Resend
  // infrastructure -- the same one already sending password-reset/welcome/
  // email-change emails, no new provider or credential). This used to only
  // build a mailto: link, which silently does nothing without a configured
  // default desktop email client -- confirmed as the actual cause of a
  // founder test where nothing arrived. Awaited (unlike auth's fire-and-
  // forget forgot-password send, which deliberately never reveals delivery
  // status to prevent email enumeration -- a concern that doesn't apply
  // here), so a real failure surfaces as a real, honest error instead of a
  // false success.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await contactApi.submit(form);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your message right now. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <main className="pt-[72px]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
          <h1 className="font-serif text-4xl mb-2">Contact us</h1>
          <p className="text-neutral-600 mb-8">
            We aim to respond within 24 hours, in sha Allah. You can also email us directly at{' '}
            <a href="mailto:muslimrentals.ca@gmail.com" className="text-forest-700 hover:underline font-medium">
              muslimrentals.ca@gmail.com
            </a>
            .
          </p>

          {sent ? (
            <Surface className="p-10 text-center">
              <h2 className="font-serif text-2xl mb-2">Message sent</h2>
              <p className="text-neutral-600">Thank you for contacting Muslim Rentals.</p>
            </Surface>
          ) : (
            <Surface className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label="Name"
                    value={form.name}
                    onChange={e => setForm(f => ({...f, name: e.target.value}))}
                    placeholder="Your name"
                    required
                    disabled={sending}
                  />
                  <Input
                    type="email"
                    label="Email"
                    value={form.email}
                    onChange={e => setForm(f => ({...f, email: e.target.value}))}
                    placeholder="your@email.com"
                    required
                    disabled={sending}
                  />
                </div>
                <SelectField
                  label="Subject"
                  value={form.subject}
                  onChange={e => setForm(f => ({...f, subject: e.target.value}))}
                  required
                  disabled={sending}
                >
                  <option value="">Select a topic...</option>
                  {Object.entries(SUBJECT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </SelectField>
                <Textarea
                  label="Message"
                  value={form.message}
                  onChange={e => setForm(f => ({...f, message: e.target.value}))}
                  placeholder="Describe your issue..."
                  rows={5}
                  maxLength={5000}
                  required
                  disabled={sending}
                />
                {error && <p className="text-[13px] text-destructive">{error}</p>}
                <Button type="submit" size="lg" className="w-full" loading={sending} disabled={sending}>
                  Send message
                </Button>
              </form>
            </Surface>
          )}
        </div>
      </main>
    </div>
  );
}
