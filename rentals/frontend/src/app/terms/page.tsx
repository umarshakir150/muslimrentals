import { Metadata } from 'next';
import Link from 'next/link';
import PolicyLayout, { PolicySection } from '@/components/legal/PolicyLayout';

export const metadata: Metadata = { title: 'Terms of Service' };

const sections: PolicySection[] = [
  {
    id: 'acceptance',
    heading: 'Acceptance of these Terms',
    body: (
      <>
        <p>
          These Terms of Service ("Terms") govern your use of Muslim Rentals (the "Platform"), accessible at
          muslimrentals.ca. By creating an account or otherwise using the Platform, you agree to these Terms. If
          you do not agree, do not use the Platform.
        </p>
        <p>
          We may update these Terms from time to time; see the{' '}
          <a href="#changes" className="text-brand-700 hover:underline">Changes section</a> below. Continued use
          of the Platform after an update means you accept the revised Terms.
        </p>
      </>
    ),
  },
  {
    id: 'platform-role',
    heading: 'What the Platform is — and is not',
    body: (
      <>
        <p>
          Muslim Rentals is a listing and messaging platform that helps people in Canada's Muslim community find
          and post rental housing that fits their community and lifestyle preferences. We are a technology
          intermediary only.
        </p>
        <p>
          We are <strong>not</strong> a landlord, tenant, broker, or party to any lease or rental agreement made
          between users. We do not inspect properties, verify a poster's identity or ownership of a property, run
          background or credit checks, or hold funds or deposits on anyone's behalf. Any agreement you enter into
          with another user is solely between you and that user, and is governed by the landlord-tenant laws of
          your province.
        </p>
        <p>The Platform is currently free to use — we do not charge listing fees or subscription fees.</p>
      </>
    ),
  },
  {
    id: 'accounts',
    heading: 'Accounts and eligibility',
    body: (
      <>
        <p>You must be at least 18 years old to create an account. You may sign up with an email and password or with Google sign-in.</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>You're responsible for the accuracy of the information on your account and for keeping your login credentials secure.</li>
          <li>One account per person. Don't create multiple accounts to evade a ban, a report, or a rate limit.</li>
          <li>You're responsible for activity that happens under your account, whether or not you personally performed it.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'listings',
    heading: 'Posting a listing',
    body: (
      <>
        <p>
          Listings must be for a real, currently available property that you have the right to rent or sublet.
          You're responsible for the accuracy of your listing's details (price, location, availability, amenities,
          photos, and any contact information you choose to include).
        </p>
        <p>
          Some listings let you note a preferred audience for the unit (for example, sisters-only, brothers-only,
          couples, or families). This is meant as a self-identified community-fit preference to help people find a
          living situation that suits them — not as a blanket exclusion. You're responsible for making sure your
          own listing and how you apply that preference comply with the human rights and tenancy laws of your
          province; we don't provide legal advice on how those laws apply to your specific listing.
        </p>
        <p>
          We may remove a listing that violates these Terms or our{' '}
          <Link href="/community-guidelines" className="text-brand-700 hover:underline">Content &amp; Community Guidelines</Link>,
          or that we reasonably believe is fraudulent, without prior notice.
        </p>
      </>
    ),
  },
  {
    id: 'conduct',
    heading: 'Prohibited conduct',
    body: (
      <>
        <p>You agree not to, and not to help anyone else:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Post a fraudulent, misleading, or deceptive listing, or a listing for a property you don't have the right to rent.</li>
          <li>Ask for a deposit, e-transfer, or other payment before a genuine viewing or lease agreement, or otherwise attempt to defraud another user.</li>
          <li>Harass, threaten, or discriminate against another user in violation of applicable human rights law.</li>
          <li>Impersonate another person, landlord, or agent.</li>
          <li>Post spam, unsolicited advertising, or content unrelated to renting housing.</li>
          <li>Scrape, systematically collect, or resell data from the Platform, or attempt to bypass rate limits, bans, or other access controls.</li>
          <li>Upload content that's unlawful, hateful, or that infringes someone else's rights (including copyright).</li>
        </ul>
        <p>See our <Link href="/community-guidelines" className="text-brand-700 hover:underline">Content &amp; Community Guidelines</Link> for more detail on what's and isn't allowed, and how to report a problem.</p>
      </>
    ),
  },
  {
    id: 'messaging',
    heading: 'Messaging',
    body: (
      <>
        <p>
          The in-app messaging feature is provided to help you communicate about a specific listing. Don't share
          sensitive financial information (banking details, full ID numbers, etc.) through it or any other channel
          before you've verified who you're dealing with — see our{' '}
          <Link href="/safety" className="text-brand-700 hover:underline">Safety Guidelines</Link>.
        </p>
        <p>
          Messages are stored so your conversation history is available to you and the other participant. We don't
          currently offer a dedicated tool for reviewing message content, but as with any data stored on the
          Platform, we may access it where necessary to investigate a report, enforce these Terms, or comply with
          a legal obligation. See our <Link href="/privacy" className="text-brand-700 hover:underline">Privacy Policy</Link> for more.
        </p>
      </>
    ),
  },
  {
    id: 'moderation',
    heading: 'Moderation, suspension, and termination',
    body: (
      <>
        <p>
          We may remove content, or suspend or ban an account, that we reasonably believe violates these Terms or
          our Content &amp; Community Guidelines. Where practical we'll try to be proportionate, but some
          violations (fraud, harassment, clearly illegal content) may result in an immediate ban without warning.
        </p>
        <p>
          You may delete your own account at any time from your account settings. When you do, your listings are
          taken down and your profile is deactivated and anonymized; see our{' '}
          <Link href="/privacy" className="text-brand-700 hover:underline">Privacy Policy</Link> for exactly what
          that means. Account deletion is irreversible.
        </p>
      </>
    ),
  },
  {
    id: 'ip',
    heading: 'Intellectual property',
    body: (
      <>
        <p>
          The Platform's design, code, and branding belong to us or our licensors. You keep ownership of the
          content you post (listing descriptions, photos, messages), but by posting it you give us a
          non-exclusive, royalty-free license to host, display, and distribute it as part of operating the
          Platform — for example, showing your listing photos to other users.
        </p>
      </>
    ),
  },
  {
    id: 'disclaimers',
    heading: 'Disclaimers and limitation of liability',
    body: (
      <>
        <p>
          The Platform is provided "as is." We don't guarantee that any listing is accurate, available, or posted
          by a legitimate landlord, and we don't verify user identities or property ownership. You're responsible
          for exercising your own judgment and due diligence — see our{' '}
          <Link href="/safety" className="text-brand-700 hover:underline">Safety Guidelines</Link> — including
          before sending any money or signing any agreement.
        </p>
        <p>
          To the fullest extent permitted by law, we are not liable for losses arising from your use of the
          Platform, including losses from a scam, a misleading listing, or a dispute with another user. Nothing in
          these Terms limits any liability that can't be limited under applicable Canadian consumer-protection law.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to the Platform or these Terms',
    body: (
      <p>
        We may change or discontinue features of the Platform, and may update these Terms, at any time. We'll
        update the "Effective" date above when we do. If a change is significant, we'll try to give you reasonable
        notice, for example through the Platform or by email.
      </p>
    ),
  },
  {
    id: 'contact-governing',
    heading: 'Contact and governing law',
    body: (
      <>
        <p>
          Questions about these Terms can be sent to{' '}
          <a href="mailto:support@muslimrentals.ca" className="text-brand-700 hover:underline">support@muslimrentals.ca</a>{' '}
          or via our <Link href="/contact" className="text-brand-700 hover:underline">Contact page</Link>.
        </p>
        <p className="text-muted italic">
          Governing law and venue for disputes will be specified here once finalized. This is a placeholder pending
          a decision by the Platform operator, not a gap you should assume is resolved in your favor or ours.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <PolicyLayout
      title="Terms of Service"
      effectiveDate="September 1, 2026"
      intro={
        <p>
          Please read these Terms carefully. They explain what Muslim Rentals is (and isn't), what you can and
          can't do here, and how disputes and account issues are handled.
        </p>
      }
      sections={sections}
    />
  );
}
