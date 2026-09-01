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

// Shared layout for every legal/policy page. Deliberately plain: a wide,
// mostly-black-on-white text column, numbered headings with no color or
// background treatment, a bare linked table of contents, and a bare
// cross-navigation list -- no cards, icons, or decorative color, so this
// reads as an ordinary document rather than a marketing page.
export default function PolicyLayout({ title, effectiveDate, intro, sections }: PolicyLayoutProps) {
  return (
    <div className="min-h-dvh bg-white">
      <Navbar />
      <main className="pt-[72px]">
        <div className="max-w-[860px] mx-auto px-6 sm:px-10 py-14">
          <h1 className="text-[28px] sm:text-3xl font-serif font-normal text-ink mb-1">{title}</h1>
          <p className="text-sm text-muted mb-9">Effective {effectiveDate}</p>

          {intro && <div className="text-[15px] text-ink/85 leading-[1.65] mb-10 space-y-4">{intro}</div>}

          {sections.length > 3 && (
            <nav aria-label="Table of contents" className="mb-12 pb-9 border-b border-ink/15">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Contents</p>
              <ol className="space-y-1">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="text-[15px] text-ink/80 hover:text-ink hover:underline">
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
                className={cn('scroll-mt-24', i > 0 && 'pt-8 mt-8 border-t border-ink/12')}
              >
                <h2 className="text-lg sm:text-[19px] font-serif font-normal text-ink mb-3">
                  {i + 1}. {s.heading}
                </h2>
                <div className="text-[15px] text-ink/85 leading-[1.65] space-y-4">{s.body}</div>
              </section>
            ))}
          </div>

          <nav aria-label="Other policies" className="mt-16 pt-8 border-t border-ink/15">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Related policies</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {POLICY_PAGES.map(p => (
                <li key={p.href}>
                  <Link href={p.href} className="text-[15px] text-ink/80 hover:text-ink hover:underline">
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
