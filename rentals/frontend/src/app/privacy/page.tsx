import { Metadata } from 'next';
import Link from 'next/link';
import PolicyLayout, { PolicySection } from '@/components/legal/PolicyLayout';

export const metadata: Metadata = { title: 'Privacy Policy' };

const sections: PolicySection[] = [
  {
    id: 'who',
    heading: 'Who is responsible for your information',
    body: (
      <>
        <p>
          Muslim Rentals is currently operated as a project without a separately registered corporate legal
          entity — the same is true here as in our{' '}
          <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms of Service</Link>, and we're stating it plainly
          rather than inventing a company name to make this document look more finished than it is. Until a
          registered business entity is established, the individual operator of the Platform is the party
          responsible for the personal information described in this policy.
        </p>
        <p>
          For anything related to your privacy — a question, a concern, or a request to exercise one of the
          rights described below — contact us at{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>. This
          is the same address used for general support; we don't yet operate a separate, staffed privacy office,
          and we'd rather say so than describe a formal privacy team that doesn't exist.
        </p>
      </>
    ),
  },
  {
    id: 'collect',
    heading: 'Information we collect',
    body: (
      <>
        <p>
          We collect the information you give us directly when you use the Platform, plus a small amount of
          information generated automatically by using it. Specifically:
        </p>
        <p>
          <em>Account and profile information.</em> Your name, email address, and password (we store a bcrypt
          hash of your password, never the password itself) when you sign up directly, or the basic profile
          Google shares with us (name, email address, profile photo) if you sign in with Google instead. A phone
          number and a short bio are optional and only collected if you choose to add them in Settings. If you
          upload a profile photo, we store the image file itself.
        </p>
        <p>
          <em>Authentication information.</em> To keep you signed in and to detect account compromise, we
          maintain a refresh token associated with your account and a short-lived access token issued when you
          sign in; if you use Google sign-in, we also store the Google account identifier so we can recognize you
          on future sign-ins. We don't receive or store your Google password.
        </p>
        <p>
          <em>Listing information.</em> Anything you include when you post a listing: the description, price,
          address or neighbourhood, bedroom and bathroom counts, amenities, photos, and any contact details you
          choose to add to the listing itself.
        </p>
        <p>
          <em>Messages.</em> The content of messages you send through the Platform's messaging feature, along
          with related metadata such as when a message was sent and whether it's been read.
        </p>
        <p>
          <em>Saved listings and similar interactions.</em> If you save a listing to view again later, we record
          that association between your account and the listing.
        </p>
        <p>
          <em>Reports and safety information.</em> If you report a listing, we collect the reason and any
          description you provide, along with a reference to your account and the listing being reported.
        </p>
        <p>
          <em>Technical information.</em> Standard request logs generated automatically by our hosting
          infrastructure — IP address, browser user agent, and timestamps — used for security purposes such as
          rate-limiting and detecting abuse. We don't run analytics or tracking scripts, so we don't collect
          browsing behavior data beyond what these basic request logs capture.
        </p>
        <p>We don't buy personal information about you from data brokers or other third parties.</p>
      </>
    ),
  },
  {
    id: 'purposes',
    heading: 'Why we use your information',
    body: (
      <>
        <p>
          We use your account and authentication information to create and secure your account, keep you signed
          in, and confirm changes like an email update — this is the core of what makes the Platform function at
          all for a signed-in user.
        </p>
        <p>
          We use your listing information to show your listing to other users, including on the map and in
          search results, and to let you manage your own listings from your account.
        </p>
        <p>
          We use message content to deliver your messages to the other participant in a conversation and to keep
          a conversation history available to both of you — see the Private messages section below for the
          limits on how else message content is used.
        </p>
        <p>
          We use reports, and where necessary message or account history connected to them, to review and act on
          violations of our{' '}
          <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms</Link> or{' '}
          <Link href="/community-guidelines" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Content &amp; Community Guidelines</Link>{' '}
          — this is what we mean by safety and moderation purposes throughout this policy.
        </p>
        <p>
          We use technical and request-log information for security: detecting and rate-limiting abusive traffic,
          investigating suspicious activity, and keeping the Platform generally operable and abuse-resistant.
        </p>
        <p>
          We use your contact information to respond when you email us for support, and we use aggregate
          information about how the Platform is used (for example, how many listings or messages exist in total)
          to operate and improve the service. We also use your information as needed to comply with a legal
          obligation, such as a valid request from a Canadian court, regulator, or law enforcement body.
        </p>
      </>
    ),
  },
  {
    id: 'visibility',
    heading: 'What is public versus private',
    body: (
      <>
        <p>
          Because Muslim Rentals is a listing marketplace, some of what you provide is public by design. Your
          display name and profile photo are visible on any listing you post and to anyone you message. A
          listing's full description, price, location, photos, and — if you chose to add one — its contact
          information are visible to any visitor to the site, including someone who isn't signed in. Please don't
          include anything in a public listing that you wouldn't want a stranger to see.
        </p>
        <p>
          Everything else described in the previous section is private: your email address, phone number,
          password, saved listings, message content, and report history are not shown to other users. Your
          display name and photo are visible to the other participant of a conversation you're part of, but the
          content of that conversation is only visible to the two (or more) participants and, in the limited
          circumstances described below, to us.
        </p>
      </>
    ),
  },
  {
    id: 'messages-privacy',
    heading: 'Private messages',
    body: (
      <>
        <p>
          Messages you send through the Platform are stored in our database so that your conversation history is
          available to you and the other participant. We are not describing messaging as end-to-end encrypted,
          because it isn't — message content is readable by our systems the same way any other data you store on
          the Platform is, and we're not going to claim a stronger technical privacy guarantee than what actually
          exists.
        </p>
        <p>
          We don't currently provide a dedicated moderator tool for browsing message content, and staff don't
          routinely read messages. But because messages are stored in our database like any other data, it is
          technically possible for someone with database access — in practice, the Platform's operator — to view
          message content, and this may happen in a limited set of circumstances: investigating a specific report
          or suspected abuse, responding to a support request that requires looking at the conversation in
          question, addressing a security incident, or complying with a legal obligation such as a valid request
          from law enforcement. We don't access message content for advertising, don't sell or share it with
          third parties outside of what's described in this policy, and don't monitor conversations proactively
          or at random.
        </p>
      </>
    ),
  },
  {
    id: 'providers',
    heading: 'Service providers we use',
    body: (
      <>
        <p>
          Running the Platform requires a small number of infrastructure providers, each of which processes data
          only as needed to provide their service to us and under their own privacy terms, not ours:
        </p>
        <p>
          <em>Hosting.</em> Our website and API run on third-party cloud application-hosting platforms, and our
          database is a managed PostgreSQL instance operated by a third-party database provider.
        </p>
        <p>
          <em>File storage.</em> Listing photos and profile pictures are stored using Cloudflare R2, an
          S3-compatible object storage service.
        </p>
        <p>
          <em>Google Sign-In.</em> If you choose to sign in with Google, Google authenticates you and shares your
          basic profile with us; we never receive your Google password.
        </p>
        <p>
          <em>Email delivery.</em> Account-related emails, such as confirming an email change, are sent through a
          transactional email provider once that integration is fully configured on our end.
        </p>
        <p>
          We don't use advertising networks, analytics platforms, or payment processors today, so this policy
          doesn't describe any — if that changes, we'll update this section rather than leaving it silently out
          of date.
        </p>
        <p>We don't sell or rent your personal information to anyone, for any purpose.</p>
        <p>
          Beyond the categories above, we may disclose information where necessary to operate the service (as
          just described), to comply with a legal obligation, to investigate or respond to a security or abuse
          issue, or in connection with a sale, merger, or other transfer of the Platform's business — in which
          case this policy would continue to apply to your information under its new operator unless you're told
          otherwise.
        </p>
      </>
    ),
  },
  {
    id: 'location-storage',
    heading: 'Location of data and international processing',
    body: (
      <>
        <p>
          A listing's map location is the property address or neighbourhood you enter when posting it — we don't
          collect or track your device's GPS location, and the Platform doesn't request browser location
          permissions.
        </p>
        <p>
          Separately, and more generally: our hosting, database, and storage providers operate infrastructure
          located outside Canada, including in the United States. That means your information — account data,
          listings, messages, and everything else described above — may be processed and stored on servers
          outside Canada. We're stating this directly rather than claiming Canada-only storage, which wouldn't be
          accurate for how the Platform is actually built today. Information processed outside Canada may be
          subject to the laws of the country where it's located, including lawful access by that country's
          authorities.
        </p>
      </>
    ),
  },
  {
    id: 'cookies-storage',
    heading: 'Cookies, tokens, and browser storage',
    body: (
      <>
        <p>
          We use one functional cookie: a refresh token, set as HTTP-only (not readable by page scripts on any
          site), marked Secure, and scoped to our authentication endpoint. Its only purpose is keeping you signed
          in between visits. We don't set advertising or analytics cookies, and we don't use a cookie-consent
          banner because we don't set anything beyond this one functional, strictly-necessary cookie.
        </p>
        <p>
          Separately, your browser's local storage holds your current session's access token and a copy of your
          basic profile information, so the app can recognize you without an extra request on every page load.
          Unlike the refresh cookie, this is regular browser storage rather than an HTTP-only cookie, which is a
          standard security tradeoff worth being aware of: it could in principle be read by malicious script if a
          script-injection vulnerability were ever found on the site. We apply a strict content-security policy
          and sanitize user input specifically to reduce that risk, though no measure eliminates it entirely.
        </p>
        <p>We don't use third-party tracking pixels, fingerprinting scripts, or cross-site tracking of any kind.</p>
      </>
    ),
  },
  {
    id: 'retention',
    heading: 'How long we keep your information',
    body: (
      <>
        <p>
          We keep your account, listing, and message information for as long as your account is active, or as
          needed to operate the Platform and resolve any open report or dispute connected to it. We don't
          currently run an automated, scheduled deletion process on a fixed timeline for any category of data —
          if we build one, we'll describe it here rather than leaving this section describing a process that
          doesn't exist.
        </p>
        <p>
          When you delete your account (see the next section), we deactivate it immediately, remove your listings
          from public view, delete your profile photo, and replace your name and email address with a placeholder
          so the account can no longer be used to sign in. We keep the record of messages you sent in a shared
          conversation rather than deleting them outright, since doing so would also erase the other
          participant's side of that conversation; your name is replaced with "Deleted user" in that history
          going forward.
        </p>
        <p>
          A report you filed, or that was filed against your account, may be retained after account deletion for
          legitimate moderation, security, or legal record-keeping purposes, even though your account itself has
          been anonymized. We don't set a fixed retention period for this kind of record today, for the same
          reason described above — we'd rather describe our actual practice than invent a number.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    heading: 'Security',
    body: (
      <>
        <p>
          We take a set of concrete, practical steps to protect your information, described here conservatively
          rather than as a guarantee. Passwords are hashed with bcrypt and never stored or logged in plain text.
          Traffic to the Platform is encrypted in transit over HTTPS. Access tokens are short-lived, and the
          refresh token that keeps you signed in longer-term is stored in an HTTP-only, Secure cookie rather than
          somewhere a page script could read it. We apply rate limiting to slow down automated abuse, validate
          and sanitize input on every request, and apply a content-security policy intended to reduce the impact
          of a script-injection vulnerability if one were ever found.
        </p>
        <p>
          No online service can guarantee complete security, and we don't claim ours is unbreakable. If we become
          aware of a security incident that affects your personal information, we'll take reasonable steps to
          address it and, where required by law, notify you.
        </p>
      </>
    ),
  },
  {
    id: 'rights',
    heading: 'Your choices and privacy rights',
    body: (
      <>
        <p>
          Canadian privacy law, including the federal Personal Information Protection and Electronic Documents
          Act (PIPEDA) where it applies to how we handle your information, gives you rights over your personal
          information. We describe below what those rights look like in practice on this Platform, rather than
          simply asserting that we're "compliant" — whether every practice described in this policy fully
          satisfies PIPEDA (or a provincial equivalent, such as Quebec's private-sector privacy law) in every
          respect hasn't been the subject of a formal legal review, and we're not going to claim otherwise.
        </p>
        <p>
          You can access and correct most of your own information directly: your name, phone number, bio, and
          profile photo can be viewed and updated any time from Settings. You can delete your account from the
          same place — this is irreversible, and the Retention section above describes exactly what happens when
          you do.
        </p>
        <p>
          Signing up itself is the only consent mechanism we currently have; we don't operate a separate,
          granular consent-management system for different categories of processing, because — beyond the
          essential functional cookie described above — there isn't a separate category of optional processing to
          consent to. If you signed in with Google, you can revoke the Platform's access from your Google Account
          settings at any time; that doesn't delete your Muslim Rentals account itself, which you'd need to delete
          separately if that's what you want.
        </p>
        <p>
          For anything you can't do yourself through Settings — requesting a copy of your data in a specific
          format, asking a question about how we've handled your information, or raising a concern — contact us
          at{' '}
          <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a>. You
          also have the right to file a complaint with the{' '}
          <a href="https://www.priv.gc.ca" target="_blank" rel="noopener noreferrer" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
            Office of the Privacy Commissioner of Canada
          </a>{' '}
          if you believe we've mishandled your information.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    heading: "Children's privacy",
    body: (
      <p>
        The Platform is intended for people 18 and older, consistent with the eligibility requirement in our{' '}
        <Link href="/terms" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Terms of Service</Link>. We don't knowingly collect
        personal information from anyone under 18, and if we learn that we have, we'll delete it.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    body: (
      <p>
        We may update this Privacy Policy as the Platform changes. We'll update the "Effective" date at the top
        of this page whenever we do, and for a change we consider material — one that meaningfully affects how we
        collect or use your information — we'll try to give you notice through the Platform before it takes
        effect.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact us',
    body: (
      <p>
        Questions about this policy or your information can be sent to{' '}
        <a href="mailto:support@muslimrentals.ca" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">support@muslimrentals.ca</a> or
        through our <Link href="/contact" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Contact page</Link>.
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
          This policy explains what personal information Muslim Rentals collects, why we use it, who we share it
          with, where it's processed, and the choices and rights you have — written to describe what the Platform
          actually does, not a generic template.
        </p>
      }
      sections={sections}
    />
  );
}
