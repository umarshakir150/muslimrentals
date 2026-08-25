# Muslim Rentals — Agent Orchestrator

A minimal local orchestration layer that runs the persistent roles defined
in `agents/*.md` as **separate `claude` CLI worker processes**, coordinated
by a deterministic Supervisor/state-machine — instead of one conversation
sequentially role-playing every specialist.

Read this after `CLAUDE.md`, `agents/*.md`, `ai/workflow.md`, and
`ai/orchestration-plan.md` at the repo root — this tool implements the
workflow those files describe; it doesn't replace them. Role *instructions*
still live only in `agents/*.md` — this code never duplicates a role prompt.

## Architecture

```
CLI (src/cli.ts)
  -> runTask() (src/supervisor/orchestrator.ts)  — the state machine
       -> buildPlan()  (src/supervisor/planner.ts)     — Supervisor call
       -> per role:
            contextBuilder  (src/context/contextBuilder.ts) — minimal, curated context
            registry        (src/agents/registry.ts)         — permission profile
            ClaudeInvoker   (src/claude/claudeAdapter.ts)     — the only thing that spawns `claude`
            worktree        (src/git/worktree.ts)             — isolation for implementers + integration
       -> [2+ implementers only]
            crossBranchAnalysis (src/supervisor/crossBranchAnalysis.ts) — deterministic overlap/scope check, no Claude call
            Integrator agent (agents/integrator.md)                     — reconciles, invoked only when needed
       -> taskStore  (src/task/taskStore.ts)  — every artifact + log line, durably, under ai/tasks/<id>/
```

Nothing outside `src/claude/claudeAdapter.ts` spawns the `claude` binary or
knows its exact flags. Everything else programs against the `ClaudeInvoker`
interface, so the invocation mechanism (CLI headless mode today) can change
later without touching the state machine, and tests can substitute
`ScriptedClaudeInvoker` (`src/claude/fakeInvoker.ts`) instead of spending
real API calls on deterministic orchestration logic.

**Architectural rule this enforces:** Supervisor → specialized workers →
structured outputs → Supervisor aggregation → implementation → independent
review → correction loop. Agents never hold a free-form conversation with
each other — every hand-off is a typed artifact (`src/types/schemas.ts`)
written to `ai/tasks/<id>/` and read back as context by whatever runs next.
There is no agent-to-agent chat channel in this codebase, by design.

## Setup

```bash
cd orchestrator
npm install
```

Requires the `claude` CLI to already be installed and authenticated in
this environment (it is, in this repo's dev container — this tool does
**not** take or store any API key itself; see "Claude execution" below).

## Commands

```bash
npm run agents:task -- "<objective>"                 # dry run (default, safe)
npm run agents:task -- "<objective>" --full           # authorize implementation
npm run agents:task -- "<objective>" --max-agents 6 --max-retries 1 --max-concurrency 3
npm test                                               # orchestration unit tests (no real Claude calls)
npm run typecheck
```

## Dry-run mode (default)

Dry run is the default deliberately — the powerful path (`--full`) has to
be opted into, not opted out of. In dry run:

- The Supervisor still produces a real plan.
- Every required specialist (Designer/Trust & Safety/Legal/etc.) still runs
  for real, with real tool access to read the repo.
- If the plan calls for `engineering`/`frontend`/`backend`, that role still
  runs, but **forced into a read-only tool profile** (no Write/Edit/Bash,
  regardless of what `src/agents/registry.ts` normally grants it) and asked
  to produce a consolidated technical *analysis* (which files/areas, risk,
  a Frontend/Backend split) rather than an implementation result. No
  worktree is ever created in dry-run mode.
- QA and Security never run in dry-run mode — there is no diff to review.
- The task directory, plan, and every specialist's artifact are written
  exactly as in a full run; only `IMPLEMENTING`/`qa.json`/`security.json`
  are absent.

This means "must not implement the feature" isn't just a prompt
instruction for dry runs — it's architecturally true: the tools capable of
writing files are never handed to any worker in dry-run mode.

## Execution mode (`--full`)

Runs the complete state machine, up to and including real code changes in
an isolated git worktree, QA/Security review, and a correction loop. See
"Review loop" and "Approval gates" below. **Nothing in this repository has
ever been run in `--full` mode against a real feature** — see the final
report for this build for the one dry run that was demonstrated.

## Concurrency

Two genuinely different kinds of concurrency happen, both as real OS
processes (`child_process.spawn`), not simulated:

1. **Independent specialists** (Designer / Trust & Safety / Legal / Support)
   run in parallel — they're read-only and never touch the same files.
2. **QA and Security** run in parallel against the *same* finished diff —
   they're independent reviewers of one artifact, not of each other.
3. **Frontend and Backend**, if a plan ever splits implementation that way,
   run in parallel too — but each gets its **own git worktree and branch**
   (see below), so they are file-system-isolated from each other even
   though they're touching the same logical codebase at the same time.

**What never runs concurrently:** two implementer roles are never pointed
at the same worktree, and QA/Security never run *before* implementation has
produced something to review. Concurrency here means "independent workers
running at the same time," never "two agents that could write the same
file at the same time."

Scheduling itself is **not** decided by the Supervisor's Claude call — see
`src/supervisor/planner.ts`. The model proposes `requiredAgents` and *why*
(including the founder-approval judgment call); the orchestrator computes
`parallelGroups`/`dependencies` deterministically from a fixed canonical
order (specialists → implementers → QA+Security) and overrides whatever the
model proposed for scheduling. This is a deliberate choice: concurrency
safety is exactly the kind of decision that belongs in reviewable,
unit-tested code, not in model output that could vary run to run.

Concurrency within a group is bounded by `--max-concurrency` (default 4,
`src/supervisor/concurrency.ts`) — an explicit cap, not "however many
`Promise.all` happens to spawn."

## Agent permissions

Enforced in `src/agents/registry.ts`, applied by `src/claude/claudeAdapter.ts`:

| Role | Tools | Notes |
|---|---|---|
| Supervisor | Read, Grep, Glob | Plans only; never dispatched as a worker itself |
| Designer, Legal, Trust & Safety, Support | Read, Grep, Glob | No Bash. Cannot run commands at all. |
| QA | Read, Grep, Glob, **Bash** (scoped) | Bash limited to test/lint/type-check runners + read-only git inspection via `--allowedTools`; `git push`/`commit`/`reset`/`rm`/etc. explicitly denied via `--disallowedTools` |
| Security | Read, Grep, Glob, **Bash** (scoped) | Same Bash scoping as QA, plus `npm audit` |
| Engineering, Frontend, Backend | Read, Write, Edit, Grep, Glob, **Bash** (scoped) | Only roles with Write/Edit. Bash allows build/test/git-add/git-commit; `git push` and destructive commands explicitly denied |

**Two enforcement layers, and they mean different things:**

1. **`--tools`** (the hard boundary) — a tool not in this list does not
   exist for that worker process. This is what makes "Designer: read only"
   or "QA: no implementation edits" *true*, not just requested. A read-only
   role is physically incapable of calling Write/Edit/Bash, independent of
   anything else.
2. **`--allowedTools` / `--disallowedTools`** (fine-grained scoping *within*
   a granted tool) — for the two roles that get Bash (QA, Security) and the
   three implementer roles, this restricts *which* commands run. This layer
   is pattern-based and is not a hard sandbox boundary the way (1) is —
   treat it as a strong guardrail, not a proof, and see "Permission mode"
   below for the caveat on how it's enforced in headless mode.

**Permission mode.** Every worker call uses `--permission-mode dontAsk`.
Headless workers have no TTY, so an interactive mode (`manual`) would hang
forever, and `bypassPermissions` was deliberately **not** used because it
is documented to skip permission checking outright — which would make the
`--allowedTools`/`--disallowedTools` scoping in (2) above meaningless for
the Bash-granted roles. `dontAsk` was chosen so the CLI proceeds without an
interactive prompt while (as best as can be determined without the CLI's
permission-mode semantics being part of its public docs) still consulting
the allow/deny lists. **This assumption has not been exhaustively verified
against every edge case** — before relying on this for genuinely untrusted
input, watch a `--full` run's `log.jsonl` for `permission_denials` in the
raw Claude envelope and confirm denied commands are actually being denied,
not silently allowed. See "Troubleshooting" below.

Worker sessions are also isolated from the outer session: `--strict-mcp-config`
(no MCP servers — a worker can't reach anything the outer session happens to
have configured, e.g. GitHub or Slack integrations), `--setting-sources user`
(skips this repo's own project-level `.claude/settings.json` hooks, so a
nested worker session doesn't trip e.g. this repo's git-status stop hook),
and `--no-session-persistence` (throwaway sessions don't clutter `claude
--resume` history).

## Branch/worktree behavior

Only implementer roles (`engineering`/`frontend`/`backend`) get a git
worktree (`src/git/worktree.ts`), created via `git worktree add -b
agents/<task-id>/<role> orchestrator/.worktrees/<task-id>-<role> <base-commit>`
— every implementer (and, when one is needed, the integration worktree)
branches from the exact same base commit, resolved once per task
(`resolveHead()`) so "what changed" is always measured against one stable
baseline. When a plan needs 2+ implementers, a further, single
**integration worktree** is created at `agents/<task-id>/integration` (see
"Cross-branch analysis & integration" above) — reviewers in that path are
pointed at *it*, never at an individual implementer's worktree.

Reviewers (QA, Security, and any future role that inspects a worktree) are
pointed at whichever worktree path is under review with Read/Grep/Glob(/Bash)
only — they inspect it, they never get Write/Edit, so **a reviewer is
architecturally unable to silently rewrite what it's reviewing** (not just
asked not to). The Integrator *does* get Write/Edit (it's reconciling code,
not reviewing it), but is not a reviewer — see above.

The orchestrator **does not auto-merge or auto-delete worktrees/branches**
after a task finishes, implementer or integration. This is deliberate:
merging into the repo's default branch is a judgment call that belongs to
the Engineering Lead/founder, not to a script. Every finished task's final
report lists the integration branch (when there is one) and every
implementer branch/worktree path under "Next steps" for manual
review/merge — the integration branch is called out as the reviewed,
mergeable result, with the implementer branches noted as its
already-folded-in inputs, not separate things to merge themselves.
`src/git/worktree.ts` exports `removeWorktree()` for manual/test cleanup,
but `runTask()` never calls it itself outside of tests.

Worktrees live under `orchestrator/.worktrees/` (gitignored). Both this
path and `ai/tasks/` are overridable via `ORCHESTRATOR_WORKTREES_DIR` /
`ORCHESTRATOR_TASKS_DIR` env vars — the test suite uses this to point both
at an OS temp directory, so `npm test` never touches this repo's real
`ai/tasks/` or creates real branches (see `vitest.config.ts`).

## Review loop

There are **two distinct review paths**, chosen automatically by how many
implementer roles a plan requires — never left as a judgment call, since
that choice is exactly what a real run got wrong once (see "Cross-branch
analysis & integration" below).

### One implementer (`engineering`, or a plan that only needs `frontend` *or* `backend`)

```
PLANNING -> SPECIALIST_REVIEW -> READY_FOR_IMPLEMENTATION -> IMPLEMENTING
  -> QA_REVIEW -> [CORRECTION_REQUIRED -> IMPLEMENTING -> RE_REVIEW]*
  -> READY_FOR_FOUNDER -> COMPLETE | FOUNDER_APPROVAL_REQUIRED
```

There is exactly one worktree, so QA and Security (always run together,
`Promise.all`, against the same diff) review it directly — no cross-branch
question can arise with a single implementer.

### Two or more implementers (e.g. `frontend` **and** `backend` in the same plan)

```
... -> IMPLEMENTING -> CROSS_BRANCH_ANALYSIS -> INTEGRATION
  -> INTEGRATED_QA_REVIEW -> [CORRECTION_REQUIRED -> RE_INTEGRATION -> INTEGRATED_QA_REVIEW]*
  -> READY_FOR_FOUNDER -> COMPLETE | FOUNDER_APPROVAL_REQUIRED
```

**Per-implementer worktrees are never independently reviewed or approved in
this path.** An earlier version of this orchestrator reviewed each
implementer's worktree in isolation (see "Troubleshooting" below for what
that missed) — that mechanism has been fully replaced. Only the single,
combined **integration worktree** is ever reviewed, and only that verdict
counts toward `COMPLETE`. See "Cross-branch analysis & integration" below
for exactly how that worktree gets built.

### Both paths

- Either reviewer returning `CHANGES_REQUIRED` sends the task back into
  `IMPLEMENTING` (single-implementer path) or `RE_INTEGRATION` (integrated
  path — this re-invokes the **Integrator**, never the original
  implementers; see below), with the reviewer's findings appended as
  correction context (`renderCorrectionFeedback` in
  `src/supervisor/orchestrator.ts`).
- **Engineering never approves its own work.** There is no code path in
  the state machine that can reach `COMPLETE` without a passing verdict
  (`PASS`/`APPROVED`) recorded in both `qa.json` and `security.json`, from
  roles that are architecturally read-only for code — see "Agent
  permissions" above. In the integrated path this also means: no code path
  can reach `COMPLETE` from summing up per-worker approvals — there is no
  such sum to reach `COMPLETE` from, only one integrated verdict.
- `--max-retries` (default 2, `DEFAULT_MAX_RETRY_CYCLES`) bounds the
  correction loop in both paths — whether the loop is
  `IMPLEMENTING`/`RE_REVIEW` cycles or `RE_INTEGRATION` cycles. Exhausting
  it does not loop forever and does not silently give up — it escalates to
  `FOUNDER_APPROVAL_REQUIRED` with the specific reason recorded in the
  final report.

## Cross-branch analysis & integration

**Why this exists:** the first real `--full` run against an actual feature
(adding a saved-listings page) split implementation across `frontend` and
`backend`. Both roles, isolated in their own worktrees, independently
modified `rentals/backend/src/routes/users.ts` with two different,
incompatible fixes. Each branch passed QA/Security review *on its own* —
nothing ever compared the two branches against each other, so the
divergence reached the final report undetected. This section is the fix,
and it only runs when 2+ implementer roles are part of a plan.

**1. Implementation scopes** (`SupervisorPlan.implementationScopes`,
computed deterministically in `planner.ts`, never left to the model — same
reasoning as scheduling). Each implementer role gets an `expectedPaths`
glob list and an `allowedSharedPaths` list. Defaults
(`src/supervisor/crossBranchAnalysis.ts` `defaultScopeFor`): `frontend` →
`rentals/frontend/**`, `backend` → `rentals/backend/**`, `engineering` →
`rentals/**` (the unified role is deliberately allowed to touch both
sides — it's used precisely when work does *not* cleanly split).

**2. Cross-branch analysis** (`CROSS_BRANCH_ANALYSIS` state,
`analyzeCrossBranch()`, pure function, no Claude call). After every
implementer finishes, the orchestrator diffs each worktree against the
task's shared base commit (`diffNameStatus`, ground truth from git, not any
implementer's self-report) and classifies every path touched by more than
one implementer:
  - `EXPECTED_SHARED` — every implementer that touched it had declared the
    path in its own `allowedSharedPaths`. Not suspicious, not blocking.
  - `SUSPICIOUS` — touched by 2+ implementers, each within their own
    scope, but never declared as intentionally shared. Worth confirming
    the changes are actually compatible.
  - `CONFLICTING` — touched by 2+ implementers and at least one of them
    was outside its own scope for that path. This is exactly the real
    incident above: frontend touching a backend-owned file.

  Separately, *every* path any implementer touched outside its own
  `expectedPaths`/`allowedSharedPaths` — overlapping or not — is recorded
  as `OUT_OF_SCOPE_REVIEW_REQUIRED`. This never auto-fails the task
  (legitimate cross-cutting work exists); it routes the run to the
  Integrator/founder for a judgment call instead of silently accepting or
  silently blocking it.

  Detection is deliberately **path-based, not diff-based** — two
  implementers editing non-overlapping line ranges of the same file can
  merge with zero git conflicts and still get flagged, because the risk
  here (two different, silently incompatible implementations of the same
  behavior) is a semantic one that git's textual merge has no way to see.

  Written to `ai/tasks/<id>/changed-files.json` (raw per-worker diffs),
  `implementation-scopes.json` (the scopes used), and
  `overlap-report.json` (`{overlaps: [...], outOfScope: [...],
  hasBlockingIssues}`).

**3. Integration** (`INTEGRATION` / `RE_INTEGRATION` states). One dedicated
integration worktree/branch (`agents/<task-id>/integration`) is created
from the task's base commit. Every implementer branch is merged into it
sequentially (`git merge --no-ff`), stopping at the first real conflict.
  - If every merge is clean **and** `overlapReport.hasBlockingIssues` is
    false, integration is purely mechanical — no Integrator agent call at
    all, no reconciliation to explain.
  - Otherwise, the **Integrator** (`agents/integrator.md`, new role, no
    worktree of its own — it works in the integration worktree) is
    invoked with every implementer's own report, the full `overlapReport`,
    and (on a retry) prior correction feedback. Its job: reconcile
    conflicting/overlapping/out-of-scope changes, pick or combine the
    correct implementation, resolve any git conflict markers, and leave the
    worktree fully committed. It reports an `IntegrationResult`
    (`decisions`, `filesChanged`, `unresolvedConflicts`) to
    `integration-report.md`.
  - **Trust but verify**: after every Integrator call, the orchestrator
    re-checks the worktree itself (`unresolvedConflicts()` — real git
    conflict markers) rather than believing the model's self-report. A
    lingering conflict routes back into another `RE_INTEGRATION` cycle
    with that fact as correction feedback, bounded by `--max-retries` like
    any other correction loop.
  - **The Integrator never gives final approval.** It reconciles; it does
    not sign off. `INTEGRATED_QA_REVIEW`/`INTEGRATED_SECURITY_REVIEW`
    always follow, reviewing the actual integrated worktree independently
    — see "Review loop" above.

**Per-worker review is preliminary, not final.** Nothing about this
prevents a future addition of lightweight per-worker sanity checks before
integration, but as implemented today, the *only* review that determines
`COMPLETE` in the 2+-implementer path is the integrated one.

## Approval gates

`src/approval/founderGate.ts` parses CLAUDE.md's `## Founder authority`
bullet list at runtime — the canonical list of what needs founder sign-off
lives in exactly one place, not duplicated here. A keyword pattern set
(hardcoded, necessarily, since matching free text against prose bullets
needs *some* heuristic) matches the task objective against each category. A
test (`tests/founderGate.test.ts`) asserts every category's expected bullet
substring still exists in the real CLAUDE.md, so if the founder edits that
list, a mismatch fails loudly instead of silently losing a gate.

**The gate is the union of the model's own judgment (from the Supervisor's
plan) and this deterministic keyword check — never the model's judgment
alone**, for a safety-critical stop condition. Either one flagging it is
enough to require approval.

When required: the orchestrator **stops** before `IMPLEMENTING` (or, if
somehow only apparent after review, before `COMPLETE`) and reports
`FOUNDER_APPROVAL_REQUIRED` with every matched reason. No worker beyond
planning/specialist-analysis is invoked, no worktree is created, nothing is
implemented. This is enforced by an early return in
`src/supervisor/orchestrator.ts`'s `run()`, not by asking the model nicely.

False positives (flagging something that turns out fine) are the accepted
cost of this design — a task like "add a paid listing tier" will
legitimately trip "spending money" even if the actual work is just a UI
mockup. False negatives are not acceptable, so the gate is intentionally
blunt.

## Claude execution

**Mechanism chosen:** the installed `claude` CLI's headless print mode
(`claude -p --output-format json --json-schema ...`), inspected directly in
this environment (`claude --help`, version 2.1.243) rather than assumed.
This *is* Claude Code's supported programmatic/headless execution path. A
`@anthropic-ai/claude-agent-sdk` package also exists on the registry, but
was not added as a dependency: the CLI already exposes everything this
orchestrator needs (system-prompt injection, hard tool allowlisting,
fine-grained Bash scoping, structured JSON output validated against a
schema, per-call spend caps, native worktree support) via a subprocess
call, with zero extra dependencies and zero separate credential handling —
it rides on whatever authenticated `claude` session already exists in this
environment. **No API key is embedded anywhere in this code** — see
`src/claude/claudeAdapter.ts`, which never reads or sets
`ANTHROPIC_API_KEY`; it inherits `process.env` as-is and lets the CLI use
its own existing auth.

All CLI invocation happens in exactly one place —
`src/claude/claudeAdapter.ts`'s `CliClaudeInvoker` — behind a small
`ClaudeInvoker` interface. Swapping to the Agent SDK later (or a different
CLI version with different flags) means changing this one file; the state
machine, planner, and tests never import `child_process` or know a CLI
flag exists.

## Safety bounds

| Bound | Default | Where |
|---|---|---|
| Max agents per task | 8 | `DEFAULT_MAX_AGENTS_PER_TASK`, `src/supervisor/planner.ts` — the plan is clamped, not just requested |
| Max correction retry cycles | 2 | `DEFAULT_MAX_RETRY_CYCLES`, `src/supervisor/orchestrator.ts` |
| Max concurrent workers per group | 4 | `DEFAULT_MAX_CONCURRENCY`, `src/supervisor/concurrency.ts` |
| Per-invocation spend cap | $0.50–$3 depending on role | `maxBudgetUsd` per role, `src/agents/registry.ts`, passed as `--max-budget-usd` |
| Agents spawning agents | Never | No worker's tool set includes anything that could invoke `claude` itself — workers cannot recursively create workers |

All three numeric bounds are also CLI flags (`--max-agents`, `--max-retries`,
`--max-concurrency`) for a given run, so they can be tightened further
without a code change, but never loosened past what's safe by editing a
plan — the orchestrator, not the model, enforces them.

## Testing

`npm test` runs `tests/*.test.ts` under Vitest — **no real Claude calls**.
Orchestration logic (scheduling, dependency ordering, retry loops, approval
gates, permission profiles, artifact persistence) is deterministic and is
tested as such via `ScriptedClaudeInvoker` (`src/claude/fakeInvoker.ts`), a
scripted fake that returns pre-programmed responses per role and records
wall-clock start/finish times so tests can assert genuine concurrency
(overlapping timestamps), not just "it didn't throw."

Tests do create **real git worktrees** (that part isn't mocked — it's
cheap, deterministic, local git, and worth testing for real) but point
`ORCHESTRATOR_TASKS_DIR`/`ORCHESTRATOR_WORKTREES_DIR` at a temp directory
(`vitest.config.ts`) and clean up every worktree/branch they create in
`afterEach`, so `npm test` never leaves artifacts in this repo's real
`ai/tasks/` or creates real branches. `vitest.config.ts` also excludes
`.worktrees/**` from test discovery — a real implementer/integration
worktree left on disk from an actual `--full` run is a full checkout of
this repo, including its own nested (possibly stale) copy of
`orchestrator/tests/*.test.ts`; without the exclude, Vitest happily
discovers and runs those too, racing the outer run for the same git refs.
See `tests/orchestrator.test.ts` for the full scenario list (concurrency,
dependency waiting, QA/Security rejection loops, retry-limit stop,
founder-gate stop, read-only-role enforcement, artifact persistence, and
the full cross-branch-analysis/integration flow — mechanical-only merges,
conflicting/out-of-scope overlaps invoking the Integrator, a real git
merge conflict the Integrator claims to fix but doesn't, integrated review
correction loops for both QA and Security, and the integrated-review retry
limit). `tests/crossBranchAnalysis.test.ts` covers the deterministic
overlap/scope classification logic directly (no Claude, no git, no
worktrees — pure function tests).

`scripts/regression-saved-listings.ts` (`npx tsx
scripts/regression-saved-listings.ts` from `orchestrator/`) is a standalone
regression check, not part of `npm test`: it runs the real
`analyzeCrossBranch()`/`diffNameStatus()` logic against the **actual**
saved-listings feature branches from the incident described above
(`agents/20260825-053836-.../frontend` and `.../backend`, still present in
this repo as a fixture) as static input — read-only, no worktree created,
nothing merged or modified — and asserts the `users.ts` divergence is
detected as `CONFLICTING`/`OUT_OF_SCOPE_REVIEW_REQUIRED`. This is what
proves the fix actually catches the real incident it was built for, not
just a synthetic approximation of it.

## How to add another agent

1. If it's a genuinely new role, write its persistent instructions in
   `agents/<role>.md` first (this repo's operating system, not this tool).
2. Add the role to the `AgentRole` enum in `src/types/schemas.ts`.
3. Add its permission profile to `REGISTRY` in `src/agents/registry.ts` —
   decide its tool set deliberately (see "Agent permissions" above), which
   structured schema it produces (`AgentAnalysis` for read-only analysis
   roles, `ImplementationResult` for code-writing roles, `ReviewResult` for
   PASS/CHANGES_REQUIRED-style reviewers), and its artifact filename.
4. Add it to the right bucket in `src/supervisor/planner.ts`'s
   `GROUP_1_SPECIALISTS` / `GROUP_2_IMPLEMENTERS` / `GROUP_3_REVIEWERS` so
   the deterministic scheduler knows where it runs.
5. If it's a read-only analysis role, add its curated doc set to
   `RELEVANCE_MAP` in `src/context/contextBuilder.ts` — pick the smallest
   set of `company/`/`ai/` docs that role actually needs, not everything.
6. Add a registry test (permission profile shape) and at least one
   orchestrator test exercising the new role's path.

## Troubleshooting

- **`--json-schema is not a valid JSON Schema: can't resolve reference ...`**
  — this bit us once during development. `zod-to-json-schema`'s default
  output de-dupes repeated subschemas (e.g. the `AgentRole` enum, reused
  across several fields of `SupervisorPlan`) via a `$ref` that only
  resolves relative to the *original* full document. `src/types/schemas.ts`
  uses `$refStrategy: 'none'` specifically to fully inline everything and
  avoid this — if a schema ever regresses to using `$ref`, this is why.
- **`API Error: 400 tools.N.custom.input_schema.type: Field required`** —
  also bit us once. Claude Code turns `--json-schema` into an Anthropic API
  tool's `input_schema`, and the API requires `type: "object"` at that
  schema's own root. A `{"$ref": ..., "definitions": {...}}` wrapper (the
  zod-to-json-schema default) fails this because the `type` lives one level
  down inside `definitions`, not at the root. Same fix as above
  (`$refStrategy: 'none'`) — verified against the installed CLI (2.1.243).
- **A worker call is slow to start** — `claude -p` without stdin explicitly
  closed waits ~3s per call for stdin data that never arrives, since the
  prompt is passed as a positional argument. `src/claude/claudeAdapter.ts`
  uses `spawn(..., { stdio: ['ignore', ...] })` specifically to avoid this;
  if this regresses to `execFile` without an explicit `stdio`, the 3s wait
  is back.
- **Verifying the `dontAsk` permission-mode assumption** — inspect a `-full`
  run's `log.jsonl`, or re-run the raw CLI command a role used (logged at
  `agent_launch`) and look at the raw envelope's `permission_denials` array
  for anything a role's `--disallowedTools` pattern should have blocked.
  If a QA/Security/implementer role's Bash access ever needs to be
  air-tight rather than "strongly scoped," don't rely on `--allowedTools`
  alone — drop `Bash` from that role's `--tools` list entirely instead.
- **Multi-worktree review** — fixed twice, and the second fix superseded
  the first. An earlier version of this orchestrator only reviewed the
  first implementer's worktree when a plan split implementation across
  `frontend` **and** `backend`; that was caught before it was ever used
  against a real feature and fixed by reviewing every implementer's
  worktree independently (`reviewWorktrees()`/`mergeReviewResults()`, since
  removed). That fix then shipped and ran for real — and revealed a deeper
  problem: reviewing every worktree independently still isn't enough, because
  two implementers can each pass review in isolation while having written
  *incompatible* code (see "Cross-branch analysis & integration" above for
  the real incident). The current mechanism replaces per-worktree review
  entirely for 2+ implementers: `CROSS_BRANCH_ANALYSIS` -> `INTEGRATION` ->
  a single `INTEGRATED_QA_REVIEW`/`INTEGRATED_SECURITY_REVIEW` against one
  combined worktree. If you ever see `qa`/`security` invoked against an
  individual implementer's worktree path when 2+ implementers ran, or see
  `COMPLETE` reached without `overlap-report.json`/`integration-report.md`
  existing, that's a regression — file it as a bug.
- **A worker's structured output is technically valid but low-quality** —
  during the dry-run integration test that validated this tool (see the
  build's final report), one specialist call returned a schema-valid
  `AgentAnalysis` where the `findings` array was empty but rich findings
  content had been dumped as raw text — including stray tag-like
  fragments — inside the `summary` string instead. Zod validation only
  checks *structure* (types/shape), not that a string field is
  well-formed prose. This didn't recur across the other two specialist
  calls in that same run, so it reads as an intermittent model-side
  formatting slip rather than a systemic adapter bug — but treat any
  single worker artifact as something a human (or QA) should skim, not as
  guaranteed clean structured data, especially for schemas with nested
  object arrays like `findings`.
- **`Worktree path already exists`** — a previous run for the same task ID
  (or a crashed run) left a worktree/branch behind. Remove it manually:
  `git worktree remove orchestrator/.worktrees/<task-id>-<role> --force`
  then `git branch -D agents/<task-id>/<role>`, or use a fresh task ID.
- **`filesChanged` ground truth must be diffed against the base commit, not
  `git status`** — bit us once while adding `commitAll()` (the orchestrator
  now commits an implementer's/the Integrator's work itself rather than
  trusting the model to remember to). `changedFiles()`
  (`git status --porcelain`) only reports *uncommitted* changes — once
  `commitAll()`/the Integrator's own commit runs, the worktree is clean and
  `changedFiles()` reports nothing, even though real commits with real
  changes exist. `filesChanged` for `ImplementationResult`/`IntegrationResult`
  is computed via `diffNameStatus(worktree, baseCommit)` instead, which
  reflects committed history correctly regardless of working-tree state. If
  a final report's `filesChanged` is ever empty for a task that clearly did
  something, check which of these two a call site is using.
