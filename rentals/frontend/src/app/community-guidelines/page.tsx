import { Metadata } from 'next';
import Link from 'next/link';
import PolicyLayout, { PolicySection } from '@/components/legal/PolicyLayout';

export const metadata: Metadata = { title: 'Content & Community Guidelines' };

const sections: PolicySection[] = [
  {
    id: 'purpose',
    heading: 'Why these guidelines exist',
    body: (
      <p>
        Muslim Rentals only works if people can trust what they find here. These guidelines set out what's
        expected when you post a listing, message another user, or otherwise use the Platform. They work alongside
        our <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms of Service</Link>, which is the
        binding agreement — this page explains what that agreement means in practice.
      </p>
    ),
  },
  {
    id: 'listings-allowed',
    heading: 'What a listing should be',
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>A real property that's currently available and that you (or the person you're posting on behalf of) have the right to rent out.</li>
        <li>Described accurately — price, location, bedrooms/bathrooms, and amenities should match reality.</li>
        <li>Represented with photos of the actual unit, not stock photography or images of a different property.</li>
        <li>Clear about any community-fit preference (for example, sisters-only or family-friendly) as a genuine preference for the household, not as pretext for something the guidelines below prohibit.</li>
      </ul>
    ),
  },
  {
    id: 'listings-prohibited',
    heading: "What's not allowed",
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Fake or duplicate listings — posting a property that doesn't exist, isn't actually available, or that you don't have the right to rent, or posting the same listing many times.</li>
        <li>Upfront-payment requests before a genuine viewing — asking for a deposit, application fee, or e-transfer before the renter has viewed the unit (in person or by video) and you've agreed to a lease. This is the single most common rental scam pattern; see <Link href="/safety" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Safety Guidelines</Link>.</li>
        <li>Discrimination beyond a genuine community-fit preference — using a listing to exclude people on a legally protected ground unrelated to a genuine tenancy consideration.</li>
        <li>Harassment or abuse, through a listing, a message, or a public profile.</li>
        <li>Impersonation — claiming to be a landlord, agent, or owner you're not.</li>
        <li>Spam and off-topic solicitation — advertising anything other than a genuine rental.</li>
        <li>Unlawful or hateful content, or content that infringes someone else's copyright or other rights.</li>
      </ul>
    ),
  },
  {
    id: 'messaging-conduct',
    heading: 'Messaging conduct',
    body: (
      <p>
        Use messaging to ask genuine questions about a listing and arrange a viewing. Don't use it to harass,
        pressure, or scam another user, and don't ask someone to move a conversation off-platform before you've
        met or verified who you're dealing with — see <Link href="/safety" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Safety Guidelines</Link> for why that matters.
      </p>
    ),
  },
  {
    id: 'reporting',
    heading: 'Reporting a problem',
    body: (
      <>
        <p>
          Today, you can report a listing directly from its page using the flag icon — this sends it to our
          moderation queue for review. We're aware that reporting a specific message or user directly isn't yet a
          self-service feature; if you're experiencing harassment through messaging or need to report something
          that isn't a listing, contact us at{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>{' '}
          or via our <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link> with as
          much detail as you can (who, what happened, when).
        </p>
        <p>
          Reporting something you believe in good faith to be a genuine problem is welcome, even if we end up
          disagreeing after review. Repeatedly filing reports you know to be false, or reporting a listing as
          retaliation, is itself a violation of these guidelines.
        </p>
      </>
    ),
  },
  {
    id: 'moderation',
    heading: 'How we moderate',
    body: (
      <p>
        Reports are reviewed by a human before any listing is removed or any account is actioned. Depending on
        severity, we may remove a listing, warn an account, or suspend or ban it — see the Moderation section of
        our <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms</Link>. We try to be
        proportionate: a first, minor issue is treated differently from a clear scam or repeated abuse. Moderation
        decisions are made by the Platform operator and aren't guaranteed to be instant or to include a detailed
        explanation, though we'll tell you if your listing or account was actioned and roughly why.
      </p>
    ),
  },
];

export default function CommunityGuidelinesPage() {
  return (
    <PolicyLayout
      title="Content & Community Guidelines"
      effectiveDate="September 1, 2026"
      intro={
        <p>
          These guidelines explain what's and isn't allowed when posting a listing or messaging on Muslim Rentals,
          and how to report a problem.
        </p>
      }
      sections={sections}
    />
  );
}
