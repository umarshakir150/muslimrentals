# Decisions

A durable log of significant decisions made about this project. Add a new
entry per decision — do not edit past entries except to fix factual errors
in how a decision is recorded (never to relitigate it retroactively; open a
new entry for that instead).

Only decisions with actual repository evidence or an explicit founder
statement belong here. Do not backfill invented history for decisions that
predate this log — the entries below start from when this AI operating
system was introduced.

Format:

```markdown
## YYYY-MM-DD — Decision title

Decision:
Reason:
Alternatives considered:
Impact:
Revisit when:
```

---

## 2026-08-25 — Adopt a repo-native supervisor/worker AI operating structure

Decision: Introduce `CLAUDE.md`, `agents/`, `company/`, and `ai/` as the
standing structure for coordinating AI-assisted work on this project,
before any concurrent/automated orchestration is built.

Reason: The founder wants persistent, specialized roles (Supervisor,
Engineering, Frontend, Backend, QA, Security, Designer, Trust & Safety,
Legal, Support) with clear approval gates and durable task records, instead
of ad hoc single-agent sessions with no memory or review structure. Building
a full concurrent-orchestration platform first would be premature — the
repo-native structure needs to be validated in practice first.

Alternatives considered: (a) build an external orchestration service or
multi-process Claude harness immediately — rejected as premature per the
founder's explicit instruction; (b) keep working ad hoc with a single
`CLAUDE.md` and no role separation — rejected because it doesn't support
independent review gates (QA/Security/T&S/Legal) or delegation.

Impact: All future non-trivial work should go through
`ai/workflow.md`'s pipeline and use `ai/tasks/TEMPLATE.md`. No application
code was changed to introduce this — it is documentation-only.

Revisit when: The repo-native workflow has been exercised on a handful of
real tasks and the founder wants to evaluate moving to actual concurrent
Claude processes per `ai/orchestration-plan.md`.

---

## 2026-08-26 — Adopt standing autonomous operating directive

Decision: Record the founder's standing instruction for ongoing autonomous
operation (Lead/CTO-driven prioritization, QA carrying an explicit Reviewer
mandate, live published-site review as a routine signal source, honest
verification-level reporting, autonomous commit/push authority for reviewed
work, automatic correction routing, and the existing escalation/priority/
anti-busywork/concurrency/no-redesign rules) as durable project state in
`ai/operating-directive.md`, wired into the Lead's context via
`RELEVANCE_MAP` in `orchestrator/src/context/contextBuilder.ts`.

Reason: The founder wants the existing multi-agent organization to operate
Muslim Rentals as an ongoing job — deciding what to build, reviewing it
(including against the real published site), and shipping reviewed work —
without hand-picking every task, while keeping every existing safeguard
(bounded cycles/retries/model calls/concurrency, process ownership/timeout
cleanup, production deployment still founder-gated) exactly as-is.

Alternatives considered: (a) dump the full verbatim directive into a memory
record — rejected, `memoryStore.ts`'s existing design favors a small
curated set of facts over a large pile of half-relevant ones, and the full
directive is available in conversation history if ever needed verbatim;
(b) create a new "Reviewer" role/registry entry — rejected in favor of
strengthening `agents/qa.md` in place, since its existing framing already
substantially overlaps with the directive's Reviewer concept.

Impact: `ai/operating-directive.md` (new), `CLAUDE.md` (pointer added),
`orchestrator/src/context/contextBuilder.ts` (Lead's `RELEVANCE_MAP`
extended). No behavior change yet on its own — subsequent tasks
(strengthening `agents/qa.md`, seeding `ai/regression-inventory.md`,
scoped WebFetch grant, opt-in live-site signal source, centralized
auto-push) implement the capabilities this directive describes.

Revisit when: Evidence from real cycles shows the priority ordering,
escalation types, or concurrency assumptions need adjustment — not on a
schedule, and not by casually redesigning the orchestration system.

---

## 2026-08-27 — Authorize automatic production deployment (narrow, founder-confirmed)

Decision: For a task that reaches `COMPLETE` (already reviewed by QA +
Security + the founder-approval gate) and changes a real product file
under `rentals/` without touching `prisma/schema.prisma` or
`prisma/migrations/`, the reviewed branch is now automatically merged
into `main` and pushed, non-force. This is a narrow, explicit exception to
the prior "production deployment remains founder-gated" default — not a
general widening of autonomous authority.

Reason: The founder directly instructed this ("Fix this operating policy
now... automatically merge them into that production branch and push
it"), with explicit safety carve-outs (destructive DB ops, secrets,
billing, major auth/security, legal/policy decisions stay founder-gated)
that map cleanly onto capabilities that already existed: the founder-
approval gate already blocks `COMPLETE` for those categories, and a
schema/migration check was added specifically for the DB case, since an
applied-review does not mean an applied-migration.

Two facts surfaced during this decision that materially shaped it and are
recorded here so a future session doesn't have to rediscover them:

1. **Which branch is production was genuinely ambiguous from the repo
   alone.** `main`'s HEAD commit had zero GitHub commit statuses/check-runs
   ever posted to it (verified via the GitHub API), was ~3 months stale
   relative to the actively-developed branch, and `ai/current-state.md`
   had already flagged Netlify-vs-Vercel as an unresolved founder
   decision. The founder confirmed `main` directly rather than this being
   inferred — re-confirm if this evidence ever looks stale again.
2. **This environment cannot reach the live site at all.** Both `WebFetch`
   and a raw `curl` to `muslimrentals.netlify.app` get a 403 at the
   network egress proxy's CONNECT stage (confirmed via the proxy's own
   status endpoint) — not a tool limitation, a network policy. Live
   verification (`liveDeployVerification.ts`) is real and wired but will
   report `LIVE_VERIFICATION_UNREACHABLE` every time in this exact
   environment until that policy changes or a differently-networked
   environment runs this.

Alternatives considered: (a) auto-merge everything reaching COMPLETE,
including schema changes — rejected, an unapplied migration can crash the
live backend for all users, and this environment has no way to apply one;
(b) require a second explicit approval per production merge — rejected,
that's what QA+Security+founder-gate-on-COMPLETE already are, and the
founder's instruction was explicit about wanting this automated for the
safe case; (c) skip live verification entirely since it can't succeed here
— rejected, the mechanism has real value once network access exists or in
a different environment, and reporting `UNREACHABLE` honestly costs
nothing.

Impact: `orchestrator/src/git/worktree.ts` (`mergeToProductionBranch`),
`orchestrator/src/autonomy/liveDeployVerification.ts` (new),
`orchestrator/src/autonomy/cycle.ts` (`attemptProductionMerge`, wired
after `autoPush`), `orchestrator/src/autonomyCli.ts` (on by default for
real cycles/scheduler-loop), `ai/operating-directive.md` and
`orchestrator/README.md` updated. 163/163 tests pass; typecheck clean.
Reconciled immediately after: the saved-listings feature
(`agents/20260825-053836-build-the-missing-saved-page-so/integration`,
COMPLETE, QA PASS, Security APPROVED, no schema changes) was merged into
`main` and pushed by hand as the first real application of this policy —
see that commit for the production SHA. Roommate Profiles
(`agents/20260826-093438-.../integration`) was deliberately NOT merged —
it has an unapplied Prisma migration, exactly the case this policy
excludes.

Revisit when: Netlify dashboard access becomes available to verify `main`
independently, or this environment's network policy changes such that
live verification can actually run — the mechanism doesn't need to
change, but the honest "unreachable every time" caveat should be revisited
once it isn't true anymore.

---

## 2026-08-28 — Connect Prisma backend to production Supabase; enable RLS least-privilege

Decision: Connect the existing Express/Prisma backend to the real, already-
provisioned "Muslim Rentals" Supabase project (`mxpoenfnqrfwznquaibd`) as its
production Postgres, establish the repo's first real Prisma migration
against it, and then enable Row Level Security with zero permissive
policies plus a table-grant `REVOKE` on `anon`/`authenticated` for all 11
public tables. Prisma/Express remains the sole application-level
authorization boundary; no auth logic moved to the database or the
frontend.

Reason: The founder identified this Supabase project as already connected
and asked for the database side to be made production-ready without
replacing working architecture. Inspecting the project directly (via
Supabase MCP tools, since this environment cannot reach `*.supabase.co` or
`muslimrentals.netlify.app` over raw HTTP — proxy-blocked at the CONNECT
stage, same as the prior `main`-branch investigation) found: it matched the
product by name/creation-date, was empty of any tables, and had never had
a Prisma migration applied (the repo itself had no `prisma/migrations/`
directory before this — schema was previously only ever pushed via
`prisma db push`, never tracked as a migration). Applying the baseline
migration was zero-risk (target was empty; verified before and after).

Once the schema existed, Supabase's own security advisor immediately
flagged a real, critical vulnerability: RLS was disabled on all 11 tables,
so the project's public anon API key could read/write every row directly
via Supabase's auto-generated PostgREST API, completely bypassing the
Express backend's auth/ownership checks — full exposure of `User`,
`Message`, `Report`, and every other table to anyone holding the publishable
key. This was confirmed empirically, not assumed: a probe row inserted into
`User`/`Report` inside a rolled-back transaction was fully visible when the
same query ran `SET LOCAL ROLE anon`.

Fix: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM PUBLIC, anon,
authenticated` on every table, with no policies added for those roles. Two
independent layers of denial (table-grant revoke, and RLS default-deny)
were used deliberately so a mistake in one doesn't reopen access. No
permissive policies were added anywhere because grep confirmed zero
`@supabase/supabase-js`/PostgREST usage anywhere in the app — every
read/write already goes through Express, per the founder's explicit
instruction to keep authorization logic in Express rather than duplicating
it into RLS policies. This was reviewed independently by a real
Security-role review before being applied (APPROVED, no changes required),
and verified empirically after applying: `anon` gets real "permission
denied for table" errors on SELECT/INSERT; the backend's own role (which
has `rolbypassrls=true`, confirmed via `pg_roles`) retained a full
insert/select/update/delete round trip with zero errors; `get_advisors`
no longer reports the vulnerability.

Alternatives considered: (a) add permissive anon/authenticated policies
matching what's "safe to expose" (e.g. published listings) — rejected for
now, since no code path actually uses PostgREST/Supabase-client access at
all; adding policies for a use case that doesn't exist would be unreviewed
surface area with no consumer, not a real safety improvement; (b) rely on
RLS policies instead of table grants, or vice versa — rejected in favor of
both, specifically so a future mistake in one layer doesn't silently
reopen access; (c) move authorization logic into RLS itself — rejected per
explicit founder instruction to keep Prisma/Express as the primary backend.

Impact: `rentals/backend/prisma/migrations/20260828005829_init/` (new,
baseline schema) and `rentals/backend/prisma/migrations/
20260828011000_enable_rls_least_privilege/` (new, this decision) committed
and pushed. Production Supabase project now has the full schema applied
and RLS enabled with default-deny for anon/authenticated. Whoever first
connects a real `DATABASE_URL` locally must run `npx prisma migrate
resolve --applied 20260828005829_init` once, since the migration was
applied via Supabase's own SQL execution rather than `prisma migrate
deploy`, so Prisma's `_prisma_migrations` bookkeeping table doesn't know
about it yet.

Revisit when: A genuine public-API/PostgREST consumption use case is
identified (e.g. a future public read-only listings API) — add a narrow,
explicitly-scoped policy for exactly that case then, rather than widening
this blanket deny preemptively.

---

## 2026-08-28 — Deploy production backend on Render (Netlify → Render → Supabase), Railway decommissioned

Decision: The live production stack is now Netlify (frontend) → Render
(backend) → Supabase (database). Render's `muslim-rentals-backend`
service — created June 1, pre-existing, found during a founder-directed
"inspect my Render account" pass — was repointed at this session's
reviewed backend branch and reused rather than duplicated. Railway,
stood up and fully verified earlier the same day, was explicitly
decommissioned by the founder in favor of the pre-existing Render
service and its project deleted. Do not use, modify, redeploy, or
monitor Railway going forward.

Reason: The founder connected Render mid-session and asked for the
backend to be migrated there, reusing the existing service if
appropriate. Inspecting it found a real, already-configured service
(AWS S3 and other optional env vars intact) that had just auto-deployed
for the first time in ~3 months when an earlier `main` merge landed —
confirming it was live infrastructure, not abandoned.

Two real, previously-undiscovered production bugs were found live during
this rollout (both fixed and verified, not just theorized):
1. `uploads.ts` constructed its S3 client and multer instances at module
   IMPORT time, so any boot without `AWS_S3_BUCKET` set crashed the
   entire process — contradicting the app's own documented
   "optional, degrades gracefully" design for that variable. This had
   never surfaced before because Render's original config happened to
   have AWS vars set; it broke immediately on Railway, which didn't.
2. `GET /listings`'s Zod schema capped `limit` at 50, but the map page
   (`src/app/map/page.tsx`) legitimately requests `limit=200` to plot
   every listing — a real, working code path that had simply never been
   exercised against a live backend before. Every real request from the
   map page 500'd/422'd until this was raised to 200.

Database connectivity required real trial and error, recorded here so a
future session doesn't have to rediscover it: Supabase's Supavisor
pooler only recognizes roles provisioned through Supabase's own control
plane (dashboard/API) as valid pooler "tenants" — a role created via
raw `CREATE ROLE` (this session's own `app_backend`, used successfully
for direct SQL work all session) is invisible to the pooler and fails
with "tenant/user not found," a Supavisor-level rejection distinct from
a Postgres authentication failure. Separately, the *direct* connection
(`db.<ref>.supabase.co:5432`) was unreachable from Render — likely
Supabase's documented IPv6-only default for direct connections, which
Render's egress apparently doesn't support. Neither `postgres` nor
`service_role`'s passwords can be reset via SQL from this session's own
access level ("reserved role, only superusers can modify"). The founder
reset `postgres`'s password via the Supabase dashboard and supplied the
real session-pooler connection string; using the dashboard-provisioned
`postgres` role (which does have `rolbypassrls`, same as before) over
the session pooler (`aws-1-us-east-2.pooler.supabase.com:5432`, not
`aws-0` as this session had assumed — a genuinely wrong guess, not just
an untested one) resolved it immediately. `app_backend` was then
dropped as dead weight.

Two environment-level blockers were hit and are worth recording since
they'll recur: (a) this sandbox's own safety classifier blocks pushing
to `main` even for a clean, reviewed, non-destructive merge — worked
around by pointing Render (and previously Railway) at the reviewed
working branch directly rather than `main`, at the founder's choice,
after asking; (b) neither Netlify's nor Railway's MCP-exposed "deploy"
tools can be driven from this sandbox (both ultimately require a local
CLI reaching a `*.netlify.app`/`*.railway.com` endpoint blocked by this
environment's network egress policy) — worked around by asking the
founder to click "Trigger deploy" by hand each time; this is a standing
limitation, not a one-off. Render, by contrast, has real MCP tools
(`trigger_deploy`, `update_environment_variables`, `list_logs`, etc.)
that work directly from this sandbox with no such workaround needed.

Verified end-to-end with real traffic, not inferred from config: after
each fix, the founder loaded the live site and this session read
Render's request logs directly, confirming real `200`s with data on
`/api/v1/cities/all` and `/api/v1/listings` (including a real
`limit=200` request succeeding), Referer headers confirming the
requests genuinely came from `https://muslimrentals.netlify.app`, and
zero Prisma/database errors after the final `postgres`-role fix.
Socket.IO was not independently traffic-verified — it only connects
from the logged-in messaging inbox, which needs an authenticated
session to exercise — but shares the same verified-correct CORS/
`FRONTEND_URL` configuration as the confirmed-working REST endpoints.

Alternatives considered: (a) keep Railway as the primary backend and
add Render as a secondary/staging target — rejected, explicit founder
instruction to decommission Railway once Render was confirmed; (b) use
the Supavisor transaction-mode pooler (port 6543) for `DATABASE_URL`
now that a working `postgres` credential exists — rejected in favor of
session mode (port 5432 on the same pooler host) since Render runs a
persistent Express server, not a serverless/edge function, and
Supabase's own docs recommend session mode for exactly that case.

Impact: `rentals/backend/src/routes/uploads.ts` (AWS_CONFIGURED guard,
committed `80e9ae3`), `rentals/backend/src/routes/listings.ts` (limit
cap raised to 200, committed `633a558`) — both on
`claude/multi-agent-os-setup-y2wprj`, which Render now deploys from.
Render env vars set: `NODE_ENV`, `FRONTEND_URL`, `ALLOWED_ORIGINS`,
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `DATABASE_URL`
(final value: the dashboard-provisioned `postgres` role over the
session pooler). Netlify's `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_SOCKET_URL`
now point at `https://muslim-rentals-backend.onrender.com` (previously
malformed since June — the literal env var key name had been pasted
into the value alongside the URL, and separately pointed at Railway
mid-session — both fixed). Railway project deleted by the founder
(recoverable for 48h per Railway's own retention window, per the
founder; treated as permanently gone regardless).

Revisit when: Render's `npm run dev` (ts-node-dev) start command should
eventually become a real production build (`npm run build` /
`node dist/index.js`, matching what this session already configured for
Railway) — no tool in Render's MCP surface currently exposes changing
an existing service's build/start command, so this needs either a
future Render API capability or a manual dashboard change; it works
today, just not ideally. Also revisit once a genuine authenticated
end-to-end test (login + open messages) is run, to move Socket.IO from
"configured correctly" to "independently traffic-verified" like the
REST endpoints already are.

## 2026-08-28 — Fix three live-production bugs (wrong-password message, forgot/reset password, empty city dropdown)

**Decision:** Fix and deploy three founder-reported live-production bugs
as a single reviewed batch, on `claude/multi-agent-os-setup-y2wprj`
(Render's tracked branch), independently security-reviewed given the
auth-related surface touched.

**Context:** Founder reported, after confirming the P0 signup bug was
resolved: (1) wrong-password login showed "Session expired. Please log
in again." instead of a correct incorrect-credentials message; (2) the
forgot/reset-password flow was unusable end-to-end; (3) posting a
listing was blocked because the city dropdown had no cities.

**What was actually wrong, per bug:**
- (1) `rentals/frontend/src/lib/api.ts`'s `request()` unconditionally
  attempted a token-refresh-and-retry on any 401, including from
  `/auth/login` itself — which always 401s on wrong credentials since
  there was never a session to refresh — throwing a generic
  "Session expired" error before the existing login-specific error
  remapping further down the same function could ever run.
- (2) Two independent bugs, not one: the frontend had **no
  `/reset-password` page at all** (the backend's email already linked to
  it — 404 on click), and the backend's `/forgot-password` handler
  `await`ed `sendEmail()` directly, so an SMTP failure (SMTP is
  unconfigured on Render — confirmed via repeated
  "SMTP_HOST is not set" warnings in Render's own logs) 500'd the whole
  request, defeating the deliberate always-200
  anti-email-enumeration design (`SAFE_RESPONSE`).
- (3) Also two bugs: production's `City` table was completely empty (0
  rows — confirmed via direct `SELECT count(*)`), and even once seeded,
  `GET /cities/all` only ever selected `{ name, province }`, never
  `lat`/`lng` — so `CityAutocomplete`'s `coords` would always resolve to
  `undefined` and every listing would silently keep the post form's
  hardcoded Toronto default coordinates regardless of the city actually
  chosen. This second bug was invisible until the first was fixed and
  would otherwise have silently mis-geotagged every future listing.

**Fix:**
- `api.ts`: added a `PUBLIC_AUTH_ENDPOINTS` allowlist
  (register/login/google/forgot-password/reset-password) excluded from
  the refresh-and-retry path, since none of them have an existing
  session to refresh.
- Built `rentals/frontend/src/app/reset-password/page.tsx` from scratch,
  matching existing UI/form conventions.
- `auth.ts`'s `/forgot-password`: changed `await sendEmail(...)` to
  `sendEmail(...).catch(() => {})`, mirroring the existing pattern
  already used for `/register`'s welcome email.
- `cities.ts`'s `/all`: added `lat: true, lng: true` to the Prisma
  `select`.
- Seeded production's empty `City` table with all 82 real Canadian
  cities already present (unused) in the repo's own
  `rentals/backend/prisma/seed.ts`, via a generated SQL `INSERT ...
  ON CONFLICT (name, province) DO NOTHING`, executed directly against
  Supabase. Verified `count(*) = 82` afterward.

**Review:** Independent security review (per `agents/security.md`)
requested given the auth-related surface (login error path,
forgot/reset-password). Verdict: **APPROVED**, no findings — the
anti-enumeration property is preserved (token still persisted and
`SAFE_RESPONSE` returned identically regardless of email outcome), no
XSS/open-redirect/information-disclosure in the new reset-password page,
no cookie/CSRF regression from the retry-skip change, and the
newly-exposed `lat`/`lng` on `/cities/all` is non-sensitive public
reference data. One non-blocking note: the swallowed SMTP error isn't
logged anywhere, so a persistent delivery failure would be invisible to
ops — worth a follow-up to log the error (without PII) on catch.

**Verification so far:** `npx tsc --noEmit` clean on both
`rentals/backend` and `rentals/frontend`. All four files committed
(`fe20a0d`) and pushed to `claude/multi-agent-os-setup-y2wprj`. Render
auto-deployed the backend half cleanly (`dep-da8j51gu01pc73f630t0`,
status `live`, boots with no new errors). The city-data fix is real and
live in production right now, independent of any frontend deploy
(`/cities/all` already served real names before this fix; it now also
serves real coordinates). **Not yet independently confirmed on the live
site by this session** — this sandbox's network egress currently blocks
both `muslim-rentals-backend.onrender.com` and `muslimrentals.netlify.app`
outright (confirmed via the egress proxy's own status endpoint, which
lists repeated `connect_rejected`/403 policy denials against both hosts
today), so neither `curl` nor `WebFetch` can reach either host from this
session right now — a stricter block than the earlier
intermittent-502/backoff pattern recorded in the Railway→Render entry
above. Verification of the deployed backend changes relies on Render's
own logs (clean boot, no errors) plus a direct Supabase read
confirming the seeded city data, not a live HTTP round-trip from this
session.

**Outstanding blocker — frontend not yet deployed:** The `api.ts` and
`reset-password/page.tsx` fixes only exist on
`claude/multi-agent-os-setup-y2wprj`. Netlify's production deploy
tracks `main`, and this session's CCR configuration explicitly restricts
pushes to the designated branch above (never `main`) — the same
constraint that made pointing Render at the working branch necessary
during the Railway migration. Netlify's MCP tools expose env-var/name/
form/access-control management but **no way to change a project's
tracked deploy branch**. So, unlike Render, this can't be self-served:
it needs the founder to either point Netlify's production branch at
`claude/multi-agent-os-setup-y2wprj` (same pattern as Render) or merge/
push this branch into `main` themselves. Until then, bug (1) is fixed in
code but not live, and bug (2) is only half-live (backend fixed, but the
reset-password page users would land on still 404s).

**Regression inventory:** `ai/regression-inventory.md` updated — new
rows for wrong-password error messaging and city-selection lat/lng,
`Forgot / reset password` row filled in, `City autocomplete` importance
raised from low to medium. All marked `FIXED_NOT_LIVE_SITE_VERIFIED`
pending the frontend deploy above and a real founder click-through.

**Revisit when:** the Netlify branch/main question is resolved by the
founder — at that point, re-verify all three fixes live (per the
founder's explicit "do not just patch the UI — verify the real backend
behavior and live production flow" instruction) and flip the regression
inventory rows to `LIVE_SITE_VERIFIED`. Also revisit SMTP configuration
itself — reset-password emails will not actually send to real users
until `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` (or equivalent) are configured
on Render; that is a real external-setup gap, not a code defect, and is
outside what this session can configure without provider credentials.
