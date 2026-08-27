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
discarding conflicts. Production deployment remains founder-gated
regardless of review outcome — this authority never extends to production.

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
