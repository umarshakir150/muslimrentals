# Autonomy Architecture

This document is the gap analysis and design record for turning the
existing task-execution orchestrator (`orchestrator/`) into a persistent,
bounded, autonomous product/engineering operating layer. Read
`orchestrator/README.md` and `ai/orchestration-plan.md` first — this file
assumes that architecture and only describes what's *new*.

## 1. What already exists (reused, not rebuilt)

Verified by reading the actual source, not assumed:

| Capability | Where | Status |
|---|---|---|
| Persistent specialist role definitions | `agents/*.md` | Complete |
| Supervisor coordination, structured plan | `src/supervisor/planner.ts` | Complete |
| Separate real Claude executions | `src/claude/claudeAdapter.ts` (`CliClaudeInvoker`) | Complete |
| Real concurrent workers, bounded | `src/supervisor/concurrency.ts` (`mapConcurrent`) | Complete |
| Frontend/Backend worktree isolation | `src/git/worktree.ts` | Complete |
| Structured outputs (Zod) | `src/types/schemas.ts` | Complete |
| QA / Security / Trust & Safety / Legal | `agents/{qa,security,trust-safety,legal}.md` + `src/agents/registry.ts` | Complete |
| Correction loops | `orchestrator.ts` (`runSingleImplementerReviewLoop`, `runIntegrationAndReviewLoop`) | Complete |
| Founder approval gates | `src/approval/founderGate.ts` (parses `CLAUDE.md`) | Complete |
| Cross-branch changed-file analysis, out-of-scope detection | `src/supervisor/crossBranchAnalysis.ts` | Complete |
| Dedicated Integrator | `agents/integrator.md`, `orchestrator.ts` integration flow | Complete |
| Integrated QA/Security (not just per-worktree) | `orchestrator.ts` (`runIntegrationAndReviewLoop`) | Complete |
| Bounded retries | `maxRetryCycles`, enforced in the review loops | Complete |
| Task artifacts/history | `ai/tasks/<id>/`, `src/task/taskStore.ts` | Complete |
| Resume/recovery for an in-flight *task* | `resumeIntegration()`, `resumeIntegratedReview()` | Complete (added this session) |
| Autonomous/backlog/scheduler functionality | — | **Does not exist.** Confirmed by grep across `orchestrator/`, `ai/`, `agents/` — no matches beyond this document. |

**Conclusion: the execution engine is real and does not need replacing.**
Every one of the boxes in the operating-model diagram from "Existing
multi-agent execution system" down already exists and works — it was
exercised twice this session on real features (saved-listings integration
fix, Roommate Profiles MVP). The only missing layer is everything *above*
it: deciding what task to run next without a human typing it in.

## 2. The gap

The orchestrator answers "given a task, execute it safely." Nothing in the
repo answers "given the current state of the product, what task should
exist next, and are we allowed to start it automatically." Specifically
missing:

- No durable record of candidate work (a backlog) — `ai/tasks/` only
  records *tasks that were already decided on and started*.
- No mechanism to observe the repo/product and generate candidates.
- No cross-cycle memory beyond what's implicitly readable by grepping
  `ai/tasks/`.
- No component decides *which* task to run without a founder typing an
  objective string.
- No pre-execution risk tier separate from the founder-gate keyword match
  (that gate fires mid-execution on the objective text; autonomy needs a
  gate *before* a task is even created).
- No bounded "one cycle" command, no scheduler, no cycle/approval
  persistence, no lock preventing overlapping cycles.

## 3. Chosen extension architecture

A new `src/autonomy/` module tree, entirely additive, sitting **above**
`src/supervisor/orchestrator.ts` and never modifying its state-machine
internals. It calls `runTask()` / `resumeIntegration()` /
`resumeIntegratedReview()` exactly as a human-run CLI invocation would —
the autonomy layer is a *caller* of the execution engine, not a second
implementation of it.

```
                    ┌─────────────────────────────┐
                    │   Standing objective (DB)     │
                    └──────────────┬───────────────┘
                                   │
┌──────────────┐    ┌─────────────▼──────────────┐    ┌──────────────┐
│ Signal sources │──▶│         Lead / CTO           │◀──│ Memory store  │
│ (local, safe)  │   │  (src/autonomy/lead.ts)      │   │ (retrieval)   │
└──────────────┘    │  one structured Claude call   │   └──────────────┘
                    │  "lead" role, read-only tools │
                    └──────────────┬───────────────┘
                                   │ validated LeadPlan
                    ┌──────────────▼───────────────┐
                    │   Backlog store (SQLite)      │◀── dedup, scoring,
                    │   create/update/select        │    priority persisted
                    └──────────────┬───────────────┘
                                   │ risk-classify selected item
                    ┌──────────────▼───────────────┐
              LOW/MED│  Risk classification          │HIGH
        ┌────────────┤  (deterministic, code-owned)  ├────────────┐
        │            └────────────────────────────────┘           │
        ▼                                                          ▼
┌───────────────┐                                      ┌────────────────────┐
│ EXISTING       │  runTask()/resumeIntegration()       │ Approval request    │
│ orchestrator   │◀─────────────────────────────────────│ persisted, cycle    │
│ (unmodified)   │──────────────────────────────────────▶ continues on other  │
└───────────────┘  result: RunResult (COMPLETE/         │ eligible work       │
                    FOUNDER_APPROVAL_REQUIRED/etc.)      └────────────────────┘
        │
        ▼
┌───────────────┐    ┌───────────────┐    ┌──────────────┐
│ Backlog update │───▶│ Memory update  │───▶│ Cycle record  │
└───────────────┘    └───────────────┘    │ + event log   │
                                            └──────┬────────┘
                                                   │
                                    ┌──────────────▼──────────────┐
                                    │  Scheduler (dumb):            │
                                    │  eligible? → run one cycle    │
                                    │  else wait                    │
                                    └───────────────────────────────┘
```

## 4. Data flow (one cycle, in order)

1. Acquire cycle lock (single row in SQLite, `UPDATE ... WHERE locked=0`).
2. Load standing objective, prior cycle, backlog, recent memory.
3. Run local signal sources (repo scan, build/typecheck, project-state).
4. Persist new signals (fingerprint-deduped against existing ones).
5. Invoke the Lead (one real Claude call, `agents/lead.md`, read-only
   tools) with: objective, top backlog items, new signals, relevant
   memory. It returns a `LeadPlan`: new backlog candidates, updates to
   existing items, at most one selected item + rationale, and any
   escalations.
6. Validate the `LeadPlan` against its Zod schema; reject/retry once on
   failure the same way `buildPlan()` already does for `SupervisorPlan`.
7. Apply backlog changes deterministically (create/update/dedupe) —
   the model *proposes* fields, code decides the final priority score,
   exactly like scheduling/scope decisions already work in
   `planner.ts`.
8. If a `selectedItemId` exists, deterministically risk-classify it
   (never trust the model's own risk label as final).
9. HIGH risk → write an `ApprovalRequest`, do **not** execute, cycle can
   still complete normally (it just did zero implementation work).
10. LOW/MEDIUM → convert the backlog item into an objective string and
    call `runTask()` (or a resume function, if applicable) — the
    **unmodified** existing orchestrator takes over completely from here:
    Supervisor plan, specialists, implementers, cross-branch analysis,
    Integrator, integrated QA/Security, correction loops.
11. On result: update the backlog item's status (`DONE`/`BLOCKED`/back to
    `READY` with findings), extract durable memory (decisions, known
    issues), and log follow-up candidates QA/Security may have surfaced —
    as new `CANDIDATE` backlog rows, never as immediately-executed work.
12. Persist the `AutonomousCycle` record and structured events.
13. Release the lock. Exit. (No self-invocation, no loop.)

## 5. Safety model

- **The autonomy layer cannot weaken anything the execution engine
  already enforces.** It never modifies `founderGate.ts`,
  `crossBranchAnalysis.ts`, the review loops, or registry permission
  profiles. It only decides *whether to call* the existing engine, using
  a *stricter*, additional pre-execution gate.
- **HIGH-risk work cannot auto-start**, full stop — it becomes an
  `ApprovalRequest`, and the cycle moves on or ends cleanly.
- **Deploys and default-branch merges remain entirely out of reach.**
  Nothing in `src/autonomy/` ever calls `git push`, `git merge` into the
  default branch, or any deployment tooling — those don't exist as
  capabilities anywhere in this codebase to begin with.
- **maxTasksPerCycle defaults to 1** (configurable, never auto-increased)
  regardless of how many candidates the Lead finds.
- **The Lead's tool profile is read-only** (`Read`, `Grep`, `Glob` — no
  `Write`/`Edit`/`Bash`), the same architectural hard-boundary already
  used for Designer/Legal/Trust & Safety — it cannot touch the repo, only
  reason about it and emit structured JSON.
- Every budget (`maxModelCallsPerCycle`, `maxRetries`, `cycleTimeout`,
  etc.) is enforced in code before another Claude call is made, not
  requested politely.

## 6. Persistence model

**Chosen: `node:sqlite` (`node:sqlite`'s `DatabaseSync`), not
`better-sqlite3`, not one markdown file as the database.**

Reasoning: this repo already runs on Node 22 (`node --version` confirms
it), which ships a built-in, synchronous SQLite module — zero new
dependencies, zero native-compilation risk (the existing orchestrator has
exactly two dependencies, `zod` and `zod-to-json-schema`; adding a
compiled native module for this would be a disproportionate footprint
increase for one feature). A single markdown file cannot support the
required query patterns (dedupe-by-fingerprint, filter-by-status,
priority-ordered selection, dependency lookups) without hand-rolling a
worse database in prose. SQLite gives real indexes, real queries, and
survives process restarts as a single file on disk — exactly what's
needed and no more.

- **Location:** `orchestrator/.autonomy/state.db`, gitignored — the same
  treatment as `orchestrator/.worktrees/` (ephemeral-but-durable-on-disk
  local state, not something to version-control as a binary blob).
  Overridable via `ORCHESTRATOR_AUTONOMY_DB` for tests, mirroring
  `ORCHESTRATOR_WORKTREES_DIR`/`ORCHESTRATOR_TASKS_DIR`.
- **Tables:** `backlog_items`, `signals`, `memory_records`,
  `autonomous_cycles`, `approval_requests`, `events`, `standing_objective`
  (single row), `cycle_lock` (single row).
- **What stays outside SQLite, on purpose:** the actual *work product* of
  a selected task. When the Lead selects a backlog item, its execution
  becomes a completely normal orchestrator task, and everything that
  already lands in `ai/tasks/<id>/` (git-tracked, human-readable) keeps
  landing there exactly as before. SQLite never duplicates that — it only
  stores a link (`relatedTasks: [taskId]`) back to it. This avoids two
  sources of truth for the same thing.
- **Container-teardown caveat, stated plainly:** a SQLite file is durable
  across *process* restarts (the actual "crash/restart recovery"
  requirement) but is local disk, not committed to git — a fresh
  container/environment starts with an empty backlog/memory, the same way
  `orchestrator/.worktrees/` already doesn't survive a fresh checkout.
  `ai/tasks/` remains the durable, git-tracked record of *what actually
  got built*, independent of whether the autonomy DB survives.

## 7. Scheduling model

The scheduler (`src/autonomy/scheduler.ts`) is deliberately not smart. It
holds no product knowledge. Its entire job: is autonomy enabled, is
another cycle running, is the next cycle eligible (cadence elapsed since
`nextEligibleAt`), and if so, spawn exactly one `runCycle()` and wait. All
prioritization intelligence lives in the Lead/cycle layer, never in the
scheduler. Default cadence is conservative (documented in
`orchestrator/README.md`) and is not auto-tightened. The scheduler process
is a long-running Node process the founder starts explicitly
(`npm run agents:autonomous -- start`) — it is not tied to any particular
Claude Code conversation, and stopping this conversation does not stop it
or vice versa.

## 8. Deliberately deferred (per the task's own "do not overbuild" list)

Not built in this phase, and why:

- **External signal sources** (GitHub, GitHub Actions, Vercel, Sentry,
  analytics, browser/E2E, user feedback): no adapter exists for any of
  them yet because none are configured in this environment, and
  fabricating access would violate the "do not fabricate access to
  services that are not configured" instruction. The `SignalSource`
  interface (`src/autonomy/signalSources.ts`) is written so a future
  adapter is a new file implementing one interface — see
  `orchestrator/README.md` "Adding a signal source."
- **Autonomous production deployment** — no deployment capability exists
  anywhere in this repo; not added here either. A `DeploymentCandidate`
  concept is documented but not implemented beyond a status field the
  Lead can never set to "deployed."
- **A polished dashboard / vector database / distributed queue /
  Kubernetes / microservices** — explicitly out of scope; CLI/status
  output is the interface for this phase, and SQLite's own query surface
  is what a future dashboard would read from directly.
- **maxTasksPerCycle > 1** — the config exists and is respected, but the
  default stays at 1 until autonomous prioritization has been observed
  working correctly over real cycles.

## 9. What the real demonstration actually found (post-implementation)

This section was written after running real cycles against this repo
(`ai/tasks/20260826-210142-...`, `20260826-212054-...`, `20260826-212634-...`,
`20260827-035341-...`) — the plan above was necessarily written before any
of this was exercised for real, and three genuine bugs plus one repo gap
only surfaced under real execution, not under the mocked-Claude test suite.
Recorded here so the gap between "the design" and "what real load actually
does to it" isn't lost:

- **`execFileAsync`'s default 1MB stdout buffer** (`src/git/worktree.ts`)
  overflowed on a real `npm install`-sized `git diff`/`git status` output
  and crashed a task mid-execution. Fixed with the same generous-buffer
  pattern `claudeAdapter.ts` already used for an analogous problem.
- **`{...existing, ...patch}` merges in `updateBacklogItem`/`updateCycle`**
  silently nulled out untouched fields whenever a patch simply *omitted*
  them (JS/TS makes "field omitted" and "field explicitly undefined"
  indistinguishable once spread) — a real Lead status-only update crashed
  Zod validation on `NaN`/`undefined` scoring fields. Fixed with a shared
  `definedOnly()` helper (`src/autonomy/ids.ts`) applied at both merge
  sites.
- **`isLockStale()` could not detect a real crash.** It only treated a
  lock as stale once the cycle it pointed at had already reached a
  terminal status — but a genuine crash, by definition, never reaches one
  on its own; that's what makes it a crash. Caught only by actually
  killing a live cycle's real OS process and observing the next
  invocation refuse to recover (the mocked-crash unit test had the same
  blind spot — it set the cycle row's status but never acquired the lock,
  so it happened to pass without ever exercising the buggy path). Fixed
  with a PID-liveness check (`cycle_lock.locked_by_pid`, `process.kill(pid,
  0)`) — reliable specifically because this system is single-machine by
  design; a purely time-based staleness heuristic was considered and
  rejected as strictly worse here.
- **`rentals/backend/` and `rentals/frontend/` had no `.gitignore` for
  `node_modules`.** Not an autonomy-layer bug, but it directly caused both
  problems above to actually trigger, and after the buffer fix landed it
  caused a second, worse failure (`spawn E2BIG` — ~41,000 "changed" files
  overflowing the OS argument-length limit on the Integrator's CLI
  invocation). Added directly rather than routed through the Lead/
  Supervisor pipeline: it's dev-environment hygiene with no product
  tradeoffs to review, and leaving it missing would keep breaking every
  future task whose worktree runs a real install.

None of these were hypothetical — each was found by an actual autonomous
cycle doing actual work, which is the strongest evidence available that
"the system observes, plans, executes, and its failures are visible and
recoverable rather than silent" actually holds, not just that the design
document claims it does.
