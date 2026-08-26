# Task request

- **Task ID:** 20260826-212054-harden-autonomous-execution-of-output-heavy-commands
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-26T21:20:54.443Z

## Objective

Harden autonomous execution of output-heavy commands (npm install/build) against stdout buffer overflow

The Roommate Profiles verification task (bl_368a454b) failed mid-execution with 'stdout maxBuffer length exceeded' while presumably running npm install and/or build/migrate commands in rentals/backend or rentals/frontend. This is a child-process stdout capture limit, not a code defect, but it will recur on any future task that runs a verbose install/build/migrate command through the same execution harness. Fix by having implementer/QA tooling run such commands with reduced-verbosity flags (e.g. npm install --no-fund --no-audit --loglevel=error) and/or redirect output to a log file and only surface the tail/errors, rather than capturing full raw stdout.

Why this matters (backlog rationale): Directly caused a real execution failure this cycle (mem_0bc54a1e) on the single highest-priority backlog item, and the same failure mode will block any future task that needs npm install/build/migrate output captured in full. Fixing this once removes a recurring source of wasted cycles for testing/verification work, which the standing objective treats as high priority.

Evidence:
- mem_0bc54a1e-dcdb-4bfa-a801-f7a2108f02e3
