import { Metadata } from 'next';
import Link from 'next/link';
import PolicyLayout, { PolicySection } from '@/components/legal/PolicyLayout';

export const metadata: Metadata = { title: 'Safety Guidelines' };

const sections: PolicySection[] = [
  {
    id: 'verify',
    heading: 'Verify before you commit',
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>View a property in person, or by video call, before sending any money or signing anything.</li>
        <li>Search the address online to confirm it matches what's advertised.</li>
        <li>A legitimate landlord won't pressure you to transfer money immediately or skip a viewing.</li>
        <li>If a price or a deal seems too good to be true for the area, treat it as a warning sign, not luck.</li>
      </ul>
    ),
  },
  {
    id: 'financial',
    heading: 'Financial safety',
    body: (
      <>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Never send an e-transfer, gift cards, or a wire transfer before you've viewed the unit and signed a lease.</li>
          <li>Keep a written lease agreement signed by both parties — don't rely on a verbal or messaged agreement alone.</li>
          <li>Use the Platform's messaging to keep a record of your conversation with the landlord.</li>
        </ul>
        <p>
          Rules on how much a landlord can ask for as a deposit vary by province — for example, Ontario limits a
          rent deposit to one rental period's rent (commonly one month), while other provinces have different
          rules. Check your province's tenancy legislation or tenant board for the rule that applies to you; this
          isn't legal advice.
        </p>
      </>
    ),
  },
  {
    id: 'meeting',
    heading: 'Meeting safely',
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Bring a trusted friend or family member to in-person viewings, especially the first one.</li>
        <li>Meet during daylight hours where possible.</li>
        <li>Tell someone where you're going and when you expect to be back.</li>
        <li>Trust your instincts — if something feels wrong, you can leave.</li>
      </ul>
    ),
  },
  {
    id: 'online',
    heading: 'Online safety',
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Don't share your home address, SIN, or banking information with someone you haven't verified.</li>
        <li>Use the Platform's built-in messaging rather than sharing your personal phone number immediately.</li>
        <li>If a listing looks suspicious, report it using the flag icon on the listing.</li>
      </ul>
    ),
  },
  {
    id: 'community',
    heading: 'Community expectations',
    body: (
      <p>
        Muslim Rentals is built around community and lifestyle fit — listings may note a preferred audience (for
        example, sisters-only or family-friendly). Respect the preference a landlord has listed, and expect the
        same in return. See our <Link href="/community-guidelines" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Content &amp; Community Guidelines</Link> for the full standard we hold listings and messages to, and how to report one that falls short.
      </p>
    ),
  },
];

export default function SafetyPage() {
  return (
    <PolicyLayout
      title="Staying safe on Muslim Rentals"
      effectiveDate="September 1, 2026"
      intro={
        <p>
          The overwhelming majority of listings and users here are genuine, but rental scams are common across
          every platform — not specific to us. These guidelines cover the patterns to watch for and how to protect
          yourself.
        </p>
      }
      sections={sections}
    />
  );
}
