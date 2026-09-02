# Muslim Rentals — AI Operating System

This file is the entry point for any AI agent (Claude or otherwise) working in
this repository. It defines the product, who has final authority, and the
required workflow for getting work done safely. Read this before touching
any code.

Specialist roles in this system are **not generic coding agents**. Each one
(`agents/*.md`) has a narrow mandate, a specific checklist, and a specific
output format. A specialist that starts writing code outside its lane, or
skips its checklist to "just get it done," is doing it wrong. The Supervisor
exists to keep everyone in their lane and to make sure the right specialists
actually get involved before work is called done.

## Product

Muslim Rentals is a **free** housing marketplace / community platform built
to help Muslims in Canada:

- browse rental listings
- post rental listings
- find roommates and create roommate profiles (**planned — not yet built**,
  see `ai/current-state.md` and `ai/roadmap.md`)
- contact potential landlords or roommates (via in-app messaging)
- report suspicious or inappropriate content (listings today; users/messages
  not yet reportable — see `ai/current-state.md`)

Full product framing: `company/product.md`. User personas: `company/users.md`.
Operating principles: `company/principles.md`. Actual (not aspirational)
architecture: `company/architecture.md`.

## Founder authority

The human founder has **final authority** over:

- product direction
- production deployment
- irreversible production changes
- deleting production data
- permanent account bans
- publishing legal policies (Terms, Privacy, Safety pages)
- spending money
- major authentication/security changes
- major architecture rewrites

No agent — including the Supervisor — may take any of the above actions
unilaterally. Agents propose; the founder disposes. When a task might touch
one of these, say so explicitly and stop for approval rather than guessing.

## Required workflow

For any meaningful feature work, follow this sequence (full diagram in
`ai/workflow.md`):

1. Understand the founder's objective — ask if genuinely ambiguous, otherwise
   make a reasonable call and flag the assumption.
2. Inspect the current implementation relevant to the request (don't assume;
   read the actual code).
3. Determine which specialist roles (`agents/*.md`) are needed.
4. Perform independent analysis in parallel where practical (e.g. Frontend
   and Backend can both scope their side of a feature at the same time).
5. Consolidate requirements into a single spec.
6. Create an implementation plan (Engineering Lead).
7. Implement.
8. Run tests. **Note:** this repo currently has no automated test suite —
   see `ai/current-state.md`. Until one exists, "run tests" means manual
   verification of the golden path and edge cases, documented in the task
   file.
9. QA review (independent — see `agents/qa.md`).
10. Security review when relevant (independent — see `agents/security.md`).
11. Trust & Safety review when user-generated content, reports, profiles,
    messaging, or moderation/abuse risk is involved.
12. Legal/Compliance issue-spotting when privacy, data retention, housing
    regulation, discrimination, terms, consent, or platform liability could
    be involved.
13. Resolve every `CHANGES_REQUIRED` finding before proceeding.
14. Create a final task report (fill in the `## Final result` section of the
    task file).
15. **Never deploy without explicit founder authorization**, even if every
    review passed.

Use `ai/tasks/TEMPLATE.md` to open a durable record for any task that
involves more than a trivial one-file fix. See `ai/workflow.md` for how the
task file moves through the pipeline and `ai/orchestration-plan.md` for how
this evolves into concurrent agents later.

For how the autonomous team operates on an ongoing basis — deciding
priorities itself, running specialists concurrently, reviewing the live
site, and committing/pushing reviewed work without per-instance founder
approval — see `ai/operating-directive.md`. It supplements this file and
never overrides it.

## Directory map

```
CLAUDE.md                  ← you are here

agents/                    ← persistent role definitions
  supervisor.md
  engineering.md
  frontend.md
  backend.md
  qa.md
  security.md
  designer.md
  trust-safety.md
  legal.md
  support.md
  integrator.md            ← orchestration-internal only; see agents/integrator.md
  lead.md                  ← orchestration-internal only; see agents/lead.md and ai/autonomy-architecture.md

company/                   ← what the company/product actually is
  product.md
  users.md
  principles.md
  architecture.md

ai/                        ← project memory or "how work gets done"
  current-state.md
  roadmap.md
  decisions.md
  workflow.md
  orchestration-plan.md
  moderator-guide.md       ← for anyone with ADMIN/MODERATOR role: report review, retention
  tasks/
    TEMPLATE.md
```

## Where the actual application code lives

The app is not at the repo root — it's under `rentals/`:

```
rentals/frontend/   Next.js 14 app (App Router, TypeScript, Tailwind)
rentals/backend/    Express API (TypeScript, Prisma, PostgreSQL)
```

See `company/architecture.md` for the full breakdown.

## Ground rules for every agent

- Do not deploy anything to production.
- Do not delete existing code without a clear reason tied to the task.
- Do not make destructive database changes (no dropped tables/columns, no
  irreversible migrations) without explicit founder approval.
- Do not rewrite working architecture unless the task genuinely requires it.
- Do not present Legal's output as authoritative legal advice — it is issue
  spotting only (`agents/legal.md`).
- Preserve existing patterns and conventions already in the codebase
  (Zod `.strict()` schemas, ownership checks, rate limiters, etc. — see
  `company/architecture.md`) rather than introducing new ones without cause.
