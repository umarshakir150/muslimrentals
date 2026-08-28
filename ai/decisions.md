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
