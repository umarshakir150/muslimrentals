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
          These Terms of Service ("Terms") govern access to and use of Muslim Rentals (the "Platform"), available
          at muslimrentals.ca. By creating an account, browsing listings, posting a listing, sending a message, or
          otherwise using the Platform, users agree to these Terms. Individuals who do not agree to these Terms
          may not use the Platform.
        </p>
        <p>
          These Terms incorporate by reference the{' '}
          <Link href="/privacy" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Privacy Policy</Link> and the{' '}
          <Link href="/community-guidelines" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Content &amp; Community Guidelines</Link>.
          Where a rule about conduct or content is described in general terms in these Terms, the Content &amp;
          Community Guidelines provide additional detail and examples. In the event of a conflict, these Terms
          govern.
        </p>
        <p>
          Muslim Rentals may update these Terms from time to time. Updates take effect on the date shown at the
          top of this page. Continued use of the Platform after an update takes effect constitutes acceptance of
          the revised Terms.
        </p>
      </>
    ),
  },
  {
    id: 'operator',
    heading: 'Operator and contact',
    body: (
      <p>
        Muslim Rentals is currently operated without a separate registered corporate legal entity. Inquiries
        relating to these Terms, an account, a listing, or a safety concern may be directed to{' '}
        <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>{' '}
        or through the <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>.
      </p>
    ),
  },
  {
    id: 'platform-role',
    heading: 'Platform role',
    body: (
      <>
        <p>
          Muslim Rentals is a listing and messaging platform that enables users to post and browse rental housing
          listings and to communicate with one another about specific listings.
        </p>
        <p>
          Muslim Rentals does not inspect listed properties, verify ownership or the right to rent a property,
          conduct credit or background checks, draft or review lease agreements, or collect or hold rent,
          deposits, or other funds on behalf of any user. Muslim Rentals is not a landlord, tenant, real estate
          broker, property manager, rental agent, or payment processor, and is not a party to any lease or rental
          agreement formed between users.
        </p>
        <p>
          A rental agreement formed between users is governed by the landlord-tenant legislation of the
          applicable province or territory. Disputes concerning a tenancy, including rent, condition of a unit,
          damage, notice, or eviction, are matters between the parties involved and, where applicable, the
          relevant provincial landlord-tenant board.
        </p>
        <p>The Platform is currently free to use. See Fees and Payments below.</p>
      </>
    ),
  },
  {
    id: 'accounts',
    heading: 'Accounts, eligibility, and account security',
    body: (
      <>
        <p>
          Users must be at least 18 years of age to create an account. An account may be created using an email
          address and password, or through Google sign-in. Account information must be accurate and kept up to
          date. Impersonation, and the use of information a user is not entitled to use, are prohibited.
        </p>
        <p>
          Users are responsible for maintaining the confidentiality of their password and for all activity
          occurring under their account. A user who suspects unauthorized access to their account should change
          their password immediately, if able to sign in, and contact{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>.
        </p>
        <p>
          Each individual may hold one account. Creating additional accounts to circumvent a ban, rate limit, or
          pending report is prohibited and may result in suspension of all associated accounts.
        </p>
        <p>
          Users may close their account at any time through account settings. See the{' '}
          <Link href="/privacy" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Privacy Policy</Link> for
          information on account deletion. Muslim Rentals may also suspend or close an account under Reporting,
          Moderation, and Account Actions below.
        </p>
      </>
    ),
  },
  {
    id: 'listings',
    heading: 'Listings and marketplace conduct',
    body: (
      <>
        <p>
          A listing must describe a real, currently available property that the poster has the right to rent or
          sublet. Posters are responsible for the accuracy of all listing details, including price, location,
          availability, bedroom and bathroom counts, amenities, photographs, and any contact information
          provided. A listing for a property that does not exist, is no longer available, or that the poster does
          not have the right to rent is a fraudulent listing and is prohibited.
        </p>
        <p>
          Requesting a deposit, e-transfer, or other payment before a genuine viewing and signed lease is
          prohibited. Impersonating a landlord, property manager, or agent is prohibited. Posting duplicate
          listings to increase visibility is prohibited.
        </p>
        <p>
          Some listings indicate a preferred audience for the unit, such as a preference for sisters-only,
          brothers-only, couples, or family households. Posters are responsible for ensuring their listings, and
          the application of any stated preference, comply with the human rights and tenancy legislation
          applicable in their province.
        </p>
        <p>
          Users may not use a listing, profile, or message to harass or threaten another user; post hateful,
          sexually explicit, or otherwise unlawful content; advertise goods or services unrelated to rental
          housing; infringe another party's copyright or other rights; scrape or systematically collect data from
          the Platform; or attempt to bypass a rate limit, ban, or other access control. This list is illustrative
          and not exhaustive; see the{' '}
          <Link href="/community-guidelines" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Content &amp; Community Guidelines</Link>{' '}
          for additional detail.
        </p>
        <p>
          Muslim Rentals may remove a listing that violates these Terms or the Content &amp; Community Guidelines,
          or that is reasonably believed to be fraudulent, without prior notice.
        </p>
      </>
    ),
  },
  {
    id: 'messaging',
    heading: 'Messaging',
    body: (
      <>
        <p>
          The messaging feature is provided to facilitate communication about specific listings. Messaging may
          not be used to harass or threaten another user, to send unsolicited commercial messages, or as part of
          a scam, including a request for payment or an attempt to move a conversation off-platform before
          identity has been verified.
        </p>
        <p>
          Users should not share sensitive financial or identification information through messaging or any other
          channel before verifying the other party. See{' '}
          <Link href="/safety" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Safety Guidelines</Link>.
        </p>
        <p>
          Messages are stored to maintain a conversation history for the participants. See the{' '}
          <Link href="/privacy" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Privacy Policy</Link> for
          information on message storage and access.
        </p>
      </>
    ),
  },
  {
    id: 'user-content',
    heading: 'User content and license',
    body: (
      <>
        <p>
          Users retain ownership of content they submit to the Platform, including listing descriptions,
          photographs, profile information, and messages. Users are responsible for ensuring they hold the
          rights necessary to submit any content and for ensuring that content does not infringe the rights of
          any third party.
        </p>
        <p>
          By submitting content, a user grants Muslim Rentals a non-exclusive, royalty-free license to host,
          store, display, and distribute that content as necessary to operate the Platform, including displaying
          listing photographs to visitors and displaying messages to conversation participants. This license does
          not permit the sale of user content or its use for advertising outside the Platform. When a user
          deletes a listing or account, associated content is removed from public display, subject to the
          retention practices described in the Privacy Policy.
        </p>
        <p>
          The Platform's design, code, and branding, as distinct from user-submitted content, remain the property
          of Muslim Rentals or its licensors.
        </p>
      </>
    ),
  },
  {
    id: 'moderation',
    heading: 'Reporting, moderation, and account actions',
    body: (
      <>
        <p>
          A listing may be reported directly from its page. Other concerns, including conduct or messages, may be
          reported to <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>{' '}
          or through the <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>.
        </p>
        <p>
          Reports are reviewed prior to any listing removal or account action. Depending on the nature and
          severity of a violation, Muslim Rentals may remove content, restrict account features, suspend an
          account, or terminate an account. A clear violation, including fraud, harassment, or unlawful content,
          may result in immediate action without prior notice.
        </p>
        <p>
          A user who disputes a moderation decision may contact{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a> for
          reconsideration.
        </p>
        <p>
          Filing a report in good faith is permitted even where Muslim Rentals reaches a different conclusion
          after review. Filing a false report, or using the reporting process to retaliate against another user,
          is prohibited and may itself result in account action.
        </p>
      </>
    ),
  },
  {
    id: 'fees',
    heading: 'Fees and payments',
    body: (
      <p>
        Muslim Rentals is currently free to use. No fee is charged to create an account, post a listing, browse,
        or send messages, and Muslim Rentals does not process rent, deposits, or other payments between users.
        Any future paid feature or payment-processing capability will be governed by additional terms describing
        applicable pricing, billing, and refund provisions.
      </p>
    ),
  },
  {
    id: 'responsibility',
    heading: 'User responsibility for rental decisions',
    body: (
      <p>
        Decisions to view a property, communicate with another user, enter into a lease, or otherwise engage in a
        rental transaction are the sole responsibility of the user. Muslim Rentals does not verify listings or
        users prior to publication, and the presence of a listing on the Platform does not constitute an
        endorsement. See{' '}
        <Link href="/safety" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Safety Guidelines</Link>.
      </p>
    ),
  },
  {
    id: 'disclaimers',
    heading: 'Disclaimers and limitation of liability',
    body: (
      <>
        <p>
          The Platform is provided on an "as is" and "as available" basis, without warranty as to the accuracy or
          availability of any listing or the legitimacy of any user. To the fullest extent permitted by law,
          Muslim Rentals is not liable for loss or damage arising from use of the Platform, including losses
          connected to a fraudulent or inaccurate listing, a scam involving another user, or a dispute arising
          from a rental agreement between users.
        </p>
        <p>
          Nothing in these Terms limits or excludes any right or protection under applicable Canadian consumer
          protection legislation that cannot lawfully be waived by agreement.
        </p>
      </>
    ),
  },
  {
    id: 'governing-law',
    heading: 'Governing law',
    body: <p>Governing law and venue for these Terms will be specified in a future update.</p>,
  },
  {
    id: 'changes',
    heading: 'Changes to the Platform or these Terms',
    body: (
      <p>
        Muslim Rentals may modify or discontinue Platform features and update these Terms at any time. Material
        changes are identified by an updated effective date. Users will be notified through the Platform, or by
        email, where a change meaningfully affects user rights.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <p>
        Questions regarding these Terms may be directed to{' '}
        <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>{' '}
        or through the <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>.
      </p>
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
          These Terms of Service set out the rules governing use of the Muslim Rentals platform, including
          account eligibility, listing and conduct standards, content ownership, moderation, and limitations of
          liability.
        </p>
      }
      sections={sections}
    />
  );
}
