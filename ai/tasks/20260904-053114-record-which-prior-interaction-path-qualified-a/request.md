# Task request

- **Task ID:** 20260904-053114-record-which-prior-interaction-path-qualified-a
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-09-04T05:31:14.701Z

## Objective

Record which prior-interaction path qualified a user report as moderator-visible evidence

POST /users/:id/report enforces a real DB-backed prior-interaction gate (shared conversation OR listing interaction) before allowing a report, but which path qualified it is not persisted or surfaced anywhere in GET /admin/reports. Trust & Safety's design-review recommended surfacing this as evidence for moderators reviewing user reports; QA confirmed it was never implemented and flagged it as a non-blocking follow-up.

Why this matters (backlog rationale): Small, concrete, evidence-based gap on a feature that is now fully shipped (bl_e3162883, DONE) — improves moderator ability to judge report legitimacy without any new risk surface, but is polish rather than a safety-critical fix, so it should queue behind the currently-pending approval-required items rather than jump ahead of them.

Evidence:
- ai/tasks/20260901-234756-build-the-report-a-user-report-a-message-feature-as/qa.json: "Trust & Safety's design-review recommendation to record which prior-interaction path... qualified a USER report as evidence for moderators was not implemented"
