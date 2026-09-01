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
          These Terms of Service ("Terms") govern your access to and use of Muslim Rentals (the "Platform"),
          available at muslimrentals.ca and any related mobile or web application we offer. By creating an
          account, browsing listings, posting a listing, sending a message, or otherwise using the Platform, you
          agree to be bound by these Terms. If you do not agree to them, you should not use the Platform.
        </p>
        <p>
          These Terms work together with our{' '}
          <Link href="/privacy" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Privacy Policy</Link> and our{' '}
          <Link href="/community-guidelines" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Content &amp; Community Guidelines</Link>,
          which are incorporated into this agreement by reference. Where this document refers to a rule about
          conduct or content, the Community Guidelines page explains that rule in more everyday language and with
          examples; where the two conflict, these Terms control.
        </p>
        <p>
          We may update these Terms from time to time. See the section on changes near the end of this document
          for how that works. Continuing to use the Platform after an update takes effect means you accept the
          revised Terms.
        </p>
      </>
    ),
  },
  {
    id: 'operator',
    heading: 'Who operates Muslim Rentals',
    body: (
      <>
        <p>
          Muslim Rentals is currently operated as a project without a separately registered corporate legal
          entity. We are stating that plainly rather than inventing a company name, registration number, or
          business address to make this document look more finished than it is. Until a registered business
          entity is established (and this document updated to name it), you are contracting with the individual
          operator of the Platform, reachable at the contact address below.
        </p>
        <p>
          You can reach us about anything related to these Terms, your account, a listing, or a safety concern at{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>, or
          through the form on our <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>. We do not
          currently list a physical mailing address or phone number for the Platform.
        </p>
        <p className="text-muted">
          This is a placeholder pending a decision by the Platform operator on the entity's formal legal
          structure. It is not something this document can resolve on its own, and it should be revisited before
          the Platform is treated as legally equivalent to an incorporated business in any dispute, contract, or
          regulatory filing.
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
          Muslim Rentals is a listing and messaging platform. It helps people in Canada's Muslim community post
          rental housing, browse listings from other users, and message each other about a specific listing. That
          is the entirety of what the Platform does. We do not inspect the properties that are listed, verify
          that a poster owns or has the right to rent out a property, run credit or background checks on any
          user, draft or review lease agreements, collect or hold rent, deposits, or any other funds on behalf of
          a user, or take any part in negotiating the terms of a tenancy.
        </p>
        <p>
          Because of that, Muslim Rentals is not a landlord, a tenant, a real estate broker, a property manager,
          a rental agent, or a payment processor, and we are not a party to any lease or rental agreement formed
          between users of the Platform. If you rent a property to, or from, another user you found through
          Muslim Rentals, the resulting agreement is exclusively between you and that other person. It is governed
          by the landlord-tenant legislation of your province or territory, not by these Terms, and any dispute
          about the tenancy itself — rent, condition of the unit, damage, notice periods, or eviction — is a
          matter between you and the other party (and, where applicable, your provincial landlord-tenant board),
          not something Muslim Rentals adjudicates, mediates, or is responsible for.
        </p>
        <p>
          The Platform is currently free to use. We do not charge a fee to create an account, post a listing, or
          send a message, and we do not process rent, deposits, or any other payment between users. See the Fees
          and Payments section below for more on this and on how that could change in the future.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    heading: 'Accounts, eligibility, and account security',
    body: (
      <>
        <p>
          You must be at least 18 years old to create a Muslim Rentals account. You can sign up with an email
          address and password, or by signing in with a Google account. Either way, you're required to provide
          accurate information — your real name and a working email address at minimum — and to keep that
          information up to date. Impersonating someone else, or creating an account using information you're not
          entitled to use, is not allowed.
        </p>
        <p>
          You are responsible for keeping your password confidential and for all activity that takes place under
          your account, whether or not you personally performed it. If you believe your account has been accessed
          without your permission — for example, if you notice messages you didn't send, or account details you
          didn't change — you should change your password immediately if you're still able to sign in, and
          contact us at{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a> so we
          can help secure the account. We are not responsible for losses caused by an unauthorized party gaining
          access to your account through a password you failed to keep secure, though we will still take
          reasonable steps to help you regain control of it.
        </p>
        <p>
          Each person may hold one account. Creating additional accounts to get around a ban, a rate limit, or a
          pending report against you is a violation of these Terms and grounds for suspending every account
          involved.
        </p>
        <p>
          You may close your own account at any time from your account settings; see the Privacy Policy for
          exactly what happens to your data when you do. We may also suspend or close an account under the
          Reporting and Moderation section below.
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
          A listing must describe a real, currently available property that you, or the person you're posting on
          behalf of, actually have the right to rent or sublet. You're responsible for the accuracy of everything
          in your listing — price, location, availability, number of bedrooms and bathrooms, amenities, photos,
          and any contact information you choose to include. Posting a listing for a property that doesn't exist,
          isn't actually available, has already been rented, or that you don't have the right to rent out, is a
          fraudulent listing and a serious violation of these Terms.
        </p>
        <p>
          Rental scams are a real and common problem across every housing platform, not something unique to
          Muslim Rentals, and we treat them accordingly. Using a listing or a message to solicit an upfront
          payment, deposit, or e-transfer before a genuine viewing and signed lease is one of the most common
          patterns and is prohibited outright, regardless of how the request is phrased. Impersonating a landlord,
          property manager, or agent you are not is also prohibited, as is posting the same listing repeatedly
          (duplicate or spam listings) to artificially increase its visibility.
        </p>
        <p>
          Some listings let you note a preferred audience for the unit — for example, a preference for a
          sisters-only, brothers-only, couples, or family household. This exists to help people find a living
          situation that genuinely suits them, not as a general license to exclude people on a legally protected
          ground. As the poster, you're responsible for making sure your own listing and how you apply that
          preference comply with the human rights and tenancy legislation that applies in your province — this is
          a genuinely nuanced area of Canadian law that varies by province, and these Terms don't attempt to give
          you legal advice on how it applies to your specific listing; if you're unsure, consult your own legal
          counsel or your provincial human rights commission.
        </p>
        <p>
          Beyond fraud and discrimination, you agree not to use a listing, your profile, or any other part of the
          Platform to harass or threaten another user, post content that's hateful, sexually explicit, or
          otherwise unlawful, advertise anything unrelated to renting housing (spam or unrelated commercial
          solicitation), infringe someone else's copyright or other rights, attempt to scrape, systematically
          collect, or resell data from the Platform, or attempt to bypass a rate limit, a ban, or any other access
          control we've put in place. This list illustrates the kind of conduct that's not
          allowed; it isn't exhaustive, and our{' '}
          <Link href="/community-guidelines" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Content &amp; Community Guidelines</Link>{' '}
          goes into more detail with examples.
        </p>
        <p>
          We may remove a listing that violates these Terms or our Community Guidelines, or that we reasonably
          believe is fraudulent, without prior notice — see the Reporting and Moderation section below for how
          that decision gets made and what happens to your account when it does.
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
          The Platform includes a messaging feature so you can ask questions about a listing, arrange a viewing,
          and otherwise communicate with another user without publishing your contact details to the whole site.
          It's meant to be used for that purpose: genuine communication about a specific rental.
        </p>
        <p>
          Using messaging to harass, threaten, or repeatedly contact someone who has asked you to stop is not
          allowed and is treated the same as any other form of harassment on the Platform. Sending unsolicited
          commercial messages, spam, or messages unrelated to a listing is not allowed either. Using messaging as
          part of a scam — for example, asking someone to send money, move the conversation to an unmonitored
          channel before you've met or verified who they are, or share sensitive financial or identity information
          — is a serious violation and, depending on the circumstances, may also be unlawful under Canadian
          criminal or consumer-protection law, independent of anything in these Terms.
        </p>
        <p>
          Don't share sensitive information — banking details, a full government ID number, or similar — through
          messaging or any other channel before you've genuinely verified who you're dealing with. See our{' '}
          <Link href="/safety" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Safety Guidelines</Link> for practical advice on this.
        </p>
        <p>
          Messages you send are stored so that your conversation history is available to you and to the other
          participant in that conversation; see our{' '}
          <Link href="/privacy" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Privacy Policy</Link> for the full detail on how
          message content is stored, who can technically access it, and under what circumstances.
        </p>
      </>
    ),
  },
  {
    id: 'user-content',
    heading: 'Your content, and the license you give us',
    body: (
      <>
        <p>
          "Your content" means anything you submit to the Platform: your listing descriptions and photos, your
          profile information and photo, and the messages you send. You keep ownership of your content — posting
          it doesn't transfer ownership to us.
        </p>
        <p>
          You're responsible for having the rights you need to post whatever you post. In practice, that means
          you should only upload photos you took yourself or that you have permission to use, and you shouldn't
          post a listing description copied from somewhere else without the right to do so. Don't post content
          that infringes someone else's copyright, trademark, privacy, or other rights.
        </p>
        <p>
          To actually operate the Platform, we need a limited license from you: by posting content, you grant us
          a non-exclusive, royalty-free license to host, store, display, and distribute that content as part of
          running the service — for example, showing your listing photos to other visitors, or displaying your
          messages to the other participant in a conversation. This license exists only so we can do the ordinary
          things a listing-and-messaging platform needs to do with the content you give it; it doesn't give us
          the right to sell your content, license it to unrelated third parties, or use it for advertising
          outside the Platform. When you delete a listing, or delete your account, we stop displaying that
          content going forward, subject to the retention practices described in the Privacy Policy (for example,
          a message you sent may remain visible to the other participant in a shared conversation even after your
          account is deleted, since removing it would also erase their side of that conversation).
        </p>
        <p>
          The Platform's own design, code, and branding — as distinct from the content users post — belong to us
          or our licensors, and these Terms don't grant you any rights to them beyond what's needed to use the
          Platform as intended.
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
          You can report a listing you believe is fraudulent, misleading, or otherwise violates these Terms
          directly from its page. For anything that isn't a listing — a message, a user's conduct, or a general
          concern — the most reliable way to reach us today is by email at{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a> or
          through our <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>; we don't yet have a
          dedicated in-app reporting flow for users or messages specifically, and we'd rather tell you that
          plainly than leave you assuming a button exists that doesn't.
        </p>
        <p>
          Reports are reviewed by a person, not resolved automatically. We try to look at context — a first,
          minor issue is treated differently from a clear scam pattern or repeated abuse — but we don't currently
          commit to a specific review timeline or a formal, multi-stage escalation process, because we don't want
          to promise a level of process we can't consistently deliver at this stage of the Platform. Depending on
          what we find, we may remove a specific piece of content (like a listing), restrict certain features on
          an account, suspend an account temporarily, or ban an account permanently. For a clear violation — fraud,
          harassment, or content that's plainly unlawful — we may take that action immediately and without prior
          warning.
        </p>
        <p>
          If you believe your listing was removed or your account was actioned in error, you can reply to the
          notification we send you or contact{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a> to
          ask us to reconsider. We'll look at it, but we want to be honest that this is a direct conversation with
          the operator today, not a structured, independent appeals process with guaranteed turnaround — if that
          changes, we'll update this section to reflect it.
        </p>
        <p>
          Filing a report you genuinely believe is accurate is always welcome, even if we end up disagreeing with
          it after review. Filing reports you know to be false, or using the reporting process to retaliate
          against a legitimate poster, is itself a violation of these Terms.
        </p>
      </>
    ),
  },
  {
    id: 'fees',
    heading: 'Fees and payments',
    body: (
      <p>
        Muslim Rentals is free to use today. We don't charge a listing fee, a subscription fee, or any other fee
        to create an account, post a listing, browse, or message. We also don't process rent, deposits, or any
        other payment between a landlord and a tenant — any money that changes hands as part of a rental happens
        entirely outside the Platform, directly between the parties involved, and we have no visibility into or
        responsibility for it. If we introduce a paid feature or a payment-processing capability in the future,
        it will come with its own additional terms describing pricing, billing, and refunds at that time — nothing
        in this current version of these Terms should be read as describing payment or refund rules that don't
        exist yet.
      </p>
    ),
  },
  {
    id: 'responsibility',
    heading: 'Your responsibility for rental decisions',
    body: (
      <>
        <p>
          Any decision to view a property, message a landlord or tenant, sign a lease, hand over a deposit, or
          otherwise enter into a rental arrangement with someone you met through Muslim Rentals is entirely your
          own decision and your own responsibility. We don't verify listings or users before they appear on the
          Platform, and the presence of a listing on Muslim Rentals is not an endorsement of it or of the person
          who posted it. Please exercise the same judgment and caution you would with any other online rental
          listing — see our <Link href="/safety" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Safety Guidelines</Link> for concrete
          advice on verifying a listing and a landlord before committing to anything.
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
          The Platform is provided "as is" and "as available." We don't guarantee that any listing is accurate,
          available, or posted by someone with the legal right to rent it out, and, as described above, we don't
          verify user identities, property ownership, or the terms of any rental agreement. We don't guarantee
          the Platform will be uninterrupted, error-free, or available at all times.
        </p>
        <p>
          To the fullest extent permitted by law, Muslim Rentals and its operator are not liable for any loss or
          damage arising from your use of the Platform, including losses connected to a fraudulent or inaccurate
          listing, a scam carried out by another user, a dispute with another user, or a rental agreement you
          entered into with someone you met through the Platform. This is a broad limitation because our role is
          genuinely limited to connecting people — we are not a party to what happens next.
        </p>
        <p>
          That said, nothing in these Terms is intended to, and nothing in these Terms should be read to, limit
          or exclude any right or protection that applies to you under Canadian consumer-protection law and
          cannot lawfully be waived by agreement. Provincial consumer-protection statutes vary and, in some
          circumstances, override broad liability waivers like the one above — where that's the case, this
          section is limited accordingly rather than superseding that law.
        </p>
      </>
    ),
  },
  {
    id: 'governing-law',
    heading: 'Governing law',
    body: (
      <p className="text-muted">
        The specific governing law and venue for resolving a dispute under these Terms hasn't been finalized and
        will be added here once it is. We're flagging this openly rather than naming a province as if the
        question had already been decided — it's a deliberate operator decision (ideally made with legal advice)
        that hasn't happened yet, not an oversight in this document.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to the Platform or these Terms',
    body: (
      <p>
        We may add, change, or discontinue features of the Platform, and may update these Terms, at any time.
        We'll update the "Effective" date at the top of this page whenever we do. For a change we consider
        significant — for example, a change that meaningfully affects your rights or how the Platform works — we'll
        try to give you reasonable notice, such as a notice on the Platform itself or an email, before it takes
        effect.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <p>
        Questions about these Terms can be sent to{' '}
        <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a> or
        through our <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>.
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
          Please read these Terms carefully. They explain what Muslim Rentals is and isn't, what you can and
          can't do here, and how account and content issues are handled. Where something below is a placeholder
          pending an operator decision, we've said so directly rather than filling it in with something that
          sounds official but isn't accurate yet.
        </p>
      }
      sections={sections}
    />
  );
}
