# Task request

- **Task ID:** 20260828-084425-add-ability-to-report-a-user
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-28T08:44:25.461Z

## Objective

Add ability to report a user or a message directly (not just listings)

Report model/route today is scoped to listings only (no userId/messageId target field, no report UI outside a listing's page). This leaves no way for a user to report harassment or abuse happening inside a message thread — a real trust & safety gap on a messaging-heavy product. Will require a Prisma schema change (a nullable target type on Report, or a parallel model) plus new authenticated routes and frontend report affordances in the messaging UI. Recommend deferring actual implementation until the sandbox's DB-migration verification gap (mem_480b2bf7 — no reachable dev Postgres for `prisma migrate dev`) is resolved, or scoping the first cut narrowly enough to minimize migration risk, so this doesn't end up parked BLOCKED the way bl_368a454b has been for three cycles.

Why this matters (backlog rationale): Directly evidenced as a real, not speculative, gap: company/architecture.md's own 'Known weaknesses' section states 'Only listings are reportable... which limits Trust & Safety's tooling for harassment-via-messaging today,' and company/product.md explicitly lists 'Reporting users or messages directly' as not implemented. It's also named in ai/roadmap.md's 'Next' section. This sits squarely in the standing objective's 'protect users' and trust/safety priority, but is schema-changing work that will hit the same DB-migration verification wall currently blocking bl_368a454b, so it should not be started until that structural gap is addressed or the item is scoped to avoid it.

Evidence:
- company/architecture.md: 'Only listings are reportable — no report path for a user or a message directly...'
- company/product.md: 'Reporting users or messages directly. Only listings are reportable today'
- ai/roadmap.md: 'Next — Add a report path for users/messages (not just listings)'
- mem_480b2bf7-74fd-4ece-8ccf-18c4b14a6191 (DB-migration verification gap this item will run into)
