# Current State

Last verified against the repository: 2026-09-09. **`main` and production
are decoupled again, deliberately — but this is ONE pending deploy, not
several.** Production Netlify (deploy `6a972323ac04d013c488bc29`,
published 2026-09-01 19:16:20Z) is still serving commit `49d4bb7` — the
multi-feature milestone (Gallery/lightbox, Settings/Account, Messaging,
Legal/Policy Pages, Forgot Password + Change Email). `main` has since
advanced through PR #7 (report-a-user/report-a-message, merged
2026-09-02, commit `c771c07`), PR #8 (admin Remove/Restore Listing,
ADMIN-only permanent account deletion, ADMIN-only User Search, merged
2026-09-03, commit `83ff9417`), PR #9 (Locate Me, privacy-safe
approximate listing locations, the universal confirm-property-location
flow, and a Spiderfy fix, merged 2026-09-05, commit `87d23a7`), and PR
#10 (fixes the report qualifying-interaction evidence contract mismatch
from PR #9's Trust & Safety follow-up, merged 2026-09-06, commit
`f8c20c4`) — see `ai/decisions.md` for all four. **Re-verified 2026-09-09:
each of these four PRs' merge commits is a real ancestor of `main`'s
current head** (`git merge-base --is-ancestor` against each PR's head
SHA, not just trusting GitHub's "merged" label) — their code, and PR
#21's fixes once that merges too, are simply what `main` already
contains; there is no separate deploy tracked per PR. That combined work
is implementation-complete, founder-approved via its own Netlify Deploy
Previews, merged to `main`, its schema migrations are live on the
production Supabase database, and the Render backend is deployed and
healthy on it — but **the production Netlify frontend has not been
redeployed to pick any of it up**, at the founder's explicit request: one
single accumulated production deploy is being saved for whatever `main`
HEAD is the intended final release point, rather than deploying each PR
as it merges. Until that one deploy happens, do not describe
report-a-user/message, the admin moderation toolkit, the location/privacy
work, or the qualifying-interaction evidence below as "in production" —
they are real and live in `main`/Render, not yet on `muslimrentals.ca`.
**PR #21** (Browse place/address search + radius, see its own section
below) is QA-cleared, Security-approved, and merge-ready as of
2026-09-09, but not yet merged — once the founder merges it, its code
becomes exactly the same kind of "on `main`, awaiting the one accumulated
deploy" work as PR #7–#10 above, not a new separate deploy item either.
Update this file whenever the picture materially changes — don't let it
drift into fiction.

## Tech stack

- **Frontend:** Next.js 14.2 (App Router), React 18, TypeScript, Tailwind
  CSS, Radix UI, Zustand, Leaflet, Socket.IO client, react-hook-form + zod.
- **Backend:** Express 4, TypeScript, Prisma 5, PostgreSQL, Socket.IO
  server, JWT + Google OAuth, S3-compatible storage, Resend (transactional
  email, via HTTPS API — Gmail SMTP from this backend timed out on ports
  587 and 465, so the transport was switched to Resend).
- Full breakdown: `company/architecture.md`.

## Current working features

- Listing CRUD (create/edit/soft-remove by owner or admin/moderator),
  browse/filter/search/sort/paginate, map view, save/unsave, report.
- Real-time messaging per listing conversation, with typing indicators and
  read receipts.
- Email/password and Google OAuth registration/login, JWT refresh rotation,
  forgot/reset password, and change-email (both with real, verified
  transactional email delivery via Resend).
- Admin panel — **live in production**: stats, user search, ban/unban,
  role change, listing soft-removal, report triage (listings only).
  **Merged to `main` + Render, NOT yet in production** (see the note at
  the top of this file): reporting a listing, a user, or a message
  directly (server-enforced reason taxonomy per target type, a required
  prior-interaction gate for user reports); the admin Reports panel
  branching on target type (listing/user/message) with per-report
  Restrict-from-messaging and messageSnapshot retention policy; a
  moderation audit trail (who/when/why) plus Restore on listing removal;
  ADMIN-only permanent account deletion, distinct from ban; and the
  ADMIN-only directory-search-driven User Search section itself (the
  production user search above is the older, simpler admin/moderator
  search, not this one).
- Static policy pages: Safety, Terms, Privacy, Content & Community
  Guidelines, Contact.
- User-initiated account deletion (Settings), anonymizing rather than
  hard-deleting to preserve other users' shared conversation history.
- Seeded reference data: mosques and Canadian cities.
- **Merged to the Render-tracked backend branch, NOT yet in `main`/
  production** (open as PR #21, see its own section below): Browse's
  location-radius search now resolves POIs/buildings/businesses/schools/
  landmarks/neighbourhoods/cities (Nominatim) and full street addresses
  (Geocodio, with real rooftop/approximate precision) via manual Search/
  Enter, independent of autocomplete suggestions; search radius now goes
  down to 0.5km (was 1km); an embedded mini-map previews the searched
  point/radius/listings inline.

## Incomplete / not-yet-built features

- **Roommate profiles and roommate matching** — mentioned in the product
  vision but not implemented anywhere in the codebase (no schema, no
  routes, no UI). See `company/product.md`.
- **Push or digest email notifications** — only transactional email exists.
- **Payments/monetization** — not built, not currently planned.

## PR #21 — Browse place/address search + radius (QA-cleared, merge-ready, not yet merged)

**Status (2026-09-09): implementation-complete, founder browser-QA-passed
on Deploy Preview #21, formally QA-cleared and Security-approved, backend
already live and verified on the shared Render-tracked branch — merge-ready,
but deliberately not yet merged to `main` pending the founder's explicit
merge approval.** Two rounds of independent QA re-review each caught a
real, narrow gap in the address-shaped-query fallback logic added late in
this PR (a numbered-POI query like "24 Hour Fitness" being misrouted to
Geocodio with no fallback, then a follow-up fix that fell back to
Nominatim too broadly for a Geocodio-rejected coarse match) — both were
fixed with the smallest possible change and re-verified by a third,
independent QA pass, which also adversarially reverted the fix in a
scratch edit to confirm the regression tests actually catch the bug
before reporting PASS. Security separately reviewed and approved the
whole feature with no findings. See `ai/decisions.md`'s 2026-09-08/09
entry for the full round-by-round history (a release-blocking Render
outage and diagnostic rollback midway through, root-caused as
unconfirmed/likely infrastructure rather than this PR's own code; the
search-ranking and geocoding work itself; both QA-fix rounds). Current
architecture:

- **Autocomplete/place suggestions** (`GET /geocode/suggestions`,
  `searchPlaces()`): unchanged from the original design — always Nominatim
  (no API key, free), Canada-only, locally re-ranked so POI/place names
  aren't crowded out by address-line or road matches, soft per-category
  diversity capping.
- **Manual Search/Enter** (`GET /geocode/resolve`, `resolvePlace()`): a
  full street address (a leading house number) now resolves via Geocodio
  — the same provider/key already used for listing-creation geocoding, no
  new credential — with real precision handling:
  `rooftop`/`point`/`nearest_rooftop_match` → exact;
  `range_interpolation`/`street_center` → accepted and returned, tagged
  `precision: 'approximate'` (surfaced in the UI as "(Approximate
  location)"); `place`/`state`/non-Canadian → rejected as
  "Location not found" rather than silently placing a misleading marker.
  Everything else (POI/building/business/school/landmark/neighbourhood/
  city text) still resolves via the same Nominatim pipeline the dropdown
  uses. The listing-creation address pipeline's own (stricter) precision
  grading is untouched by any of this.
- **Radius**: 0.5km–10km (was 1–10km), inclusive distance filtering
  unchanged. Mini-map preview unchanged.
- 588 backend / 388 frontend tests passing, `tsc --noEmit` and production
  build clean on both stacks, at the PR's current head.

**Outstanding before merge — not a code defect, a policy/ToS constraint:**
autocomplete still runs on the public Nominatim instance
(`nominatim.openstreetmap.org`), which is free but usage-policy-restricted
(not licensed for sustained production autocomplete traffic at real
scale). This was flagged explicitly during this PR's own design phase and
remains unresolved and undecided — see `ai/decisions.md` for the full
provider-options research (Google Maps Platform evaluated and its exact
Cloud setup steps documented, pending founder's own manual provisioning;
Geocodio confirmed to have no general place/POI-search product) — a
separate decision from, and not blocking on, the address-geocoding fixes
in this PR. Founder has not yet decided whether/when to migrate off
Nominatim for this feature.

**Not merged, not deployed to production:** PR #21 remains open; `main`
and production Netlify are untouched by it. Merging is the founder's own
explicit decision to make (not automatic on a passing review), and once
merged this becomes ordinary `main` content awaiting the same single
accumulated production deploy described at the top of this file — not a
new, separate pending-deploy item of its own.

**Revisit when:** the founder decides on the Nominatim migration question
and/or explicitly approves merging PR #21.

## Testing status

**Vitest test suites exist and are actively maintained on both sides** —
578 backend tests (`rentals/backend/tests/`) and 388 frontend tests
(`rentals/frontend/src/**/*.test.tsx`), run via `npm test` in each
package. `type-check` (`tsc --noEmit`) and `lint` scripts also exist on
both sides. There is still **no CI** enforcing any of this automatically
on every push/PR (see "Security posture" below) — tests are run manually
before each PR/port, not gated by GitHub Actions or equivalent. Until CI
exists, treat "the suite passes locally" as necessary but not sufficient;
don't skip manual/QA verification because automated tests exist now.

## Deployment status

**Live in production** (as of 2026-08-28, founder-directed): frontend on
Netlify (`muslimrentals.netlify.app`), backend on Render
(`muslim-rentals-backend`, a pre-existing service from June repointed to
deploy from the `claude/multi-agent-os-setup-y2wprj` branch),
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

**Netlify's production auto-deploy has been OFF since 2026-09-01**
(founder's own action, a Netlify project setting — see
`ai/operating-directive.md`'s "Milestone release workflow" section). This
is why merging a PR into `main` no longer moves production forward on its
own: `main` is the reviewed baseline that PRs build on, and production
only advances when the founder explicitly triggers a deploy from a chosen
`main` HEAD. **No session may ever change this setting** (auto-deploy
toggle, production branch, or any other Netlify site/deploy config) —
confirm it's still off before assuming so, rather than assuming it stays
off indefinitely, and never toggle it. This is the mechanism behind the
"one final accumulated deploy" framing at the top of this file and in
`CLAUDE.md`'s standing status flag — it is not a manual reminder someone
has to keep re-applying, it is how the Netlify project is actually
configured right now. The Render backend is unaffected by this — it has
no equivalent preview/gating mechanism and continues to auto-deploy from
its tracked branch as described above.

**Resolved — outbound email is configured and working.** Transactional
email (password reset, change-email confirmation, welcome email) is sent
via Resend's HTTPS API on the verified `muslimrentals.ca` domain.
Gmail SMTP was tried first and abandoned — connection attempts from this
app's Render backend to Gmail's SMTP timed out on both port 587 and 465
(raw TCP stage, never reaching STARTTLS/AUTH). This is confirmed only
against Gmail's SMTP specifically, not proven to be a categorical block
of all outbound SMTP from Render — so the transport was switched to
Resend's HTTPS API, which sidesteps whatever caused that timeout, and
real delivery was verified. The `SMTP_HOST`/`SMTP_PORT`/
`SMTP_USER`/`SMTP_PASS` env vars are dead and no longer read by any code
(`src/utils/email.ts` now uses `RESEND_API_KEY` + `EMAIL_FROM` only) —
safe to remove from Render whenever convenient. Both Forgot Password and
Change Email were founder-verified end-to-end on PR #6's Netlify Deploy
Preview (delivery, link validity, single-use enforcement, and correct
post-change auth behavior) before merge. See `ai/regression-inventory.md`'s
"Forgot / reset password" and "Change email" rows and `ai/decisions.md`'s
2026-09-01 Resend entries for the full history, including a Resend API
key that returned 401 "API key is invalid" and had to be rotated before
delivery actually worked.

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

- No CI — Vitest suites exist on both sides (see "Testing status" above)
  but nothing enforces them automatically on push/PR. Still the biggest
  structural gap.
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
3. Wire the existing Vitest suites into CI (e.g. GitHub Actions) so they
   run automatically on every push/PR — the suites themselves already
   exist (see "Testing status" above); this is a pending founder approval
   (backlog item, security-architecture-approval-required per the
   autonomous orchestrator's own risk classifier).
4. Scope roommate profiles as new feature work (schema + auth model +
   Trust & Safety + Legal review) before implementing — do not bolt it onto
   the existing `Listing` model without a deliberate design pass.
