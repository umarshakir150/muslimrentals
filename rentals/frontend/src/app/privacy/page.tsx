import { Metadata } from 'next';
import Link from 'next/link';
import PolicyLayout, { PolicySection } from '@/components/legal/PolicyLayout';

export const metadata: Metadata = { title: 'Privacy Policy' };

const sections: PolicySection[] = [
  {
    id: 'who',
    heading: 'Responsibility and contact',
    body: (
      <p>
        Muslim Rentals is currently operated without a separate registered corporate legal entity. The operator
        of the Platform is responsible for the personal information described in this policy. Privacy-related
        questions, concerns, and requests may be directed to{' '}
        <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>.
      </p>
    ),
  },
  {
    id: 'collect',
    heading: 'Information collected',
    body: (
      <>
        <p>Muslim Rentals collects the following categories of information:</p>
        <p>
          <em>Account information.</em> Name, email address, and password, stored in hashed form, or, for Google
          sign-in, the profile information shared by Google. Phone number, a short biography, and a profile
          photograph are optional.
        </p>
        <p>
          <em>Sign-in information.</em> Information generated when a user signs in, used to keep the account
          signed in and secure.
        </p>
        <p>
          <em>Listing information.</em> Property description, price, location, amenities, photographs, and any
          contact information included in a listing.
        </p>
        <p>
          <em>Messages.</em> The content of messages sent through the Platform's messaging feature, and related
          metadata such as timestamps and read status.
        </p>
        <p>
          <em>Saved listings.</em> Listings a user has saved for later reference.
        </p>
        <p>
          <em>Reports.</em> Information submitted when reporting a listing, including the reason and any
          description provided.
        </p>
        <p>
          <em>Technical information.</em> Standard request logs, including IP address, browser information, and
          timestamps, generated through use of the Platform.
        </p>
        <p>Muslim Rentals does not use advertising or analytics tracking and does not purchase personal information about users from third parties.</p>
      </>
    ),
  },
  {
    id: 'purposes',
    heading: 'Purposes',
    body: (
      <p>
        Information is used to create and secure accounts; to display and manage listings; to enable messaging
        between users; to review and act on reports of violations of the{' '}
        <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms of Service</Link> or{' '}
        <Link href="/community-guidelines" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Content &amp; Community Guidelines</Link>;
        to maintain the security of the Platform, including detecting and preventing abuse; to respond to support
        inquiries; and to comply with applicable legal obligations.
      </p>
    ),
  },
  {
    id: 'visibility',
    heading: 'Public and private information',
    body: (
      <>
        <p>
          A user's display name and profile photograph are visible on their listings and to other participants
          in a conversation. Listing details, including description, price, location, photographs, and any
          contact information included by the poster, are visible to all visitors to the Platform, including
          those who are not signed in.
        </p>
        <p>
          Email address, phone number, password, saved listings, message content, and report history are not
          visible to other users.
        </p>
      </>
    ),
  },
  {
    id: 'messages-privacy',
    heading: 'Private messages',
    body: (
      <p>
        Messages sent through the Platform are stored to provide conversation history to the participants.
        Messages are not end-to-end encrypted. Message content may be accessed by Muslim Rentals for the purposes
        of investigating a report, responding to a support request, addressing a security concern, or complying
        with a legal obligation.
      </p>
    ),
  },
  {
    id: 'providers',
    heading: 'Providers and sharing',
    body: (
      <>
        <p>
          Muslim Rentals uses third-party providers to operate the Platform, including cloud hosting and database
          providers, Cloudflare R2 for file storage, Google for optional sign-in, and an email service provider
          for account-related email. These providers process information solely as necessary to provide their
          services to Muslim Rentals and are subject to their own privacy terms.
        </p>
        <p>
          Muslim Rentals does not sell or rent personal information. Information may be disclosed as necessary to
          operate the Platform, to comply with a legal obligation, to investigate a security or abuse issue, or
          in connection with a sale, merger, or other transfer of the Platform's business, in which case this
          policy will continue to apply under the new operator unless users are notified otherwise.
        </p>
      </>
    ),
  },
  {
    id: 'international',
    heading: 'International processing',
    body: (
      <p>
        Hosting, database, and storage providers used by the Platform operate infrastructure located outside
        Canada, including in the United States. Personal information may accordingly be processed and stored
        outside Canada and may be subject to the laws of the jurisdiction in which it is located.
      </p>
    ),
  },
  {
    id: 'cookies',
    heading: 'Cookies and session storage',
    body: (
      <p>
        Muslim Rentals uses one functional cookie required to maintain a signed-in session. This cookie is not
        used for advertising or cross-site tracking. Session credentials necessary to operate the Platform are
        also stored locally in the user's browser. Muslim Rentals does not use analytics or advertising cookies
        or other tracking technologies.
      </p>
    ),
  },
  {
    id: 'retention',
    heading: 'Retention and deletion',
    body: (
      <>
        <p>
          Account, listing, and message information is retained while an account is active or as necessary to
          operate the Platform and resolve a related report or dispute. Muslim Rentals does not currently apply a
          fixed retention schedule to these categories of information.
        </p>
        <p>
          When an account is deleted, the account is deactivated, listings are removed from public view, the
          profile photograph is deleted, and the name and email address are replaced with a non-identifying
          placeholder. Messages sent in a shared conversation are retained to preserve the conversation history of
          the other participant; the deleted user's name is replaced with "Deleted user."
        </p>
        <p>Reports may be retained after account deletion for moderation, security, or legal record-keeping purposes.</p>
      </>
    ),
  },
  {
    id: 'security',
    heading: 'Security',
    body: (
      <p>
        Muslim Rentals applies technical and administrative safeguards designed to protect personal information,
        including secure password storage, encrypted transmission of data between users and the Platform, and
        monitoring for abusive or unauthorized activity. No system can guarantee complete security, and Muslim
        Rentals cannot warrant that these measures will prevent all unauthorized access. Muslim Rentals will take
        appropriate steps, including notification where required by law, in the event of a security incident
        affecting personal information.
      </p>
    ),
  },
  {
    id: 'rights',
    heading: 'Privacy choices and requests',
    body: (
      <>
        <p>
          Users may access and update their account information, including name, phone number, biography, and
          profile photograph, through account settings. Users may delete their account at any time through
          account settings; this action is irreversible and is described further above.
        </p>
        <p>
          Users who signed in with Google may revoke the Platform's access through their Google account settings;
          this does not delete the associated Muslim Rentals account.
        </p>
        <p>
          Requests to access personal information, questions about this policy, or other privacy-related concerns
          may be directed to{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>.
          Users may also file a complaint with the{' '}
          <a href="https://www.priv.gc.ca" target="_blank" rel="noopener noreferrer" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
            Office of the Privacy Commissioner of Canada
          </a>.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    heading: "Children's privacy",
    body: (
      <p>
        The Platform is intended for users 18 years of age and older, consistent with the eligibility
        requirement in the{' '}
        <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms of Service</Link>. Muslim
        Rentals does not knowingly collect personal information from individuals under 18.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    body: (
      <p>
        This Privacy Policy may be updated from time to time. Material changes are identified by an updated
        effective date. Users will be notified through the Platform where a change meaningfully affects the
        collection or use of personal information.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <p>
        Questions regarding this policy may be directed to{' '}
        <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>{' '}
        or through the <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <PolicyLayout
      title="Privacy Policy"
      effectiveDate="September 1, 2026"
      intro={
        <p>
          This Privacy Policy describes the personal information Muslim Rentals collects, how it is used and
          shared, where it is processed, and the choices available to users.
        </p>
      }
      sections={sections}
    />
  );
}
