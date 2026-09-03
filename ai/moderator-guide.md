# Moderator Guide — Reports & Retention

Operational guide for anyone with `ADMIN` or `MODERATOR` role reviewing
reports through the admin panel. This is internal documentation, not a
public page — see `rentals/frontend/src/app/privacy/page.tsx` for what
users are told, and `rentals/frontend/src/app/community-guidelines` for
public content policy.

## Access

- URL: `/admin` on the deployed site.
- Requires `role: ADMIN` or `role: MODERATOR` on your account (enforced
  both client-side, which redirects any other role to `/`, and
  server-side on every admin API call via `requireRole(ADMIN, MODERATOR)`
  — the client-side check is a UX convenience only, never the real gate).
- There is no self-service way to become an admin/moderator; an existing
  admin changes a user's `role` directly (`PATCH /admin/users/:id/role`,
  `ADMIN`-only) or it's done via a direct database update.

## Report types

The admin panel's "Pending Reports" list shows every report, branching its
display by `targetType`:

- **Listing** — the reported listing's title, with a "Remove listing"
  action (soft-removes the listing; reversible).
- **User** — the reported user's name + email, whether they're already
  restricted, and the *reporter's* own report history (how many reports
  they've filed and how many were dismissed — a signal for retaliatory or
  bad-faith reporting). "Restrict user" (`ADMIN`-only) bans the account.
- **Message** — the reported message's exact frozen content (via the
  "Reported message" button), the sender's and recipient's name + email,
  when the message was sent, and a "Full conversation" button that opens
  the live thread in the Messages UI in a read-only moderator view (you
  are never a participant in the conversations you review this way — no
  compose box, no report actions available from that view; the two
  participants are visually distinguished by name and message-side color,
  derived from the conversation's real participants, not from your own
  account).

Every report also shows the reporter's name + email, the reason category,
and any free-text description they added.

## Reviewing a report

1. Open `/admin` and scroll to "Pending Reports."
2. Read the reason, description, and (for User/Message reports) the
   reported party's identity and history.
3. For a Message report, click "Reported message" to see the exact
   content, and "Full conversation" if you need surrounding context.
4. Take an action:
   - **Dismiss** — no violation found. Always available.
   - **Remove listing** — Listing reports only.
   - **Restrict user** — User reports only, `ADMIN`-only, requires typing a
     reason (min 5 characters). This bans the account.
   - There is currently no dedicated "remove/warn" action for a Message
     report beyond Dismiss — a message-content violation serious enough to
     warrant account action is handled via "Restrict user" on the sender
     (find their User report history, or file/locate a User report against
     them) until a more direct action is built.

Every action that resolves a report (Dismiss, Remove listing, Restrict
user) sets the report's status to `RESOLVED` and starts the retention
clock described below — the first time only; re-resolving an
already-resolved report does not restart the clock.

## messageSnapshot retention policy

Approved 2026-09-02. Applies only to the frozen message content
(`messageSnapshot`) on Message reports:

- **While a report is open (`PENDING`):** the snapshot is retained
  indefinitely — it's needed to review the report at all.
- **Once a report is `RESOLVED` or `DISMISSED`:** the snapshot is retained
  for a further **90 days** from that point.
- **After 90 days:** the snapshot text is cleared. The report row itself
  (status, reason, resolution, timestamps, and the sender/recipient/
  reporter identities) is retained indefinitely for record-keeping — only
  the message's own content is removed. The admin panel shows "Message
  content redacted per the retention policy" in place of the snapshot once
  this has happened.
- **Retention hold (exception):** if a report needs to be preserved past
  its normal 90 days — an active investigation, a dispute, or a legal
  preservation obligation — place a hold via the **"Place retention
  hold"** button on that report's card. You'll be asked for a short reason
  (shown to other moderators on that report, e.g. "Active police
  investigation"). This pauses the clock entirely until the hold is
  removed via **"Remove retention hold"** on the same card.

**Automation is intentionally not scheduled yet** — the founder approved
staging this for later while report volume is low. The actual redaction
(clearing eligible snapshots) is a script,
`rentals/backend/src/scripts/redactExpiredMessageSnapshots.ts`, run
on-demand via `npm run retention:redact-snapshots` from the backend. It
finds every `RESOLVED`/`DISMISSED` Message report whose `resolvedAt` is
90+ days ago, isn't on hold, and hasn't already been redacted, then clears
`messageSnapshot` and stamps `snapshotRedactedAt`. Run it manually
periodically (e.g. monthly) until it's wired to a real scheduler; it's
idempotent and safe to run as often as needed — a report that isn't
actually eligible yet is simply skipped.

## Escalation

- Anything beyond Dismiss/Remove listing/Restrict user (e.g. removing
  message content directly, a permanent ban dispute, a legal request for
  data) is a founder decision — see `CLAUDE.md`'s "Founder authority"
  section. Don't act outside these documented actions without checking
  with the founder first.
- If a report reveals an urgent safety issue (e.g. real-world harm, not
  just a policy violation), treat it as higher priority than routine queue
  order and flag it directly to the founder rather than only queuing it.
