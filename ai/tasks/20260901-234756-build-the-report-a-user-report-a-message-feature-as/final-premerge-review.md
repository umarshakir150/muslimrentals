# Final pre-merge review — report-a-user / report-a-message (PR #7)

Reviewed against the complete diff on `agents/20260901-234756-build-the-report-a-user-report-a-message-feature-as/integration`
vs. `main` (merge-base `92c8f9d`), i.e. everything in PR #7: the original
feature (already QA/Security/Trust&Safety-reviewed — see `qa.json`,
`security.json`, `trust-safety.md`, `trust-safety-post-implementation.md`
in this directory) plus every founder-requested follow-up round since:
admin recipient/timestamp display, SLA-copy softening, the individual-
message report-button discoverability fix, the "Full conversation"
deep-link fix (including the ADMIN/MODERATOR non-participant read access
on `GET /messages/conversations/:id`), moderator-view participant
differentiation, the account-dropdown hover-close fix, admin report email
display, and this final round's `messageSnapshot` retention implementation
(schema, hold mechanism, redaction script, Privacy Policy disclosure,
moderator documentation).

Performed directly in this session (not a separate orchestrator worker
invocation), reading the actual code and running the actual test suites
and builds myself rather than citing prior summaries alone.

## What's new since the last recorded reviews

- `rentals/backend/prisma/schema.prisma` / new migration
  `20260902070000_add_report_retention_fields`: additive-only
  `retentionHold` (Boolean, default false), `retentionHoldReason`
  (nullable String), `snapshotRedactedAt` (nullable DateTime) on `Report`.
  No existing column altered, nothing made NOT NULL beyond a defaulted
  boolean, no backfill required — same pattern as every prior migration
  in this PR.
- `rentals/backend/src/routes/admin.ts`: `PATCH /admin/reports/:id` now
  accepts `retentionHold`/`retentionHoldReason` independent of `status`,
  and — a genuine bug fix found while implementing this — `resolvedAt` is
  now only set the *first* time a report transitions into `RESOLVED`/
  `DISMISSED`, not re-stamped on every PATCH. The prior unconditional
  `resolvedAt: new Date()` on every PATCH would have silently pushed the
  90-day retention clock forward indefinitely on any incidental future
  update to an already-resolved report (e.g. a hold toggle). This is a
  correctness fix required for the retention policy to mean what it says,
  not a scope expansion.
- `rentals/backend/src/utils/retention.ts` + `src/scripts/redactExpiredMessageSnapshots.ts`:
  the eligibility rule (open reports never eligible; 90 days from
  `resolvedAt` once `RESOLVED`/`DISMISSED`; `retentionHold` pauses it;
  already-redacted or snapshot-less rows are never reprocessed) and an
  on-demand script that applies it. Deliberately **not** wired to a
  scheduler — the founder explicitly approved staging automation for
  later while report volume is low. Run manually via
  `npm run retention:redact-snapshots`.
- `rentals/frontend/src/app/admin/page.tsx`: a "Place retention hold" /
  "Remove retention hold" action on MESSAGE reports (prompts for a reason
  when placing one), a hold-active indicator (inline card + the "Reported
  message" dialog), and a "Message content redacted per the retention
  policy" notice distinct from the pre-existing "Message content
  unavailable" fallback.
- `rentals/frontend/src/app/privacy/page.tsx`: added the retention
  disclosure to the existing "Retention and deletion" section — while a
  message report is open the content is retained, 90 days after
  resolution it's retained further, then permanently removed while the
  report record itself is kept, with an exception for an active
  investigation/dispute/legal-preservation hold. This is a **draft
  addition for founder review**, not a unilateral publish — per
  `CLAUDE.md`'s founder-authority rule that publishing legal policy pages
  is reserved to the founder. The effective date on the page was
  deliberately left unchanged; updating it is a publish-time decision.
- `ai/moderator-guide.md` (new, ships with this PR since it documents this
  PR's own feature): admin panel access, what each report type shows, the
  review actions available, and the retention/hold policy in full,
  including how and when to run the redaction script.

## QA

**Verdict: PASS.**

- Ran the full suites myself, this session, in this worktree:
  backend **232/232** passing, frontend **181/181** passing (up from
  211/164 at the original implementation review — the increase is exactly
  the follow-up rounds' own new tests, not unrelated additions).
  `tsc --noEmit` clean on both. `npm run build` clean on both
  (Next.js production build succeeds; backend `tsc` build succeeds).
- New retention-specific coverage: 8 unit tests on the eligibility function
  (`tests/utils/retention.test.ts` — open/resolved/dismissed/held/
  already-redacted/no-snapshot/missing-resolvedAt cases), 6 tests on the
  PATCH endpoint (404, first-transition sets `resolvedAt`, re-PATCH does
  NOT re-stamp it, hold placed/cleared independent of status, strict-schema
  rejection), and frontend tests for placing/canceling/removing a hold and
  the redacted-content copy.
- One real bug found and fixed during this round's own implementation
  (the `resolvedAt` re-stamping issue above) — caught by reasoning through
  what the retention policy requires, not by a failing test that already
  existed; new tests now pin it down.
- One test-harness-only bug found and fixed while writing the new hold
  toggle tests: `admin/page.test.tsx`'s mocked `useUser()` returned a new
  object literal every call, unlike the real Zustand selector (which is
  reference-stable), causing `AdminPage`'s `useEffect(..., [user])` to
  re-fire and silently revert local state after every moderator action
  once a test's `waitFor` ran long enough to observe it. Fixed by hoisting
  a stable mock object. This is a test-fidelity fix only — confirmed the
  real `useUser` (`useAuthStore((s) => s.user)`) is already reference-
  stable in production, so no production code was affected.
- Gap carried forward from `qa.json`/`trust-safety-post-implementation.md`
  and now genuinely closed: the one open MEDIUM item from those reviews
  was exactly "`messageSnapshot` has no retention or deletion policy" —
  this round is that policy's implementation.
- Residual, disclosed rather than hidden: this round's backend change
  (schema + `admin.ts`) has **not** been applied to the live Supabase
  database or cherry-picked to Render's tracked branch, so it has not been
  exercised on the Netlify Deploy Preview end-to-end. This is a deliberate
  scope decision, not an oversight — the founder's request this round was
  documentation/review/readiness, not another live-deploy round, and a
  schema change deserves its own explicit go-ahead the same way every
  prior migration in this PR required one. See "Outstanding before/at
  merge" below.

## Security

**Verdict: APPROVED**, no blocking findings.

- `PATCH /admin/reports/:id` remains behind the unchanged router-level
  `requireRole(ADMIN, MODERATOR)` gate; the new `retentionHold`/
  `retentionHoldReason` fields are `.strict()`-validated
  (`z.boolean().optional()` / `z.string().max(300).trim().optional()`),
  consistent with this file's existing schema conventions. No new
  unauthenticated or role-widened surface.
- The endpoint now does a `findUnique` read before update (to compare
  prior status) — selects only `{ status: true }`, no data exposure risk,
  and 404s cleanly for a nonexistent report rather than a raw Prisma
  error.
- The redaction script and its underlying eligibility check only ever
  *clear* `messageSnapshot` (never read/return it beyond what
  `GET /admin/reports` already exposed to ADMIN/MODERATOR) and only
  update rows matching the exact policy — no risk of clearing an open or
  held report's content.
- Frontend renders all new text (hold reason, redacted-content notice) as
  plain React text nodes — no `dangerouslySetInnerHTML`, no new XSS
  vector.
- Emails added to the admin report display (from the prior round) and the
  hold/retention UI added this round are both still scoped entirely to
  the existing `ADMIN`/`MODERATOR`-gated `/admin` surface — confirmed
  by re-reading `admin.ts`'s router-level `requireRole` and
  `admin/page.tsx`'s `user.role === 'USER'` redirect, neither of which
  changed. No email or retention/hold data is exposed via any public API
  or normal user-facing report UI (`POST /*/report` endpoints still return
  only `{success, message}`, unchanged this round).

## Trust & Safety

**Verdict: no blocking findings.** The one item this role's own prior
review (`trust-safety-post-implementation.md`, finding 7, MEDIUM) left
open — `messageSnapshot`'s lack of a retention/deletion policy — is
resolved by this round:

- The policy matches exactly what the founder approved: retained while
  open; 90 days from resolution; then cleared while the report record
  (status, reason, resolution, timestamps, identities) is kept for
  moderation/accountability history; a hold exception for active
  investigation/dispute/legal-preservation, settable by any
  ADMIN/MODERATOR with a required reason (min 5 characters client-side).
- No autonomous enforcement was introduced — placing or removing a hold,
  and running the redaction script, are both explicit human actions; nothing
  here grants a new automated restriction/ban capability.
- The redaction script cannot act on an open (`PENDING`) report or a held
  one under any circumstance — verified directly in
  `isSnapshotEligibleForRedaction` and by the 8 unit tests covering
  exactly those branches.
- Two LOW items from the original design/QA review remain open and are
  still correctly non-blocking, unchanged by this round: the qualifying
  USER-report interaction path (shared conversation vs. listing
  interaction) isn't persisted for moderator evidence, and there's no
  dedicated content-removal action for a MESSAGE report short of
  restricting the sender's account (both documented as known follow-ups
  in `ai/moderator-guide.md`'s "Reviewing a report" section, so moderators
  aren't left guessing).

## Legal / Compliance (issue-spotting only, not legal advice)

- The Privacy Policy addition accurately describes the implemented
  behavior — retention while open, 90 days post-resolution, then
  permanent removal of content (not the report record), with a hold
  exception — checked sentence-by-sentence against
  `isSnapshotEligibleForRedaction` and the PATCH endpoint's hold handling
  to confirm no mismatch between disclosed policy and actual code.
- **Publishing this policy text live is a founder decision**, per
  `CLAUDE.md`'s founder-authority list ("publishing legal policies
  (Terms, Privacy, Safety pages)"). It's included in this PR as the
  agreed disclosure to review and merge, not treated as already live —
  the page's effective date was deliberately left unchanged.
- No new categories of personal information are collected by this round;
  it only changes how long one existing category (reported message
  content) is kept and adds an internal-only exception mechanism.
- Automation being staged for later (manual script run, not a live cron)
  was the founder's own explicit call in the original policy approval —
  this round doesn't second-guess that, it implements exactly the
  approved shape.

## Outstanding before/at merge (not blockers to opening/reviewing this PR, disclosed for the founder's merge decision)

1. **This round's backend change (schema + `admin.ts`) has not been
   applied to the live Supabase database or deployed to Render.** The
   migration is additive and follows the exact pattern of every prior
   migration in this PR (each of which the founder separately approved
   before it was applied live). Recommend applying it as part of the
   normal merge → deploy sequence, or requesting a dedicated live-test
   round first if you want to exercise the hold toggle / redacted-content
   UI on the Deploy Preview before merging.
2. **Effective date on the Privacy Policy page** was not changed as part
   of this draft — decide the actual publish date at the time this is
   approved to go live.
3. Two LOW carried-over items (qualifying-interaction evidence, no
   dedicated MESSAGE content-removal action) remain reasonable
   follow-ups, not blockers, and are now documented as known gaps in
   `ai/moderator-guide.md` rather than silent.
