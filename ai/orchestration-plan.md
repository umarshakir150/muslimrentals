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
- **Multi-worktree review aggregation.** When a plan splits implementation
  across more than one implementer role (e.g. `frontend` + `backend`
  together), QA and Security review every implementer's worktree
  independently — not just the first one — and the results are merged
  into one `qa.json`/`security.json` per task (`CHANGES_REQUIRED` if any
  worktree needs changes; findings tagged by which implementer's worktree
  they came from). A correction round only re-invokes and re-reviews the
  worktree(s) that actually failed. This started as a known gap during
  this orchestrator's initial build, was deliberately not run against a
  real feature until fixed, and was fixed and covered by tests before the
  first real `--full` run that needed it (see the task that added a saved-
  listings page for the run that exercised this for real).

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
- **Using `--full` against a real feature.** Every run to date has been
  either a unit test (mocked Claude entirely) or the one real dry run used
  to validate this system. No implementation has actually happened through
  this pipeline yet — that's the natural next step, on a small, low-risk
  task, with a human watching.

## Recommended next step

Run one small, real, low-risk feature through `--full` mode with a human
watching closely (per the founder-approval-required posture: even a task
that doesn't trip the keyword gate should get a manual look the first few
times). Use that run to sanity-check the things this plan couldn't fully
verify without spending real implementation cycles: whether the
`dontAsk` permission-mode assumption holds under real Bash usage by
Engineering/QA/Security (see `orchestrator/README.md` "Troubleshooting"),
and whether the correction loop's feedback is specific enough for
Engineering to actually fix what a reviewer flagged.
