import Link from 'next/link';

// Global site footer (Milestone 1). Previously this only existed inline on
// the homepage -- every other page had no footer at all. Now rendered once
// from app/layout.tsx so every page gets it. Charcoal background rather
// than forest/green: a green footer repeated on every single page is
// exactly the "huge repeated green sections" pattern the overhaul is
// moving away from, so forest stays reserved for actual brand/action
// moments instead.
export default function Footer() {
  return (
    <footer className="bg-neutral-900 text-white py-12 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid md:grid-cols-4 gap-10 mb-10">
          <div className="md:col-span-2">
            <Link href="/" className="inline-flex items-center gap-2.5 font-serif text-xl mb-4">
              muslimrentals.ca
            </Link>
            <p className="text-white/60 text-sm leading-relaxed max-w-xs">
              A halal-friendly rental platform built for Canada&apos;s Muslim community. Find your home with trust.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-4 text-white/80">Platform</h4>
            <ul className="space-y-2.5">
              {[
                ['Browse listings', '/browse'],
                ['Post a rental', '/post'],
                ['Map view', '/map'],
                ['Messages', '/messages'],
              ].map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="text-white/60 hover:text-white text-sm transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-4 text-white/80">Legal</h4>
            <ul className="space-y-2.5">
              {[
                ['Terms of Service', '/terms'],
                ['Privacy Policy', '/privacy'],
                ['Content & Community Guidelines', '/community-guidelines'],
                ['Safety Guidelines', '/safety'],
                ['Contact Us', '/contact'],
              ].map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="text-white/60 hover:text-white text-sm transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-white/45 text-sm">© {new Date().getFullYear()} muslimrentals.ca. All rights reserved.</p>
          <p className="text-white/30 text-xs">Made for the Ummah</p>
        </div>
      </div>
    </footer>
  );
}
