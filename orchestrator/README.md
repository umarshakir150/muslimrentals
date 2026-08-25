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
            worktree        (src/git/worktree.ts)             — isolation for implementers only
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
agents/<task-id>/<role> orchestrator/.worktrees/<task-id>-<role> HEAD`.
Reviewers (QA, Security) are pointed at that same worktree path with
Read/Grep/Glob(/Bash) only — they inspect it, they never get Write/Edit,
so **a reviewer is architecturally unable to silently rewrite what it's
reviewing** (not just asked not to).

The orchestrator **does not auto-merge or auto-delete worktrees/branches**
after a task finishes. This is deliberate: merging is a judgment call
(conflict resolution, deciding if the diff is actually good) that belongs
to the Engineering Lead/founder, not to a script. Every finished task's
final report lists the branch name(s) and worktree path(s) under "Next
steps" for manual review/merge. `src/git/worktree.ts` exports
`removeWorktree()` for manual/test cleanup, but `runTask()` never calls it
itself outside of tests.

Worktrees live under `orchestrator/.worktrees/` (gitignored). Both this
path and `ai/tasks/` are overridable via `ORCHESTRATOR_WORKTREES_DIR` /
`ORCHESTRATOR_TASKS_DIR` env vars — the test suite uses this to point both
at an OS temp directory, so `npm test` never touches this repo's real
`ai/tasks/` or creates real branches (see `vitest.config.ts`).

## Review loop

```
PLANNING -> SPECIALIST_REVIEW -> READY_FOR_IMPLEMENTATION -> IMPLEMENTING
  -> QA_REVIEW -> SECURITY_REVIEW -> [CORRECTION_REQUIRED -> IMPLEMENTING -> RE_REVIEW]*
  -> READY_FOR_FOUNDER -> COMPLETE | FOUNDER_APPROVAL_REQUIRED
```

- QA and Security always run together (`Promise.all`) against the same
  diff, whether it's the first review or a re-review — a fix aimed at one
  reviewer's finding can affect the other, so both re-check every cycle.
- Either reviewer returning `CHANGES_REQUIRED` sends the task back to the
  **same** implementer role, in the **same** worktree/branch (continuing
  the work, not starting over), with the reviewer's findings appended as
  correction context (`renderCorrectionFeedback` in
  `src/supervisor/orchestrator.ts`).
- **Engineering never approves its own work.** There is no code path in
  the state machine that can reach `COMPLETE` without both `qa.json` and
  `security.json` recording a passing verdict (`PASS`/`APPROVED`) from a
  role that is architecturally read-only for code — see "Agent
  permissions" above.
- `--max-retries` (default 2, `DEFAULT_MAX_RETRY_CYCLES`) bounds the
  correction loop. Exhausting it does not loop forever and does not
  silently give up — it escalates to `FOUNDER_APPROVAL_REQUIRED` with the
  reason "retry limit exhausted" recorded in the final report.
- Known limitation: if a plan splits implementation across more than one
  worktree (e.g. both `frontend` and `backend`), QA/Security currently
  review only the first implementer's worktree — see "Troubleshooting."

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
`ai/tasks/` or creates real branches. See `tests/orchestrator.test.ts` for
the full scenario list (concurrency, dependency waiting, QA/Security
rejection loops, retry-limit stop, founder-gate stop, read-only-role
enforcement, artifact persistence).

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
- **Multi-worktree review is incomplete** — if a plan ever splits
  implementation across `frontend` **and** `backend` in the same run, QA
  and Security currently only review the first implementer's worktree
  (`primaryRole` in `src/supervisor/orchestrator.ts`'s `run()`). This is a
  known, documented gap, not a silent one — extending review to multiple
  worktrees is real future work, not implemented here to avoid the added
  complexity of aggregating findings across separate diffs before it's
  been needed even once in practice.
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
