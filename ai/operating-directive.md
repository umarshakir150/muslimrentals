# Standing Autonomous Operating Directive

This is the durable, distilled record of the founder's standing instruction
for how the autonomous team operates Muslim Rentals as an ongoing job,
rather than waiting to be told what to build each time. It supplements —
never overrides — `CLAUDE.md` (founder authority, ground rules) and
`ai/workflow.md` (the required review pipeline). Where anything here seems
to conflict with those, `CLAUDE.md` wins and the conflict should be flagged
rather than silently resolved.

Full verbatim directives live in the conversation history that produced
this file; this is the operational summary every cycle should actually act
on. See `ai/decisions.md` for the record of when this was adopted.

## Standing objective

Continuously make Muslim Rentals the best safe, trustworthy, functional,
polished MVP possible — using the existing Lead/CTO + specialist-agent
organization to inspect the real product (code and, where safely possible,
the published site), decide priorities, implement, review, test, and ship
improvements through bounded autonomous cycles — without requiring the
founder to hand-pick every task.

## Organization

Lead/CTO owns quality, priorities, backlog, delegation, dependency and
conflict resolution, integration, completion criteria, and escalation.
Specialists (Product, Designer/UX, Frontend, Backend, QA, Security,
Trust & Safety, Legal, DevOps) do their real job through the real
agent/orchestration system — not simulated personas, not one process
pretending to sequentially be everyone.

QA (`agents/qa.md`) carries the "Reviewer" mandate: a skeptical senior
engineer who inspects the actual integrated result (code and, where
relevant, the running product), not self-reports; never approves its own
implementation; returns a binary verdict that routes `CHANGES_REQUIRED`
back for correction and re-review without founder involvement. It also owns
routine regression testing against a durable regression inventory
(`ai/regression-inventory.md`) with honest, non-fabricated verification
levels — never claim a runtime result that wasn't actually observed.

Security, Trust & Safety, Legal, and DevOps keep their existing
non-destructive / non-production / issue-spotting-only boundaries exactly
as defined in their role files and in `CLAUDE.md`.

## Live product as a signal source

`https://muslimrentals.netlify.app/` is a routine, ongoing observation
source for QA/Designer/Product where the relevant role has WebFetch access
scoped to that origin. Findings from it must be labeled by environment
(`PRODUCTION`/`PREVIEW`/`LOCAL`/`INTEGRATION_WORKTREE`) and must never be
reported as a "regression" for a feature that simply hasn't been deployed
to production yet.

## Standing role ownership (2026-08-28 update)

Beyond whatever a given cycle's task happens to be, these are continuous
responsibilities each specialist carries every cycle, not just when
explicitly assigned:

- **Frontend** continuously owns UI quality and usability across the whole
  product — not just the page a task touches.
- **Backend** continuously owns API and database reliability — request
  validation, error responses, query correctness, and production data
  integrity across the whole product.
- **Designer** continuously reviews UX, including the live site per
  `agents/designer.md`'s "Live product review."
- **QA/Reviewer** continuously challenges the whole product end to end,
  per the mandatory core-journey pass in `agents/qa.md`'s "Live product
  review" section — this is a required step every cycle and after every
  production deployment, not an optional extra.

## Post-deployment live verification and auto-escalation

After any change reaches production (via the auto-merge policy below or a
founder-driven deploy), the next cycle's QA pass must re-check the
specific journey(s) the change touched, in addition to its normal rotation
— see `agents/qa.md`. Any `BROKEN_FLOW` (or equivalent blocking finding)
discovered in `PRODUCTION` automatically becomes a priority-tier-2 ("Broken
core journeys") backlog item with full evidence, entering the next cycle's
candidate set without waiting for the founder to report it. This applies
regardless of whether the finding relates to the cycle's own task.

## Verification-level honesty (mandatory)

An agent may only report a live/browser/mobile-verified result if it
actually performed that check. Otherwise it must report the real level
achieved: `CODE_REVIEWED`, `TYPECHECKED`, `BUILD_VERIFIED`, `API_VERIFIED`,
`LOCAL_RUNTIME_VERIFIED`, `PREVIEW_VERIFIED`, or `LIVE_SITE_VERIFIED`.
Never convert an assumption into a test result.

## Autonomous commit + push authority

Work that has passed integration, QA/Reviewer, and Security (where
relevant) may be committed and pushed without asking the founder for each
instance, subject to the existing constraints already in force: no
force-push of shared/default branches, no destroying other work, no
overwriting unrelated branches, no bypassing branch protection, no silently
discarding conflicts.

## Production deploy policy (2026-08-27 update)

Muslim Rentals' live site is Netlify-deployed from GitHub branch `main`
in `umarshakir150/muslimrentals` — confirmed by direct founder
instruction, since the repo alone gave ambiguous evidence (see
`ai/decisions.md`'s entry for this date). For a task that reaches
`COMPLETE` (already passed QA + Security + the founder-approval gate on
its objective text) and whose branch was pushed:

- If it changed anything under `rentals/` (a real product change) and did
  **not** touch `prisma/schema.prisma` or `prisma/migrations/`, it is
  automatically merged into `main` and pushed, non-force. This is a
  standing, founder-granted exception to the general
  never-auto-deploy-to-production default — narrow and specific, not a
  general widening of autonomous authority.
- A schema/migration-touching change is **never** auto-merged, no matter
  how clean its review — a human must apply the migration against the
  real production database first. This still counts as "production
  deployment remains founder-gated" for that category.
- A real merge conflict or a rejected (non-fast-forward) push is reported,
  never force-pushed or auto-resolved.
- After a successful merge, one bounded live-site check attempts to
  confirm the change actually works at `https://muslimrentals.netlify.app/`.
  An unreachable site (this environment currently has a confirmed network
  policy blocking that domain) is reported as unverified, never as a
  passing or failing check — see `agents/qa.md`'s verification-honesty
  rule. A reachable-but-broken result is a real, escalated finding.

Full mechanism: `orchestrator/README.md` "Production deploy policy".

### Mandatory clean-install verification before any promotion to `main`

**Incident (2026-08-28):** a routine `npm install` (adding a devDependency)
resolved the transitive dependency `fastq` to `1.20.2` — a version published
to npm only hours earlier. This sandbox's own registry view already had it
cached/available, so every `npm ci` run in this session (including the
verification before the production-promotion merge) passed cleanly. Netlify's
build environment did not yet see that freshly-published version and failed
installation with `ETARGET` on the live production deploy. `npm ci` alone is
not sufficient to catch this class of bug — it validates that the lockfile
is internally self-consistent and fetchable *from wherever this session's
requests resolve*, not that every pinned version is actually available
*everywhere*, including the real production build environment.

**Required going forward, before any merge into `main`:**
- Run a genuinely clean install as part of verification — delete
  `node_modules` **and** the lockfile-adjacent local npm cache
  (`npm cache clean --force`), not just `node_modules`, then `npm install`
  from `package.json` to confirm the dependency tree still resolves the way
  the existing lockfile claims, followed by `npm ci` to confirm the
  (possibly regenerated) lockfile installs cleanly and deterministically.
  A fresh git worktree alone does not guarantee this — worktrees already
  lack `node_modules`, but a warm local npm cache can still mask the same
  registry-availability gap.
- Treat any dependency (direct or transitive) whose lockfile-pinned version
  was published to npm within roughly the last 48 hours as a promotion risk,
  not just a passing `npm ci`. Check with `npm view <pkg> time --json` when
  a lockfile was touched by an `npm install` (not `npm ci`) during the same
  session. Prefer pinning such a dependency to a known-stable, longer-published
  version via `package.json`'s `overrides` field rather than leaving it to
  float to "whatever is newest right now" — this is what fixed the `fastq`
  incident (`overrides: { "fastq": "1.20.1" }`), not a blind lockfile hand-edit.
- This check applies specifically to the **frontend** lockfile promotion path
  (Netlify builds directly from `main` via `npm install`/`npm ci` in its own
  environment), but the same reasoning applies to the backend/Render path.

## Automatic correction

Bugs, review pushback, security findings, UX findings, failing checks, or
integration conflicts route back to the responsible agent for a fix and
re-check automatically. Escalate to the founder only for a genuine
founder-level issue (see below) or when retries are exhausted.

## Escalation types

`FOUNDER_DECISION_REQUIRED`, `LEGAL_REVIEW_REQUIRED`,
`PRODUCTION_APPROVAL_REQUIRED`, `DESTRUCTIVE_ACTION_APPROVAL_REQUIRED`,
`SPENDING_APPROVAL_REQUIRED`, `SECURITY_ARCHITECTURE_APPROVAL_REQUIRED`,
`AMBIGUOUS_HIGH_IMPACT_PRODUCT_DECISION`, `RETRY_LIMIT_EXHAUSTED`,
`RECOVERY_REQUIRED`.

## Priority ordering (use judgment, don't apply blindly)

1. Critical security/privacy/safety
2. Broken core journeys
3. Serious bugs/data correctness
4. Launch-blocking missing functionality
5. Reliability/testing gaps unsafe for autonomy
6. Major UX/accessibility
7. Important MVP functionality
8. Technical debt materially affecting reliability
9. Performance
10. Visual polish
11. Speculative enhancements

## Anti-busywork

A successful cycle may conclude "no implementation is currently
justified." Don't invent low-value work, don't endlessly redesign working
pages, don't refactor stable code for style alone, don't rediscover issues
already resolved or already tracked — check the backlog and memory first.

## Concurrency

Run independent work concurrently whenever the existing safety machinery
supports it (dependency graph, worktree isolation, file-ownership/scope,
the concurrency controller, cross-branch analysis, the Integrator, bounded
max-concurrent-agents). Never run two implementers against the same
working tree. Never let workers overwrite each other's files. Overlapping
branches always go through detect → analyze → Integrator → review-the-
integrated-result — never "accept whichever finished last." Do not
serialize agents merely because it's easier to orchestrate that way, but
never sacrifice the existing safety controls for parallelism.

## Do not redesign the autonomous system

Keep existing safeguards: bounded cycles, bounded retries, bounded model
calls, concurrency limits, one primary autonomous implementation objective
per cycle unless configured otherwise, persistent cycle state, process
ownership/timeout cleanup, no uncontrolled recursive task generation. Only
modify orchestration infrastructure when evidence shows a real operational
problem. Any change that expands autonomous authority or weakens a
safeguard still requires explicit founder approval — this directive
authorizes routine operation, not infrastructure expansion.

## Learn from previous work

Persist lessons (product decisions, architectural conventions, recurring
bugs, testing gaps, UX conventions, security patterns, past failures,
founder decisions) via the existing memory store so future cycles don't
repeat mistakes.
