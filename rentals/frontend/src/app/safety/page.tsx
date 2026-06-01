import { Metadata } from 'next';
import Navbar from '@/components/layout/Navbar';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Safety Guidelines' };

export default function SafetyPage() {
  return (
    <div className="min-h-dvh">
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 px-4 py-2 rounded-full text-sm font-semibold mb-6">🛡️ Safety & Guidelines</div>
            <h1 className="text-4xl font-serif mb-4">Staying safe on Muslim Rentals</h1>
            <p className="text-muted text-lg leading-relaxed">Your safety is our top priority. We've compiled guidelines specifically for the Muslim community navigating the rental process.</p>
          </div>

          {[
            {
              title: '🔍 Verify before you commit',
              items: [
                'Always view a property in person or via video call before sending any money.',
                "If a deal seems too good to be true, it usually is — verify with the landlord's identity.",
                'Search the address online to confirm it matches what is advertised.',
                'Legitimate landlords will never pressure you to transfer money immediately.',
              ],
            },
            {
              title: '💰 Financial safety',
              items: [
                'Never send e-transfer, gift cards, or wire transfers before signing a lease.',
                'Use Muslim Rentals messaging to keep a record of all communication.',
                'Get a written lease agreement signed by both parties.',
                "Be cautious of requests for large deposits — Ontario's maximum is one month's rent.",
              ],
            },
            {
              title: '🤝 Meeting safely',
              items: [
                'For in-person viewings, bring a trusted friend or family member.',
                'Meet during daylight hours for first viewings.',
                'Tell someone where you are going and when you expect to return.',
                'Trust your instincts — if something feels wrong, leave.',
              ],
            },
            {
              title: '📱 Online safety',
              items: [
                "Don't share your home address, SIN, or banking info with strangers.",
                'Use Muslim Rentals built-in messaging rather than sharing your personal phone number immediately.',
                'Report suspicious listings using the flag button on each card.',
                'Our team reviews all reports within 24 hours.',
              ],
            },
            {
              title: '🤝 Community standards',
              items: [
                'Muslim Rentals is a halal-friendly platform — listings should respect Islamic values.',
                'No mixed-gender unsuitable arrangements should be posted.',
                'Respect the preferences listed by landlords (brothers-only, sisters-only, etc.).',
                "Report any listing that misrepresents itself or violates community standards.",
              ],
            },
          ].map(section => (
            <div key={section.title} className="mb-8 bg-white border border-ink/8 rounded-2xl p-6">
              <h2 className="text-lg font-semibold mb-4">{section.title}</h2>
              <ul className="space-y-2.5">
                {section.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-muted">
                    <span className="w-5 h-5 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="bg-brand-50 border border-brand-200 rounded-2xl p-6 text-center">
            <h3 className="font-semibold text-brand-800 mb-2">See something suspicious?</h3>
            <p className="text-sm text-brand-700 mb-4">Report it immediately using the flag button on any listing, or contact us directly.</p>
            <Link href="/contact" className="btn-brand px-8 py-2.5 text-sm inline-block">Contact support</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
