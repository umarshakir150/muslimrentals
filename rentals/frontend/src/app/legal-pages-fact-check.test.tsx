import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import TermsPage from './terms/page';
import PrivacyPage from './privacy/page';
import CommunityGuidelinesPage from './community-guidelines/page';
import SafetyPage from './safety/page';

/**
 * Regression guard for the legal/policy pages overhaul: these pages
 * previously invented facts not backed by the actual product or company
 * (a legal entity name and city that appear nowhere else in the codebase,
 * an unqualified "PIPEDA compliant" claim, specific data-retention day/
 * month counts with no retention job behind them, a citation to the wrong
 * human-rights statute, and phantom listing fees on a free platform). This
 * doesn't re-verify every fact -- that requires re-reading the product --
 * but it stops the specific fabrications already found from silently
 * coming back in a future edit.
 */

vi.mock('@/components/layout/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));

const pages: [string, () => JSX.Element][] = [
  ['Terms', TermsPage],
  ['Privacy', PrivacyPage],
  ['Community Guidelines', CommunityGuidelinesPage],
  ['Safety', SafetyPage],
];

describe('Legal pages do not reintroduce known fabricated claims', () => {
  it.each(pages)('%s page has no invented legal-entity name or address', (_name, Page) => {
    const { container } = render(<Page />);
    const text = container.textContent || '';
    expect(text).not.toMatch(/Muslim Rentals Inc/i);
    expect(text).not.toMatch(/Toronto,? Ontario/i);
  });

  it.each(pages)('%s page does not assert unqualified PIPEDA "compliance"', (_name, Page) => {
    const { container } = render(<Page />);
    const text = container.textContent || '';
    // Mentioning PIPEDA as the applicable law is fine; claiming to *be*
    // compliant is a legal conclusion this product has not had reviewed.
    expect(text).not.toMatch(/compliant with pipeda/i);
    expect(text).not.toMatch(/pipeda.compliant/i);
  });

  it('Privacy page does not invent specific data-retention day/month counts with no retention job behind them', () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent || '';
    expect(text).not.toMatch(/retained for 12 months/i);
    expect(text).not.toMatch(/retained for 24 months/i);
    expect(text).not.toMatch(/deleted within 30 days/i);
  });

  it('Privacy page does not claim messages are encrypted at rest (no app-level message encryption exists)', () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent || '').not.toMatch(/messages are encrypted at rest/i);
  });

  it('Terms page does not cite the Canadian Human Rights Act for housing discrimination (that\'s provincial jurisdiction, not federal)', () => {
    const { container } = render(<TermsPage />);
    expect(container.textContent || '').not.toMatch(/Canadian Human Rights Act/i);
  });

  it('Terms page does not describe listing fees (the platform is free, no such fees exist)', () => {
    const { container } = render(<TermsPage />);
    const text = container.textContent || '';
    expect(text).not.toMatch(/listing fees.*non-refundable/i);
    expect(text).toMatch(/free to use/i);
  });

  it('Safety page does not assert Ontario\'s deposit rule as a flat, unqualified, Canada-wide fact', () => {
    const { container } = render(<SafetyPage />);
    const text = container.textContent || '';
    // The old copy stated it as a blanket rule ("Ontario's maximum is one
    // month's rent") with no acknowledgement that other provinces differ.
    expect(text).toMatch(/vary by province/i);
  });

  it('Privacy page accurately reflects that account deletion now exists (Settings), not the old "not implemented" gap', () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent || '').toMatch(/delete your account/i);
  });
});
