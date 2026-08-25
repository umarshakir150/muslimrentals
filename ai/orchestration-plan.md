# Orchestration Plan (future — not implemented yet)

This describes how the repo-native structure in `CLAUDE.md`, `agents/`,
`company/`, and `ai/` can evolve into separate concurrent Claude worker
processes, **once the repo-native workflow has been validated on real
tasks.** Nothing in this file should be built yet — the repository does not
currently contain an orchestration framework, and the founder's explicit
instruction was not to build one prematurely.

## Why not build this now

- The workflow itself (which roles, which reviews, what gates) hasn't been
  exercised yet. Automating an unvalidated process just automates its
  mistakes faster.
- This is a free, early-stage product with no test suite and no CI
  (`ai/current-state.md`) — concurrent automated agents editing code
  without a safety net to catch regressions is higher risk than the
  process problem it would solve.
- The task-file structure (`ai/tasks/`) already gives most of the benefit
  (durable records, clear ownership, explicit review gates) without the
  operational complexity of managing multiple live processes.

## Target shape, when it's time

- **Supervisor as primary coordinator.** One process (or the founder,
  directly) opens and owns task files, decides which specialist workers to
  spawn, and is the only one that reconciles conflicting outputs or talks
  to the founder about status.
- **Separate Claude processes for specialist agents.** Each `agents/*.md`
  role becomes a process/session invoked with that role's file as its
  system context, rather than one session context-switching between roles.
  This is what actually enables parallelism (Frontend and Backend working
  the same task at the same time) instead of the current sequential
  single-session approach.
- **Structured task IDs.** Extend `ai/tasks/<short-id>.md` into a real
  identifier scheme (e.g. date-prefixed or sequential) so tasks, branches,
  and worker invocations can all reference the same ID unambiguously.
- **Shared task artifacts instead of endless agent chat.** Workers read and
  write the task file (and code) as their coordination mechanism — not a
  live back-and-forth conversation between agents. This is already true of
  the current repo-native design (`ai/workflow.md`) and should carry
  forward unchanged; it's what makes the system auditable via git history
  and task files alone.
- **Limited tool permissions by role.** A Security or QA worker should not
  have the same write access as an Engineering worker — reviewers should
  not be able to silently patch what they're reviewing. In Claude Code
  terms, this maps to per-session tool/permission scoping.
- **Branch/worktree isolation for concurrent coding.** Each implementation
  worker (Frontend, Backend) works in its own branch or git worktree so
  parallel work doesn't collide; Engineering Lead merges/coordinates.
- **Reviewer agents should not modify the same branch they review.** QA,
  Security, Trust & Safety, and Legal review a branch/diff from outside it
  and report findings back into the task file — they don't push fixes
  directly into the branch under review. This preserves the independence
  that makes their sign-off meaningful.
- **Aggregation by Supervisor.** The Supervisor process is the one that
  reads every worker's output back into the task file, resolves conflicts,
  and decides the task's next state.
- **Retry loop when reviewers return `CHANGES_REQUIRED`.** The Supervisor
  routes the task back to the owning implementation worker, which fixes and
  re-submits; the same reviewer (not a different one) re-checks, so context
  isn't lost between rounds.
- **Audit trail through task files and git history.** No separate logging
  system needed at this stage — the task file's status/history plus normal
  git commits are the record of what happened, in what order, and who
  (which role) did it.

## Recommended path to get there

1. Run several real tasks through the current repo-native workflow
   end-to-end (Supervisor → specialists → reviews → founder approval),
   using `ai/tasks/TEMPLATE.md` for each.
2. After that, evaluate friction: where did sequential single-session work
   actually block on something that true concurrency would have fixed?
   Where did a reviewer's independence get compromised by being in the same
   session as the implementer?
3. Only then move to Claude Code's programmatic/headless execution to spawn
   actual concurrent worker processes per the shape above — and only if the
   repository still doesn't already contain a more suitable orchestration
   framework by that point (re-check before building one).
4. Introduce branch/worktree isolation and per-role tool permission scoping
   at that same point, not before — they only pay for themselves once
   there's real concurrency to isolate.
