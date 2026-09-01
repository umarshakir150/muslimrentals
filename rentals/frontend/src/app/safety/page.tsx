import { Metadata } from 'next';
import Link from 'next/link';
import PolicyLayout, { PolicySection } from '@/components/legal/PolicyLayout';

export const metadata: Metadata = { title: 'Safety Guidelines' };

const sections: PolicySection[] = [
  {
    id: 'verify',
    heading: 'Verification',
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>View a property in person, or by video call, before providing payment or signing an agreement.</li>
        <li>Confirm that the listed address matches the advertised property.</li>
        <li>Be cautious of listings priced substantially below comparable rentals in the area.</li>
        <li>A legitimate landlord will not require immediate payment or waive a viewing.</li>
      </ul>
    ),
  },
  {
    id: 'financial',
    heading: 'Financial precautions',
    body: (
      <>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Do not send an e-transfer, gift card, or wire transfer before viewing a property and signing a lease.</li>
          <li>Obtain a written lease agreement signed by both parties.</li>
          <li>Use the Platform's messaging feature to maintain a record of communication with the landlord.</li>
        </ul>
        <p>
          Deposit limits vary by province. Ontario limits a rent deposit to one rental period, commonly one
          month. Users should consult their provincial tenancy legislation or tenant board for applicable rules.
        </p>
      </>
    ),
  },
  {
    id: 'meeting',
    heading: 'In-person meetings',
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Bring another person to in-person viewings where possible, particularly an initial viewing.</li>
        <li>Schedule viewings during daylight hours where possible.</li>
        <li>Inform another person of the viewing location and expected return time.</li>
      </ul>
    ),
  },
  {
    id: 'online',
    heading: 'Online safety',
    body: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Do not share a home address, Social Insurance Number, or banking information with an unverified party.</li>
        <li>Use the Platform's messaging feature rather than sharing a personal phone number.</li>
        <li>Report suspicious listings using the flag icon on the listing.</li>
      </ul>
    ),
  },
  {
    id: 'community',
    heading: 'Community standards',
    body: (
      <p>
        Listings may indicate a preferred audience, such as sisters-only or family-friendly households. Users are
        expected to respect stated preferences. See the{' '}
        <Link href="/community-guidelines" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Content &amp; Community Guidelines</Link>{' '}
        for applicable standards and reporting procedures.
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
          The following guidelines are intended to help users identify and avoid common rental scams and protect
          their personal safety when using the Platform.
        </p>
      }
      sections={sections}
    />
  );
}
