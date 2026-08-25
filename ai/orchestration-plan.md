# Orchestration Plan

This describes how the repo-native structure in `CLAUDE.md`, `agents/`,
`company/`, and `ai/` evolves into separate concurrent Claude worker
processes. **The target shape described here is now implemented** in
`orchestrator/` — see `orchestrator/README.md` for the full architecture,
setup, and usage. This file now tracks what's implemented vs. what's
still deliberately deferred, so it doesn't drift into describing an
imaginary system (see `company/architecture.md`'s own rule about that).

## Status: implemented

Built and validated (unit tests + a real dry-run integration run — see
`ai/tasks/` for that run's artifacts, referenced from the task that added
this orchestrator):

- **Supervisor as primary coordinator**, producing a machine-readable
  `SupervisorPlan` (`orchestrator/src/types/schemas.ts`) that decides which
  agents a task needs and why. Scheduling itself (concurrency groups,
  dependencies) is computed deterministically in code from that plan, not
  left to model judgment — see `orchestrator/README.md` "Concurrency."
- **Separate Claude processes for specialist agents.** Each `agents/*.md`
  role runs as its own `claude -p` (headless) subprocess, given only its
  own role file plus a curated slice of `company/`/`ai/` context — not the
  whole repo, not every other agent's output.
- **Structured task IDs and shared task artifacts instead of agent chat.**
  `ai/tasks/<task-id>/` holds `request.md`, `plan.json`, one artifact per
  agent that actually ran, `qa.json`/`security.json`, `final-report.md`,
  and an append-only `log.jsonl` — the coordination mechanism, not a live
  conversation between agents.
- **Limited tool permissions by role**, enforced two ways: a hard
  tool-name allowlist per role (a tool not granted doesn't exist for that
  worker), and fine-grained Bash command scoping for the roles that get
  Bash at all (QA, Security, implementers). See `orchestrator/README.md`
  "Agent permissions."
- **Branch/worktree isolation for concurrent coding.** Implementer roles
  each get their own `git worktree`; reviewers inspect that worktree with
  read-only (or Bash-limited) tools and never get Write/Edit.
- **Reviewer agents do not modify what they review** — architecturally,
  not just by instruction (no Write/Edit tool granted at all to QA/Security).
- **Aggregation by Supervisor**, and **a retry loop when reviewers return
  `CHANGES_REQUIRED`** — routes back to the same implementer role on the
  same branch, with the reviewer's findings as correction context; the
  same two reviewers re-check together on every cycle, bounded by a max
  retry count that escalates to the founder instead of looping forever.
- **Audit trail through task files and git history** — every phase
  transition, agent launch/completion, review verdict, retry, and approval
  gate is logged to both the console and `ai/tasks/<id>/log.jsonl`, with
  secret-shaped values redacted before they're written anywhere
  (`orchestrator/src/logger.ts`).
- **Founder approval gates that actually stop execution**, sourced from
  CLAUDE.md's own "Founder authority" list (parsed at runtime, not
  duplicated) combined with the Supervisor's own judgment — either one
  flagging a task halts it before implementation (or before completion)
  with `FOUNDER_APPROVAL_REQUIRED` and the matched reasons.
- **Explicit safety bounds**: max agents per task, max correction retry
  cycles, max concurrent workers per group, and a per-invocation spend cap,
  all enforced in code (not just requested of the model) — see
  `orchestrator/README.md` "Safety bounds."
- **Cross-branch conflict detection and integration.** When a plan splits
  implementation across 2+ implementer roles (e.g. `frontend` + `backend`),
  per-worktree review alone is not treated as sufficient for `COMPLETE` —
  see the incident below. After implementation, the orchestrator
  deterministically diffs every implementer's worktree against the task's
  shared base commit, classifies any path touched by more than one
  implementer (`EXPECTED_SHARED`/`SUSPICIOUS`/`CONFLICTING`) and any path
  touched outside an implementer's own declared scope
  (`OUT_OF_SCOPE_REVIEW_REQUIRED`), and only then builds a single
  **integration worktree**: implementer branches are merged into it
  mechanically where possible, and a new **Integrator** role
  (`agents/integrator.md`) is invoked to reconcile anything conflicting,
  overlapping, or out-of-scope. QA and Security then review **only the
  integrated worktree** — the per-implementer review this replaced is gone
  entirely for 2+ implementer plans, not run alongside the new step. Full
  detail: `orchestrator/README.md` "Cross-branch analysis & integration."

  This exists because of a real incident: the first `--full` run against an
  actual feature (a saved-listings page) split implementation across
  `frontend` and `backend`; both independently modified
  `rentals/backend/src/routes/users.ts` with two different fixes, each
  branch passed QA/Security review *in isolation*, and nothing ever
  compared the two branches — the divergence reached the final report
  undetected. (An earlier, now-superseded fix had already made sure every
  implementer's worktree got reviewed at all, not just the first one — that
  turned out not to be enough, since two worktrees can each individually
  pass review while being mutually incompatible.) The fix above was
  validated against this exact incident as a regression fixture:
  `orchestrator/scripts/regression-saved-listings.ts` runs the real
  detection logic against the actual `frontend`/`backend` branches from
  that run (left in the repo, unmodified, specifically for this) and
  confirms the `users.ts` divergence is now caught.

## Status: deliberately not implemented yet

- **Auto-merge of implementer branches.** The orchestrator intentionally
  never merges a finished implementer branch back into the task's base
  branch on its own — that's left as a manual step for the Engineering
  Lead/founder, reported in the final task report. Whether to automate
  this (and under what conditions) is an open question, not a decision.
- **CI integration.** This repo still has no CI (`ai/current-state.md`).
  The orchestrator's own test suite (`orchestrator/npm test`) isn't wired
  into any pipeline yet — running it is currently a manual step.
- **Cost tracking across a whole task.** `claude`'s per-call cost is
  captured by the adapter (`ClaudeInvokeResult.costUsd`) but not yet
  aggregated or logged per task — a near-term, low-effort addition.
- **A UI or dashboard over `ai/tasks/`.** Everything is file-based today;
  browsing task history means reading the directory, which is fine at
  current scale but won't stay pleasant indefinitely.
- **Automatic escalation delivery.** `FOUNDER_APPROVAL_REQUIRED` is
  reported in the CLI output and the task's final report — nothing pushes
  a notification to the founder yet (e.g. email/Slack). The founder has to
  be watching the run or read the task directory afterward.
- **Auto-merge of the integration branch.** Same reasoning as
  "Auto-merge of implementer branches" above — the integration worktree
  (see "Cross-branch conflict detection and integration") is the reviewed,
  mergeable result of a multi-implementer task, but merging it into the
  repo's default branch is still a manual step for the founder, not
  something `COMPLETE` does on its own.

## Status: exercised against a real feature

`--full` mode has been run against real, low-risk features with a human
watching, per the earlier recommendation in this file. The saved-listings
page run (single feature, split across `frontend`/`backend`) is what
surfaced the cross-branch divergence incident described above, and the
fix for it (cross-branch analysis + integration + integrated review) has
itself been validated — unit tests plus a regression check against that
run's actual branches — but **not yet exercised against a new real feature
run end-to-end**. That's the natural next step: run another small,
real, multi-implementer feature through `--full` mode with a human
watching, specifically to confirm the integration flow behaves as
expected outside of tests (Integrator invocation, reconciliation quality,
integrated review) the same way the first `--full` run validated the
original single/multi-worktree paths.
