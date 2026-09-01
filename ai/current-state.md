# Current State

Last verified against the repository: 2026-08-25, commit `f086c68` on
`main`. Update this file whenever the picture materially changes — don't
let it drift into fiction.

## Tech stack

- **Frontend:** Next.js 14.2 (App Router), React 18, TypeScript, Tailwind
  CSS, Radix UI, Zustand, Leaflet, Socket.IO client, react-hook-form + zod.
- **Backend:** Express 4, TypeScript, Prisma 5, PostgreSQL, Socket.IO
  server, JWT + Google OAuth, S3-compatible storage, Nodemailer.
- Full breakdown: `company/architecture.md`.

## Current working features

- Listing CRUD (create/edit/soft-remove by owner or admin/moderator),
  browse/filter/search/sort/paginate, map view, save/unsave, report.
- Real-time messaging per listing conversation, with typing indicators and
  read receipts.
- Email/password and Google OAuth registration/login, JWT refresh rotation,
  forgot/reset password.
- Admin panel: stats, user search, ban/unban, role change, listing removal,
  report triage.
- Static policy pages: Safety, Terms, Privacy, Content & Community
  Guidelines, Contact.
- User-initiated account deletion (Settings), anonymizing rather than
  hard-deleting to preserve other users' shared conversation history.
- Seeded reference data: mosques and Canadian cities.

## Incomplete / not-yet-built features

- **Roommate profiles and roommate matching** — mentioned in the product
  vision but not implemented anywhere in the codebase (no schema, no
  routes, no UI). See `company/product.md`.
- **Reporting a user or a message directly** — only listings can be
  reported today.
- **Push or digest email notifications** — only transactional email exists.
- **Payments/monetization** — not built, not currently planned.

## Testing status

**No automated test suite exists.** No `*.test.*` or `*.spec.*` files, no
test runner configured in `rentals/frontend/package.json` or
`rentals/backend/package.json`. `type-check` (frontend `tsc --noEmit`) and
`lint` scripts exist on both sides and can be run as a cheap correctness
check, but they are not a substitute for tests. Until a test suite exists,
QA and manual verification are the only correctness gates — do not skip
them because "there are no tests to run."

## Deployment status

**Live in production** (as of 2026-08-28, founder-directed): frontend on
Netlify (`muslimrentals.netlify.app`, deploys from `main`), backend on
Render (`muslim-rentals-backend`, a pre-existing service from June
repointed to deploy from the `claude/multi-agent-os-setup-y2wprj` branch),
database on Supabase (project `mxpoenfnqrfwznquaibd`), connected via the
`postgres` role over Supavisor's session pooler
(`aws-1-us-east-2.pooler.supabase.com:5432` — the pooler only recognizes
roles provisioned through Supabase's own control plane, not ones created
via raw SQL, and the direct connection `db.<ref>.supabase.co:5432` was
unreachable from Render, likely IPv6-only). Railway was tried first, fully
verified working, then explicitly decommissioned by founder instruction in
favor of a pre-existing Render service found during a "check my Render
account" pass — do not use, modify, redeploy, or monitor Railway; treat it
as gone. Verified end-to-end with real traffic: CORS, API requests, and
the Supabase connection all confirmed working from the live site, not
just inferred from config. `main` and the working branch above track each
other via the existing production auto-merge mechanism
(`orchestrator/src/git/worktree.ts`'s `mergeToProductionBranch`) rather
than a direct push to `main` from this environment. See
`ai/decisions.md` for the full record, including several real production
bugs found and fixed live during this rollout (uploads.ts's AWS-config
boot crash; GET /listings's 50-row cap rejecting the map page's real
limit=200 requests; a wrong-password error message; a missing
reset-password page; an empty City table blocking listing posts).

**Known gap — outbound email is not actually configured.**
`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are unset on Render, so no
transactional email (welcome email, password-reset email) is ever
delivered — `sendEmail()` now fails fast with a clear "SMTP not
configured" log line instead of nodemailer's confusing default attempt to
connect to `localhost:587`, but the underlying gap is unchanged: this
needs a real transactional email provider account (e.g. Resend, SendGrid,
Postmark, AWS SES) and its API/SMTP credentials, which is founder/
external work — no email-sending connector or credential is available to
this session. Forgot/reset-password's `/auth/reset-password` page and
backend logic both work correctly on their own (a real reset token, once
someone has it, works end-to-end) — only the "email a link" delivery step
is broken. See `ai/regression-inventory.md`'s "Forgot / reset password"
row and `ai/decisions.md`'s 2026-08-28 entries for detail.

## Security posture

The codebase is unusually security-conscious for its stage: layered rate
limiting, `.strict()` Zod validation everywhere, ownership checks before
mutation, UUID validation on path params, helmet/CSP/HSTS, sanitized
inputs, S3 keys that never trust client filenames, env validation that
hard-fails production startup on weak secrets. See
`company/architecture.md`'s "Known weaknesses" section for the specific
gaps worth tracking:

- `accessToken` persisted to `localStorage` (XSS exposure surface).
- `Listing.contactInfo` visible to unauthenticated viewers.
- No CI to enforce lint/build/(future) tests on every change.
- No committed `.env.example`.

None of these are necessarily wrong for the product's current stage — they
are documented so Security/Engineering treat them as known, not rediscover
them from scratch each time.

## Technical debt

- No test suite, no CI — the biggest structural gap.
- Frontend has `swr` installed but the actual data-fetching path is a
  hand-rolled `ApiClient` — worth resolving one way or the other rather
  than growing both patterns in parallel.
- Deployment target ambiguity (Netlify config vs. Vercel-recommended
  README) should be resolved with the founder rather than assumed.
- No root-level workspace tooling — frontend/backend are two independent
  npm projects; fine at this size, worth revisiting if the codebase grows
  a third package (e.g. a worker or shared types package).

## Major TODOs (grounded in the gaps above)

1. Decide and document the actual deployment target(s) — founder decision.
2. Add `.env.example` files for both `frontend` and `backend` (safe,
   non-destructive documentation work — good first task to validate this
   operating system, see the end of this task's final report for the
   suggested next prompt).
3. Stand up a minimal test runner (even a handful of smoke tests) before
   any large feature work, so QA has something automated to lean on.
4. Scope roommate profiles as new feature work (schema + auth model +
   Trust & Safety + Legal review) before implementing — do not bolt it onto
   the existing `Listing` model without a deliberate design pass.
