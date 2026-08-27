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

## Autonomy (the Lead/CTO layer)

Everything above this section is the **execution engine**: given one
objective, run it safely through the right specialists, implementers,
reviewers, and Integrator. The autonomy layer (`src/autonomy/`) sits above
it and answers a different question — *given the product's current state,
what should we work on next, are we allowed to start it, and how do we
persist the outcome* — then hands the answer to the exact same execution
engine described above. It never reimplements planning, worktrees,
review, or founder gates; it only decides *what* to call `runTask()` with.
Full gap analysis and design rationale: `ai/autonomy-architecture.md`.
Role definition: `agents/lead.md`.

**Data flow, one bounded cycle:**

```
standing objective (persisted, founder-editable)
        │
        ▼
signal sources (repo scan, build/typecheck, past QA/Security/T&S/Legal
findings — all local/free; an opt-in "deep" Designer/Security pass costs
one real Claude call each and is off by default)
        │
        ▼
Lead (src/autonomy/lead.ts) — ONE real Claude call per cycle, read-only
tools, reads: standing objective + top backlog + this cycle's signals +
relevant memory → proposes new/updated backlog candidates and AT MOST ONE
selectedItemId (LeadPlan.selectedItemId is a single nullable string, not an
array — "at most one" is enforced by the output shape itself)
        │
        ▼
deterministic post-processing (never trusts the model's own claims):
  - dedup new candidates against the real backlog (Jaccard title overlap)
  - priority always recomputed in code (src/autonomy/prioritization.ts)
  - risk always recomputed in code (src/autonomy/riskClassification.ts),
    reusing the SAME evaluateFounderGate() the execution engine's own
    mid-task gate uses — HIGH can never be selected for execution
        │
        ├── HIGH risk / explicit Lead escalation → persisted
        │   ApprovalRequest, item marked APPROVAL_REQUIRED, cycle
        │   continues (does not freeze on one blocked item)
        │
        └── LOW/MEDIUM, dependencies resolved → the EXISTING orchestrator:
            runTask({ objective: <item's title+description+rationale+
            evidence>, mode: 'full', invoker }) — same Supervisor,
            specialists, worktrees, QA/Security, Integrator, correction
            loops, and founder gate as any other task
                │
                ▼
        outcome → backlog updated (DONE + linked task id, or BLOCKED/
        APPROVAL_REQUIRED — never silently DONE on anything short of
        COMPLETE) → a memory record → a cycle summary → release the cycle
        lock → exit
```

### Persistence

`orchestrator/.autonomy/state.db` — a single `node:sqlite` file (Node 22's
built-in, zero new dependencies; see `ai/autonomy-architecture.md`
"Persistence model" for why this was chosen over `better-sqlite3` or a
markdown file). Gitignored, overridable via `ORCHESTRATOR_AUTONOMY_DB`
(tests point it at a scratch path). Tables: `backlog_items`, `signals`,
`memory_records`, `autonomous_cycles`, `approval_requests`, `events`,
`standing_objective`, `cycle_lock`, `scheduler_state`. `ai/tasks/<id>/`
remains the durable record of actual work product — the backlog only ever
stores a link (`relatedTasks: [taskId]`), never a duplicate copy. Like
`.worktrees/`, the DB file survives process restarts but not a fresh
container/environment — a known, already-accepted limitation, not new to
this layer.

### Commands

```
npm run agents:status                 # scheduler/lock/backlog/approvals/recent events, one screen
npm run agents:backlog                # top backlog items, priority-sorted
npm run agents:backlog -- show <id>   # one item in full
npm run agents:cycle                  # run ONE bounded cycle now (mode=full — real execution)
npm run agents:cycle -- --dry-run     # one cycle, plan/analyze only, no implementation
npm run agents:cycle -- status        # show the most recent cycle, don't launch one
npm run agents:cycle -- history       # list past cycles
npm run agents:autonomous -- start [--cadence-minutes N]
npm run agents:autonomous -- pause
npm run agents:autonomous -- resume
npm run agents:autonomous -- stop
npm run agents:autonomous -- status
npm run agents:approvals              # list PENDING approval requests
npm run agents:approvals -- show <id>
npm run agents:approvals -- approve <id> [--note "..."]
npm run agents:approvals -- reject <id> [--note "..."]
npm run agents:events                 # recent structured event log
npm run agents:task -- agents         # known agent roles + permission profiles
npm run agents:task -- tasks          # ai/tasks/ execution history
npm run agents:task -- objective      # print the standing objective
npm run agents:task -- objective "…"  # set it (founder-editable, no code change)
npm run agents:scheduler              # run the persistent scheduler loop (blocks)
```

(`src/cli.ts` dispatches a small reserved set of leading words —
`status`/`backlog`/`cycle`/`autonomous`/`approvals`/`events`/`agents`/
`tasks`/`objective`/`scheduler-loop` — to `src/autonomyCli.ts`; anything
else falls through unchanged to the original single-task runner, so `npm
run agents:task -- "<objective>"` keeps working exactly as documented
above.)

### Risk classification — what may start on its own

| Risk | Examples | May the Lead select it? |
|---|---|---|
| LOW | small (severity ≤2) bug fixes, tests, docs, accessibility fixes, low-effort UX/tech-debt | Yes — selected and executed the same cycle |
| MEDIUM | ordinary additive features, additive schema changes, most API changes | Yes — implemented on an isolated branch (the execution engine already never does anything else), never auto-deployed |
| HIGH | anything matching a CLAUDE.md founder-authority category (production deploy, irreversible/destructive changes, deleting production data, permanent bans, publishing legal policy, spending money, major auth/security/architecture rewrites), `LEGAL_FLAG` category, secret/API-key rotation, moderation-policy or permanent-policy text | Never — a persisted `ApprovalRequest` is created instead; the cycle moves on to the next eligible item rather than freezing |

Risk is **always** recomputed in code from the item's category/flags/text —
never trusted from the item's own stored field or the Lead's own judgment
(`src/autonomy/riskClassification.ts`). The execution engine's own
mid-task founder gate (`src/approval/founderGate.ts`) still runs
independently on top of this — a Supervisor call can flag founder approval
even when the Lead-level check didn't (see
`tests/cycle.test.ts`'s founder-gate test for exactly this case).

### Budgets

| Bound | Default | Where |
|---|---|---|
| Max implementation tasks selected per cycle | 1 | Structural — `LeadPlan.selectedItemId` is a single nullable string |
| Max Claude calls per cycle (Lead + opt-in deep signal sources only — the execution engine's own per-task/per-worker budgets above are unaffected and apply on top) | 5 | `DEFAULT_MAX_MODEL_CALLS_PER_CYCLE`, `src/autonomy/cycle.ts` |
| Cycle timeout | 30 min | `DEFAULT_CYCLE_TIMEOUT_MS`, `src/autonomy/cycle.ts` — terminates every worker process the cycle still owns (`invoker.killAll()`, unconditional in a `finally`) before releasing the lock; see "Process ownership" below |
| Worker timeout (per Claude CLI call) | 20 min | `DEFAULT_WORKER_TIMEOUT_MS`, `src/autonomy/cycle.ts`, applied via `CliClaudeInvoker`'s `defaultTimeoutMs` for real `cycle`/`scheduler-loop` runs (`autonomyCli.ts`) — not the ad-hoc single-task CLI, which stays timeout-free by default |
| Scheduler cadence | 240 min | `DEFAULT_CADENCE_MINUTES`, `src/autonomy/scheduler.ts` — conservative on purpose, changeable via `--cadence-minutes` |

A cycle never retries itself — "ONE invocation = ONE finite cycle" — so
there is no cycle-level retry counter beyond the execution engine's own
existing `maxRetryCycles` correction-loop budget, which is unaffected by
any of this. A worker timeout is never retried by `CliClaudeInvoker`'s own
bounded (2-attempt) retry loop either — a call that already proved it can
hang for the full timeout window gets no second attempt, which is also
what keeps a timeout from ever compounding into a longer wait.

### Process ownership

Every real worker (`claude` CLI call) is spawned as the leader of its own
detached process group (`src/claude/claudeAdapter.ts`), specifically so a
timeout can terminate not just that process but anything IT spawned too
(`process.kill(-pid, signal)` reaches the whole group — see
`src/process/liveness.ts`). On a worker or cycle timeout: SIGTERM the
group, poll for real death for a short bounded grace period, escalate to
SIGKILL if it didn't cooperate, and verify before reporting what happened
(`WorkerTimeoutError.termination` is `'terminated_gracefully'` or
`'force_terminated'`, never assumed). `CliClaudeInvoker.killAll()` is
called unconditionally in `cycle.ts`'s `finally` block, so no worker a
cycle started can outlive the cycle itself regardless of which branch it
exits through (success, an ordinary failure, or a timeout) — this was a
real, previously-documented gap (a cycle timeout used to just abandon the
in-flight Promise) found and fixed after the first live autonomous cycle.

Ownership survives a crash of the orchestrator process itself, not just a
hung worker: every spawned worker's PID is durably recorded
(`worker_processes` table, tagged with the spawning orchestrator process's
own PID — `src/autonomy/workerRegistry.ts`), and every `runCycle()` call
starts by reconciling that table (`cleanupOrphanedWorkers()`) — for any
row whose recording orchestrator process is confirmed dead, the worker's
own identity is re-verified (PID liveness *and* a kernel-recorded
start-time match, via `/proc/<pid>/stat`) before it's ever terminated, so
a PID that's since been reused by an unrelated process is never touched.
A worker whose recording orchestrator is still alive is left completely
alone, no matter how long it's been running.

### Recovery

`cycle_lock` is a single mutex row (`src/autonomy/cycleStore.ts`), not an
in-memory flag, specifically so a crash is visible on restart rather than
silently forgotten. On every `runCycle()` call: (1) if the lock is held but
points at an already-terminal (or missing) cycle, it's cleared as stale;
(2) if the most recent cycle never reached a terminal status, it's marked
`FAILED` with `result: 'recovery_marked_incomplete'` before anything new
starts — no attempt is made to cleverly resume mid-task (that would need
inspecting worktree/task state); any partially-completed `ai/tasks/` work
is left untouched and can be resumed manually via the execution engine's
own `resumeIntegration`/`resumeIntegratedReview` or picked up fresh by a
future cycle through the normal backlog. This is actually tested — not
just asserted — by simulating a crash (a cycle row left at `EXECUTING`,
`closeDb()` + reopen) and observing the next `runCycle()` call detect and
mark it (`tests/autonomyStores.test.ts`, `tests/cycle.test.ts`).

### Adding a future signal source

`SignalSource` (`src/autonomy/signalSources.ts`) is `{ name, collect():
Promise<RecordSignalInput[]> }` — deliberately the smallest interface that
lets a new source just report evidence without knowing anything about
backlog/priority/risk. To add GitHub issues/Actions, Vercel deployments,
Sentry, analytics, browser/E2E test results, or user feedback later: write
one module implementing this interface (reading from that real, configured
service — never fabricate access to one that isn't), add it to the list
`cycle.ts` passes to the collection loop (opt-in like `deepSignalSource` if
it costs money or is slow), and nothing else needs to change — the Lead,
backlog, and risk classification are already source-agnostic.

### Live-site review

`liveSiteSignalSource.ts` mirrors `deepSignalSource.ts`: one bounded, opt-in
QA pass against the real published site
(`https://muslimrentals.netlify.app/`), reusing the `qa` role and its
`AgentAnalysis` structured output. QA's registry profile grants `WebFetch`
scoped to `WebFetch(domain:muslimrentals.netlify.app)` only — it cannot
fetch any other URL even if the model tried (`src/agents/registry.ts`,
`tests/registry.test.ts`). Off by default (real Claude call + real HTTP
requests); pass `--live-site-signal` to `agents:autonomy cycle`/
`scheduler-loop` to include it. Findings are tagged `source: 'live_site'`
and `metadata.environment: 'PRODUCTION'` so downstream consumers never
confuse a live-site finding with a repo-only one. See
`ai/operating-directive.md` ("Live product as a signal source") and
`agents/qa.md` ("Live product review") for the policy this implements.

### Autonomous push

Once `runTask()` reaches `COMPLETE` — meaning the work already passed
required reviews through the existing pipeline — `runCycle()` can push the
reviewed branch to `origin`: the integration branch when 2+ implementers
ran, otherwise the single implementer's own branch. Never `main`/`master`;
every branch this system creates lives under the `agents/<taskId>/...`
namespace, and the push (`pushBranch()`, `src/git/worktree.ts`) is a plain
non-force push of that one branch — a genuine rejection is reported, never
overwritten. This is off by default in `cycle.ts` itself (`autoPush`
option) but on by default for real autonomous runs specifically —
`agents:autonomy cycle` and `scheduler-loop` push unless `--no-auto-push`
is passed — per `ai/operating-directive.md` ("Autonomous commit + push
authority"). Push success/failure is recorded as a `BRANCH_PUSHED`/
`BRANCH_PUSH_FAILED` event either way; a failed push never fails the cycle
or the underlying task, it's left for manual follow-up. Tests inject a
fake `pushBranchFn` so no test ever touches the real remote
(`tests/cycle.test.ts`).

### Dashboard-ready data (no UI built yet)

Every store module (`backlogStore`, `signalStore`, `memoryStore`,
`cycleStore`, `approvalStore`, `eventLog`) is a plain function API over
SQLite — there's no reason a future local read-only HTTP layer or desktop
UI couldn't sit directly on top of them for an organizational/task/
activity/health view (PART 19's four views map directly onto
listBacklogItems/listAllBacklogItems, listCycles/getLatestCycle,
listAutonomyEvents, and getSchedulerState/getCycleLock respectively) — not
built now per the explicit instruction not to over-build a dashboard before
there's a real need for one.

### Safety — what autonomous mode may and may not do

- May: select and execute LOW/MEDIUM-risk work through the existing,
  fully-reviewed pipeline (specialists → implementer(s) → QA → Security →
  Integrator → correction loops), on isolated branches, same as any manual
  task; push a `COMPLETE` task's reviewed `agents/<taskId>/...` branch to
  `origin` (non-force, never `main`/`master` — see "Autonomous push" above).
- May not, ever: auto-select or auto-start HIGH-risk work; weaken any
  existing approval gate, risk threshold, concurrency limit, budget limit,
  reviewer independence, or production restriction; deploy to production;
  merge to the default/production branch automatically; force-push any
  branch; spend money; fabricate access to an unconfigured external
  service; recursively spawn agents (the Lead has no `Bash`/`Write`/`Edit`
  tools at all — it can only propose, never act).
- A change to the autonomy platform's own safety rules is infrastructure
  work like any other — it goes through the same review pipeline, and
  anything that would materially expand agent authority needs explicit
  founder approval, exactly like everything else in "Founder authority" in
  the root `CLAUDE.md`.

### Running autonomy persistently

`npm run agents:scheduler` runs `runSchedulerLoop()` — a plain long-lived
Node process that polls `scheduler_state` on a fixed interval and calls
`runCycle()` when `autonomous start`'d and eligible. It does **not** launch
itself; `autonomous start/pause/resume/stop` only flip the persisted state
a separate running loop process reads. To keep it running independent of
any one terminal or Claude Code session in this container:

```
nohup npm run agents:scheduler > .autonomy/scheduler.log 2>&1 & disown
```

This is a dev-environment convenience, not a production deployment
mechanism — nothing here auto-configures systemd/pm2/a process supervisor
in a real deployment target; that remains a founder/infra decision.

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

The autonomy layer's tests follow the same discipline — deterministic
store/scheduling logic tested directly, the one real Claude call per cycle
(the Lead) scripted via `ScriptedClaudeInvoker` — split across three files:
`tests/autonomyStores.test.ts` (backlog CRUD/dedup/reprioritization, signal
dedup-by-fingerprint, memory retrieval/filtering/supersession, standing
objective persistence, risk classification's HIGH/LOW/MEDIUM boundaries,
approval request lifecycle, event log ordering/redaction, cycle
lock/interrupted-cycle/stale-lock detection, and scheduler state
transitions — all with real `closeDb()`-and-reopen restart simulation, not
just in-process assertions), `tests/leadPlanning.test.ts` (the Lead's
structured-output post-processing: `"new:<index>"` selection resolution,
dependency blocking, HIGH-risk selection always blocked with a persisted
approval instead of returned as selectable, schema-invalid output falling
back safely, near-duplicate merging, escalations becoming approvals), and
`tests/cycle.test.ts` (full `runCycle()` runs against the **real**
`runTask()` — real Supervisor/specialists/implementer/QA/Security, only
Claude scripted — proving successful/founder-gated/incomplete outcomes
update the backlog correctly, the model-call budget short-circuits before
ever calling Claude, the cycle lock prevents overlap, and a simulated crash
is detected and marked on the next call). Each of these test files points
`ORCHESTRATOR_AUTONOMY_DB` at its own scratch file (set at the top of the
file, overriding `vitest.config.ts`'s shared default) — Vitest runs test
files in parallel, and SQLite is one shared file, unlike the independent
per-task directories `ai/tasks/`/`.worktrees/` tests already relied on.

`tests/processLifecycle.test.ts` covers worker/cycle process ownership —
timeout termination, process-group child cleanup, graceful-then-force
escalation, never touching an unrelated process, and cross-restart orphan
detection/cleanup — using real disposable local processes
(`tests/fixtures/*.mjs`, standing in for `claude`), never real Claude
calls. See "Process ownership" above for what's actually being tested and
why it needed a real `kill -9` (not just a unit test) to find the gap it
fixes in the first place.

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
