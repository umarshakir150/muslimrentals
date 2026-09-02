# Final task report

- **Task ID:** 20260901-234414-build-the-report-a-user-report-a-message-feature-as
- **Final state:** FOUNDER_APPROVAL_REQUIRED
- **Agents involved:** trust_safety, designer
- **Correction cycles used:** 0
- **QA verdict:** N/A
- **Security verdict:** N/A

## Objective

Build the report-a-user / report-a-message feature as a full-stack feature FROM SCRATCH.

IMPORTANT CORRECTION TO SCOPE: an earlier task (ai/tasks/20260828-084425-add-ability-to-report-a-user) described this as already having backend routes/schema/migration built, needing only frontend wiring. This is FALSE for the current codebase (verified 2026-09-01 against main commit 49d4bb7 by two independent specialist reviews this same day, ai/tasks/20260901-193457-.../designer.md and trust-safety.md): schema.prisma's Report model has only reason/description/status/reporterId/listingId, no report route exists on messages.ts or users.ts, and no ReportModal component exists in the frontend (ListingDetail.tsx still uses window.confirm()). Treat this as new implementation across schema, backend, and frontend -- not integration/wiring of existing code.

Design baseline to implement (already reviewed twice by Trust & Safety and once by Designer -- reuse this design rather than re-deriving it):

1. SCHEMA (additive/backward-compatible only -- no existing column altered, nothing made NOT NULL, no destructive change):
   - Add a ReportTargetType enum (LISTING, USER, MESSAGE) to schema.prisma.
   - Extend the existing Report model with nullable targetType (default LISTING for existing rows), reportedUserId (nullable FK to User, onDelete: SetNull), messageId (nullable FK to Message, onDelete: SetNull), messageSnapshot (nullable String, for message-report content preservation since messages are mutable with no audit trail).
   - Generate the migration the normal way for this repo (see prisma/migrations/ for the existing pattern); if a real database connection isn't available in this worktree, hand-author the migration.sql to exactly match what `prisma migrate diff` would generate, matching this repo's own established precedent for that situation, and say so explicitly in the implementation report -- do not silently claim it was verified against a live database if it wasn't.

2. BACKEND (new routes, reusing existing patterns -- auth middleware, writeRateLimiter, Zod .strict() validation, matching the existing POST /listings/:id/report exactly in style):
   - POST /messages/:id/report -- authenticated, only a conversation participant may report a message, self-report blocked (cannot report your own message), snapshots the message body + sender id into the Report row atomically at creation time (not a live FK lookup later, since the message can be edited/deleted after).
   - POST /users/:id/report -- authenticated, self-report blocked. MANDATORY CONSTRAINT FROM THE FOUNDER (not optional, not a future hardening): the reporter may only report a user with whom they have a legitimate prior marketplace interaction -- specifically, allow the report only if (a) the reporter and the target user share at least one existing Conversation as participants, OR (b) the target user owns a Listing that the reporter has a real interaction with (e.g. an existing conversation about that listing, or the reporter has saved it). This must be enforced server-side with a real DB check before creating the Report row -- return a clear 403/400 (not a generic error) if no qualifying interaction exists. Do not implement an open-to-anyone report-any-user endpoint.
   - Extend GET /admin/reports to branch on targetType and include the right review context per type (reported user's identity/ban history for USER; sender identity + the frozen messageSnapshot + a link to the conversation for MESSAGE) -- gated behind the existing ADMIN/MODERATOR role check, no new privilege surface.
   - Both new endpoints return only {success, message} -- no report id or target private fields, matching the existing listing-report response shape (don't let a reporter enumerate whether a report already exists against a target).

3. FRONTEND:
   - Build one shared ReportModal component (reason picker parameterized by target type, optional free-text description, a short context preview of what's being reported, states: closed -> reason-select -> optional description -> submitting -> success toast -> inline error with retry). All tap targets >=44px.
   - Reason taxonomy parameterized by targetType: LISTING keeps the existing list including "Misleading or fraudulent listing"; USER and MESSAGE get their own sets (Harassment or abusive behavior; Scam or fraud attempt; Impersonation [user only]; Inappropriate content; Spam; Other) -- never show listing-only reasons for a non-listing target.
   - Replace ListingDetail.tsx's existing window.confirm() flag button with the shared ReportModal (no schema change needed for this part, ships as low-risk validation of the shared component).
   - Add a "Report {name}" action in Inbox.tsx's thread header (reports the other conversation participant), and a tap-triggered "Report message" action on the other participant's message bubbles only (never on the user's own messages).
   - Do NOT add a "block user" affordance in this pass -- out of scope, no backend support for it, and shouldn't be implied by the report UI.
   - Admin dashboard (app/admin/page.tsx) Reports panel: branch on targetType, add a small type chip (Listing/User/Message) per row, and render type-appropriate context instead of the current code that silently assumes every report is listing-shaped (currently shows "Listing: undefined" for anything else) -- reuse the existing admin Users search / ban flow rather than building a new inline ban button.

4. Tests: cover the new server-side prior-interaction check (both the shared-conversation and listing-interaction paths, and the rejection case with no qualifying interaction), self-report blocks on both new endpoints, message-content snapshotting, and the admin panel's targetType branching -- matching this repo's existing test conventions and coverage bar.

5. Out of scope, do not implement: any automated ban/content-removal action (all bans stay behind the existing ADMIN-only ban flow with a human decision-maker), a report-priority auto-flagging system (noted as a future enhancement, not needed for this pass), a "block user" feature.

This closes a real, named Trust & Safety gap (company/architecture.md's "Known weaknesses": only listings are reportable today) and is an explicit ai/roadmap.md "Next" priority. Founder has explicitly approved this exact scope including the prior-interaction constraint above (see ai/decisions.md and the approval record appr_ab411474-e4d4-4742-9ed8-f28a463d1d5d for the full decision). Founder requires QA, Security, AND Trust & Safety review before this is considered ready -- make sure the plan includes trust_safety review of the actual implemented code (not just the design), since the prior review was of a version that was never merged and never re-verified. Do not merge to main, do not push to main, do not deploy production -- leave the reviewed branch for the founder to open a PR from and review a real Deploy Preview before merge.

## Founder approval gate

**FOUNDER_APPROVAL_REQUIRED**

- production deployment
- permanent account bans

## Summary

Execution stopped for founder approval. Agents involved so far: trust_safety, designer.

## Files changed

_None (dry run or analysis-only task)._

## Next steps

- Founder review required before this task can proceed — see approval gate reasons above.
