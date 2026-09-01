import { Metadata } from 'next';
import Link from 'next/link';
import PolicyLayout, { PolicySection } from '@/components/legal/PolicyLayout';

export const metadata: Metadata = { title: 'Content & Community Guidelines' };

const sections: PolicySection[] = [
  {
    id: 'purpose',
    heading: 'Purpose',
    body: (
      <p>
        These guidelines describe the standards for listings, messages, and conduct on Muslim Rentals. They
        supplement and should be read together with the{' '}
        <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms of Service</Link>, which is the
        governing agreement.
      </p>
    ),
  },
  {
    id: 'listings-allowed',
    heading: 'Listing standards',
    body: (
      <p>
        A listing must describe a real, currently available property that the poster has the right to rent.
        Listing details, including price, location, bedroom and bathroom counts, and amenities, must accurately
        reflect the property. Listing photographs must depict the actual unit. A stated audience preference, such
        as sisters-only or family-friendly, must reflect a genuine preference for the household.
      </p>
    ),
  },
  {
    id: 'listings-prohibited',
    heading: 'Prohibited conduct',
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Fake or duplicate listings, including listings for properties that do not exist, are unavailable, or that the poster does not have the right to rent.</li>
        <li>Requests for a deposit, application fee, or other payment before a viewing and signed lease. See <Link href="/safety" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Safety Guidelines</Link>.</li>
        <li>Discrimination on a legally protected ground unrelated to a genuine tenancy consideration.</li>
        <li>Harassment or abuse directed at another user, through a listing, a message, or a profile.</li>
        <li>Impersonation of a landlord, agent, or property owner.</li>
        <li>Spam or solicitation unrelated to rental housing.</li>
        <li>Unlawful or hateful content, or content that infringes another party's copyright or other rights.</li>
      </ul>
    ),
  },
  {
    id: 'messaging-conduct',
    heading: 'Messaging conduct',
    body: (
      <p>
        Messaging must be used for genuine communication about a listing. Harassment, pressure, solicitation
        unrelated to a listing, and requests to move a conversation off-platform before identity has been
        verified are prohibited. See <Link href="/safety" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Safety Guidelines</Link>.
      </p>
    ),
  },
  {
    id: 'reporting',
    heading: 'Reporting',
    body: (
      <>
        <p>
          A listing may be reported directly from its page. Other concerns, including harassment through
          messaging, may be reported to{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>{' '}
          or through the <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>.
        </p>
        <p>Filing a false report, or reporting a listing in retaliation, is prohibited.</p>
      </>
    ),
  },
  {
    id: 'moderation',
    heading: 'Moderation',
    body: (
      <p>
        Reports are reviewed prior to any content removal or account action. Muslim Rentals may remove a listing,
        restrict account features, or suspend or terminate an account depending on the nature and severity of a
        violation. See Reporting, Moderation, and Account Actions in the{' '}
        <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms of Service</Link>.
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
          These guidelines set out the standards for listings, messages, and conduct expected of all users of
          the Platform.
        </p>
      }
      sections={sections}
    />
  );
}
