# Decisions

A durable log of significant decisions made about this project. Add a new
entry per decision — do not edit past entries except to fix factual errors
in how a decision is recorded (never to relitigate it retroactively; open a
new entry for that instead).

Only decisions with actual repository evidence or an explicit founder
statement belong here. Do not backfill invented history for decisions that
predate this log — the entries below start from when this AI operating
system was introduced.

Format:

```markdown
## YYYY-MM-DD — Decision title

Decision:
Reason:
Alternatives considered:
Impact:
Revisit when:
```

---

## 2026-08-25 — Adopt a repo-native supervisor/worker AI operating structure

Decision: Introduce `CLAUDE.md`, `agents/`, `company/`, and `ai/` as the
standing structure for coordinating AI-assisted work on this project,
before any concurrent/automated orchestration is built.

Reason: The founder wants persistent, specialized roles (Supervisor,
Engineering, Frontend, Backend, QA, Security, Designer, Trust & Safety,
Legal, Support) with clear approval gates and durable task records, instead
of ad hoc single-agent sessions with no memory or review structure. Building
a full concurrent-orchestration platform first would be premature — the
repo-native structure needs to be validated in practice first.

Alternatives considered: (a) build an external orchestration service or
multi-process Claude harness immediately — rejected as premature per the
founder's explicit instruction; (b) keep working ad hoc with a single
`CLAUDE.md` and no role separation — rejected because it doesn't support
independent review gates (QA/Security/T&S/Legal) or delegation.

Impact: All future non-trivial work should go through
`ai/workflow.md`'s pipeline and use `ai/tasks/TEMPLATE.md`. No application
code was changed to introduce this — it is documentation-only.

Revisit when: The repo-native workflow has been exercised on a handful of
real tasks and the founder wants to evaluate moving to actual concurrent
Claude processes per `ai/orchestration-plan.md`.

---

## 2026-08-26 — Adopt standing autonomous operating directive

Decision: Record the founder's standing instruction for ongoing autonomous
operation (Lead/CTO-driven prioritization, QA carrying an explicit Reviewer
mandate, live published-site review as a routine signal source, honest
verification-level reporting, autonomous commit/push authority for reviewed
work, automatic correction routing, and the existing escalation/priority/
anti-busywork/concurrency/no-redesign rules) as durable project state in
`ai/operating-directive.md`, wired into the Lead's context via
`RELEVANCE_MAP` in `orchestrator/src/context/contextBuilder.ts`.

Reason: The founder wants the existing multi-agent organization to operate
Muslim Rentals as an ongoing job — deciding what to build, reviewing it
(including against the real published site), and shipping reviewed work —
without hand-picking every task, while keeping every existing safeguard
(bounded cycles/retries/model calls/concurrency, process ownership/timeout
cleanup, production deployment still founder-gated) exactly as-is.

Alternatives considered: (a) dump the full verbatim directive into a memory
record — rejected, `memoryStore.ts`'s existing design favors a small
curated set of facts over a large pile of half-relevant ones, and the full
directive is available in conversation history if ever needed verbatim;
(b) create a new "Reviewer" role/registry entry — rejected in favor of
strengthening `agents/qa.md` in place, since its existing framing already
substantially overlaps with the directive's Reviewer concept.

Impact: `ai/operating-directive.md` (new), `CLAUDE.md` (pointer added),
`orchestrator/src/context/contextBuilder.ts` (Lead's `RELEVANCE_MAP`
extended). No behavior change yet on its own — subsequent tasks
(strengthening `agents/qa.md`, seeding `ai/regression-inventory.md`,
scoped WebFetch grant, opt-in live-site signal source, centralized
auto-push) implement the capabilities this directive describes.

Revisit when: Evidence from real cycles shows the priority ordering,
escalation types, or concurrency assumptions need adjustment — not on a
schedule, and not by casually redesigning the orchestration system.
