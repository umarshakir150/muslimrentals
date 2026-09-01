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
    expect(container.textContent || '').toMatch(/delete (your|their) account/i);
  });
});

/**
 * The founder audited the first draft against a topic checklist and asked
 * for substantial expansion -- these guard the specific topics called out
 * as missing or under-covered (operator identity, platform role including
 * payment-processor, unauthorized account access, user-content licensing,
 * fees/payments, cross-border data storage, message-access disclosure) so
 * a future edit can't silently drop them back to one-line coverage.
 */
describe('Legal pages cover the topics from the founder\'s content-completeness audit', () => {
  it('Terms states the operator\'s legal identity plainly, as fact, without inventing one', () => {
    const text = render(<TermsPage />).container.textContent || '';
    expect(text).toMatch(/registered corporate legal/i);
    expect(text).toMatch(/\boperator\b/i);
    expect(text).not.toMatch(/Muslim Rentals Inc/i); // still not inventing one
  });

  it('Terms explicitly states Muslim Rentals is not a payment processor', () => {
    const text = render(<TermsPage />).container.textContent || '';
    expect(text).toMatch(/not\b[\s\S]{0,120}payment processor/i);
  });

  it('Terms covers unauthorized account access', () => {
    const text = render(<TermsPage />).container.textContent || '';
    expect(text).toMatch(/unauthorized access/i);
  });

  it('Terms has a dedicated user-content license section describing what it does and does not grant', () => {
    const text = render(<TermsPage />).container.textContent || '';
    expect(text).toMatch(/non-exclusive/i);
    expect(text).toMatch(/sale of user content/i);
  });

  it('Terms has a dedicated fees/payments section that does not invent current payment or refund rules', () => {
    const text = render(<TermsPage />).container.textContent || '';
    expect(text).toMatch(/free to use/i);
    expect(text).toMatch(/additional terms/i);
    expect(text).toMatch(/refund/i);
  });

  it('Terms covers what happens when a user disputes a moderation decision', () => {
    const text = render(<TermsPage />).container.textContent || '';
    expect(text).toMatch(/disputes a moderation decision/i);
  });

  it('Privacy discloses that data may be processed and stored outside Canada, including the US -- not Canada-only storage', () => {
    const text = render(<PrivacyPage />).container.textContent || '';
    expect(text).toMatch(/outside Canada/i);
    expect(text).toMatch(/United States/i);
    expect(text).not.toMatch(/stored (only |exclusively )?in Canada/i);
  });

  it('Privacy explicitly says messages are not end-to-end encrypted and states the circumstances access may occur', () => {
    const text = render(<PrivacyPage />).container.textContent || '';
    expect(text).toMatch(/not end-to-end encrypted/i);
    expect(text).toMatch(/investigating a report/i);
  });

  it('Privacy has a dedicated Security section describing conservative, non-absolute safeguards at a policy level (no implementation detail)', () => {
    const text = render(<PrivacyPage />).container.textContent || '';
    expect(text).toMatch(/guarantee complete security/i);
    // Policy-level disclosure, not an engineering walkthrough.
    expect(text).not.toMatch(/bcrypt/i);
    expect(text).not.toMatch(/JWT|JSON Web Token/i);
    expect(text).not.toMatch(/content security policy|CSP/i);
    expect(text).not.toMatch(/local ?storage/i);
  });

  it('Privacy states the operator\'s legal identity plainly, same as Terms', () => {
    const text = render(<PrivacyPage />).container.textContent || '';
    expect(text).toMatch(/registered corporate legal/i);
  });
});

/**
 * The founder's second review round flagged AI-style meta-commentary
 * throughout the first expansion: sentences explaining *why* something was
 * written a certain way, narrating drafting decisions, or editorializing
 * about the document's own honesty, rather than just stating the rule or
 * fact. These guard against that pattern coming back.
 */
describe('Legal pages use a neutral policy voice, not drafting/meta-commentary', () => {
  const metaPhrases = [
    /stating (that |it )?plainly/i,
    /rather than invent/i,
    /we'd rather (say|tell)/i,
    /want to be honest/i,
    /not going to claim/i,
    /can't resolve (this|it) on its own/i,
    /this is a placeholder/i,
    /worth being aware of/i,
    /make (this|it) (document )?look more finished/i,
    /we're aware that/i,
  ];

  it.each(pages)('%s page contains no drafting/meta-commentary phrases', (_name, Page) => {
    const text = render(<Page />).container.textContent || '';
    for (const phrase of metaPhrases) {
      expect(text).not.toMatch(phrase);
    }
  });
});
