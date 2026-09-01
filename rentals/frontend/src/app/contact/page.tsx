'use client';

import { useState } from 'react';
import Navbar from '@/components/layout/Navbar';

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
    const mailto = `mailto:support@muslimrentals.ca?subject=${encodeURIComponent(`[${subjectLabel}] Muslim Rentals contact form`)}&body=${encodeURIComponent(body)}`;

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
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
          <h1 className="font-serif text-4xl mb-2">Contact us</h1>
          <p className="text-muted mb-8">We aim to respond within 24 hours, in sha Allah.</p>

          <div className="grid sm:grid-cols-3 gap-4 mb-10">
            {[
              { icon: '📧', label: 'Email', value: 'support@muslimrentals.ca' },
              { icon: '🕒', label: 'Response time', value: '24 hours' },
              { icon: '🌐', label: 'Coverage', value: 'All of Canada' },
            ].map(c => (
              <div key={c.label} className="bg-white border border-ink/8 rounded-2xl p-4 text-center shadow-card">
                <div className="text-2xl mb-2">{c.icon}</div>
                <p className="text-xs text-muted font-medium">{c.label}</p>
                <p className="font-semibold text-sm mt-0.5">{c.value}</p>
              </div>
            ))}
          </div>

          {tooLong ? (
            <div className="bg-white border border-ink/8 rounded-3xl p-10 text-center shadow-card">
              <div className="text-5xl mb-4">✍️</div>
              <h2 className="font-serif text-2xl mb-2">Your message is a bit too long to pre-fill</h2>
              <p className="text-muted mb-4">
                We don't want to risk part of a detailed report getting cut off. Please copy what you wrote below
                and paste it into an email to us directly instead:
              </p>
              <a href="mailto:support@muslimrentals.ca" className="text-sm text-brand-700 hover:underline font-semibold block mb-4">
                support@muslimrentals.ca
              </a>
              <textarea readOnly value={form.message} rows={6} className="input-field resize-none w-full text-left mb-4" onClick={e => (e.target as HTMLTextAreaElement).select()} />
              <button type="button" onClick={() => setTooLong(false)} className="btn-ghost px-6 py-2 text-sm">
                Back to edit
              </button>
            </div>
          ) : sent ? (
            <div className="bg-brand-50 border border-brand-200 rounded-3xl p-10 text-center">
              <div className="text-5xl mb-4">📧</div>
              <h2 className="font-serif text-2xl mb-2">Opening your email app…</h2>
              <p className="text-muted mb-4">
                We've pre-filled a message to <strong>support@muslimrentals.ca</strong> with what you wrote. If
                nothing opened, your browser may not have a default email app set up — you can email us directly
                instead.
              </p>
              <a href="mailto:support@muslimrentals.ca" className="text-sm text-brand-700 hover:underline font-semibold">
                support@muslimrentals.ca
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white border border-ink/8 rounded-3xl p-6 shadow-card space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Name</label>
                  <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Your name" required className="input-field" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="your@email.com" required className="input-field" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Subject</label>
                <select value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} required className="input-field appearance-none">
                  <option value="">Select a topic...</option>
                  {Object.entries(SUBJECT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Message</label>
                <textarea value={form.message} onChange={e => setForm(f => ({...f, message: e.target.value}))} placeholder="Describe your issue..." rows={5} required className="input-field resize-none" />
              </div>
              <button type="submit" className="btn-brand w-full py-3">Send message</button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
