'use client';

import { useState } from 'react';
import Navbar from '@/components/layout/Navbar';

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // In production, POST to /api/v1/contact
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

          {sent ? (
            <div className="bg-brand-50 border border-brand-200 rounded-3xl p-10 text-center">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="font-serif text-2xl mb-2">Message sent!</h2>
              <p className="text-muted">JazakAllahu khayran. We'll reply within 24 hours.</p>
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
                  <option value="listing">Listing issue</option>
                  <option value="account">Account help</option>
                  <option value="safety">Safety concern</option>
                  <option value="report">Report a user</option>
                  <option value="other">Other</option>
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
