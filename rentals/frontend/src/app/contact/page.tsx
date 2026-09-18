'use client';

import { useState } from 'react';
import Surface from '@/components/ui/Surface';
import Button from '@/components/ui/Button';
import { Input, Textarea, SelectField } from '@/components/ui/Field';

const SUBJECT_LABELS: Record<string, string> = {
  listing: 'Listing issue',
  account: 'Account help',
  safety: 'Safety concern',
  report: 'Report a user',
  other: 'Other',
};

// Many browsers/OSes/mail clients start truncating or silently refusing a
// mailto: URL somewhere around 2000 characters. Below this we can trust the
// prefilled handoff actually carries the full message; above it, claiming
// success would risk a truncated safety/abuse report going out incomplete
// -- so that case gets a different, honest state instead of a false "sent."
const SAFE_MAILTO_LENGTH = 1800;

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [sent, setSent] = useState(false);
  const [tooLong, setTooLong] = useState(false);

  // There's no backend endpoint (and no working outbound email delivery
  // yet) to receive an in-app submission, so a form that claimed to "send"
  // and showed a fake success state was silently discarding every message.
  // Building on the browser's own mailto: handoff instead is guaranteed to
  // actually reach someone, with zero new backend surface -- it opens the
  // visitor's own email client with the message pre-filled, addressed to
  // our real support inbox.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subjectLabel = SUBJECT_LABELS[form.subject] || 'General inquiry';
    const body = `${form.message}\n\n—\nFrom: ${form.name} <${form.email}>`;
    const mailto = `mailto:muslimrentals.ca@gmail.com?subject=${encodeURIComponent(`[${subjectLabel}] Muslim Rentals contact form`)}&body=${encodeURIComponent(body)}`;

    // A long, detailed message -- exactly what "Safety concern" or "Report
    // a user" realistically need -- risks the mailto: URL being silently
    // truncated by the browser or OS before it ever reaches the mail
    // client. Rather than optimistically claim success either way, only
    // claim it when we can trust the full message actually made it through.
    if (mailto.length > SAFE_MAILTO_LENGTH) {
      setTooLong(true);
      return;
    }
    window.location.href = mailto;
    setSent(true);
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

          {tooLong ? (
            <Surface className="p-10 text-center">
              <h2 className="font-serif text-2xl mb-2">Your message is a bit too long to pre-fill</h2>
              <p className="text-neutral-600 mb-4">
                We don't want to risk part of a detailed report getting cut off. Please copy what you wrote below
                and paste it into an email to us directly instead:
              </p>
              <a href="mailto:muslimrentals.ca@gmail.com" className="text-sm text-forest-700 hover:underline font-semibold block mb-4">
                muslimrentals.ca@gmail.com
              </a>
              <Textarea
                readOnly
                value={form.message}
                rows={6}
                wrapperClassName="mb-4 text-left"
                className="resize-none"
                onClick={e => (e.target as HTMLTextAreaElement).select()}
              />
              <Button type="button" variant="ghost" onClick={() => setTooLong(false)}>
                Back to edit
              </Button>
            </Surface>
          ) : sent ? (
            <Surface className="p-10 text-center">
              <h2 className="font-serif text-2xl mb-2">Message ready to send</h2>
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
                  />
                  <Input
                    type="email"
                    label="Email"
                    value={form.email}
                    onChange={e => setForm(f => ({...f, email: e.target.value}))}
                    placeholder="your@email.com"
                    required
                  />
                </div>
                <SelectField
                  label="Subject"
                  value={form.subject}
                  onChange={e => setForm(f => ({...f, subject: e.target.value}))}
                  required
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
                  required
                />
                <Button type="submit" size="lg" className="w-full">Send message</Button>
              </form>
            </Surface>
          )}
        </div>
      </main>
    </div>
  );
}
