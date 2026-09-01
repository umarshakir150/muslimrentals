import Link from 'next/link';
import Navbar from '@/components/layout/Navbar';
import { cn } from '@/lib/utils';

export interface PolicySection {
  id: string;
  heading: string;
  body: React.ReactNode;
}

interface PolicyLayoutProps {
  title: string;
  effectiveDate: string;
  intro?: React.ReactNode;
  sections: PolicySection[];
}

const POLICY_PAGES = [
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Content & Community Guidelines', href: '/community-guidelines' },
  { label: 'Safety Guidelines', href: '/safety' },
  { label: 'Contact Us', href: '/contact' },
];

// Shared layout for every legal/policy page: plain numbered sections with a
// linked table of contents and consistent cross-navigation between the
// other policy pages, deliberately avoiding card grids/icon bullets so this
// reads as a document, not a marketing page.
export default function PolicyLayout({ title, effectiveDate, intro, sections }: PolicyLayoutProps) {
  return (
    <div className="min-h-dvh">
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <h1 className="font-serif text-3xl sm:text-4xl mb-2">{title}</h1>
          <p className="text-sm text-muted mb-8">Effective {effectiveDate}</p>

          {intro && <div className="text-sm text-ink/80 leading-relaxed mb-10 space-y-4">{intro}</div>}

          {sections.length > 3 && (
            <nav aria-label="Table of contents" className="mb-12 border border-ink/10 rounded-xl px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">On this page</p>
              <ol className="space-y-1.5">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="text-sm text-brand-700 hover:underline">
                      {i + 1}. {s.heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div>
            {sections.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                className={cn('scroll-mt-24', i > 0 && 'pt-8 mt-8 border-t border-ink/8')}
              >
                <h2 className="font-semibold text-lg mb-3">
                  {i + 1}. {s.heading}
                </h2>
                <div className="text-sm text-ink/80 leading-relaxed space-y-3">{s.body}</div>
              </section>
            ))}
          </div>

          <nav aria-label="Other policies" className="mt-16 pt-8 border-t border-ink/8">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Related policies</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {POLICY_PAGES.map(p => (
                <li key={p.href}>
                  <Link href={p.href} className="text-sm text-brand-700 hover:underline">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </main>
    </div>
  );
}
