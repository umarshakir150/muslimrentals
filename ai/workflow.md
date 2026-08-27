# Workflow

The standard operating sequence for any meaningful task in this repository.
Trivial one-line fixes don't need the full ceremony — use judgment, but
default to running the full sequence for anything that touches user data,
auth, money, moderation, or published content.

```
Founder request
      ↓
Supervisor                          (agents/supervisor.md)
      ↓
Relevant specialists                (agents/*.md — chosen by Supervisor,
      ↓                              work done in parallel where independent)
Consolidated specification          (Supervisor reconciles specialist input)
      ↓
Engineering plan                    (agents/engineering.md)
      ↓
Implementation                      (agents/frontend.md, agents/backend.md)
      ↓
Tests                               (automated where they exist; otherwise
      ↓                              a documented manual test plan —
      ↓                              see ai/current-state.md)
QA                                  (agents/qa.md — PASS or CHANGES_REQUIRED)
      ↓
Security / T&S / Legal review       (agents/security.md, agents/trust-safety.md,
      ↓                              agents/legal.md — only the ones the task
      ↓                              actually requires, run independently
      ↓                              of QA and of each other)
Fix failures                        (back to the responsible specialist;
      ↓                              re-run the review that failed)
Final report                        (Supervisor summarizes for the founder)
      ↓
Founder approval for high-impact actions
                                     (production deploy, permanent ban,
                                      production data deletion, publishing
                                      legal policy, spending money, major
                                      auth/security change — see CLAUDE.md)
```

## Which reviews are actually required

Not every task needs every specialist. The Supervisor decides based on what
the task touches:

- **QA** — always, for any task beyond a trivial fix.
- **Security** — any task touching auth, authorization, user data, file
  uploads, admin/moderation tools, or anything on `agents/security.md`'s
  "pay special attention to" list.
- **Trust & Safety** — any task touching user-generated content, reports,
  profiles, messaging, or moderation/abuse risk.
- **Legal** — any task touching privacy, data retention, consent, housing
  regulation, discrimination, terms, or platform liability.
- **Product Designer** — any task that changes a user-facing flow, not just
  a visual tweak.
- **Support** — not part of the build pipeline; it's the inbound triage
  path that *feeds* tasks into this pipeline (see `agents/support.md`).

## Failure handling

A `CHANGES_REQUIRED` verdict from any reviewer sends the task back to the
specialist that owns the affected area — not to whichever agent happens to
be "available." The Supervisor tracks this in the task file and does not
mark the task complete until every review that was required for it comes
back clean.

## Durable records

Every task beyond a trivial fix gets a file at `ai/tasks/<short-id>.md`,
created from `ai/tasks/TEMPLATE.md`. That file is the source of truth for
status, participating agents, requirements, plan, and review outcomes — not
chat history. This is what makes the workflow auditable and, later, what
lets concurrent agents coordinate without a live conversation between them
(`ai/orchestration-plan.md`).
