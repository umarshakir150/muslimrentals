# designer analysis

**Task:** 20260828-084425-add-ability-to-report-a-user

## Summary

Designed the report-a-user / report-a-message flow that closes the harassment-via-messaging gap noted in company/architecture.md and ai/roadmap.md. Flow lives entirely inside the existing Inbox (rentals/frontend/src/components/messaging/Inbox.tsx) and reuses/upgrades the existing report pattern rather than inventing a new one — the current listing-report affordance (ListingDetail.tsx) is just a window.confirm() with a hardcoded reason string, which is a weak trust pattern and shouldn't be replicated. Proposing a single shared ReportModal component used by listings, users, and messages.

## Findings

1. **[MEDIUM]** Current listing-report UX (ListingDetail.tsx) uses window.confirm('Report this listing as inappropriate?') with a hardcoded reason of 'Inappropriate content' — no reason category, no description field, no way to recover from a failed submit except a generic error toast. This is inconsistent with the trust-legible standard the product needs and should not be the template copied for user/message reporting.
   - Evidence: rentals/frontend/src/components/listings/ListingDetail.tsx:43-51 — handleReport() calls window.confirm then listingsApi.report(listing.id, 'Inappropriate content') with no reason picker.
   - Recommended action: Replace with the new shared ReportModal (see flow below) and reuse it for listings too, wired to the existing report endpoint — no schema change required for that part.
2. **[MEDIUM]** Inbox.tsx currently has no menu/overflow affordance anywhere (thread header or per-message) to hang a report action off of — this needs new UI chrome, not just a new button.
   - Evidence: rentals/frontend/src/components/messaging/Inbox.tsx:202-218 (thread header, no menu) and :220-245 (message bubbles, no per-message actions).
   - Recommended action: Add a minimal overflow (kebab) button to the thread header, and a lazy-revealed per-message action affordance (see flow) — sized for a 44x44px minimum tap target per mobile-first/accessibility principle.
3. **[INFO]** Report model today only supports a `listingId` target; there is no way to attribute a report to a user or a specific message, and no `reason` enum — reason is a free-text string today.
   - Evidence: rentals/backend/prisma/schema.prisma:204-219 (Report model — reporterId, listingId? only).
   - Recommended action: Engineering to scope additive nullable columns (reportedUserId, messageId) rather than a schema rewrite, to minimize migration risk given the current DB-migration verification gap.

## Open questions

- Should reporting a message/user also give the reporter an option to leave/mute the conversation in the same flow, or is that a separate future affordance? (Recommend separate — keep this pass scoped to reporting only.)
- Does the founder want reported users to be silently unaffected pending moderator review, or should repeated reports auto-flag a conversation for priority review? (Moderation-logic question for Engineering/Trust & Safety, not a UI question.)
- Is the DB-migration verification gap (mem_480b2bf7) close to being resolved, or should the narrow additive-column migration proposed here be attempted despite it, with manual verification against a real Postgres before merge?

## Recommendation

Build a shared ReportModal (reason picker + optional description + context preview) and two entry points in Inbox.tsx: (1) a "Report [name]" item in a new thread-header overflow menu, reporting the other conversation participant; (2) a "Report" action on a kebab/long-press menu on the other participant's message bubbles only (never on the user's own messages). Do not build a "Block" affordance in this pass — it's out of scope and no backend support exists; don't let a report UI imply blocking happens automatically. To keep this off the DB-migration verification wall currently stalling bl_368a454b, ask Engineering to scope the schema change as narrowly as possible: add nullable `reportedUserId` and `messageId` columns alongside the existing nullable `listingId` on the current `Report` model (additive, non-breaking) rather than a parallel model or an enum rewrite — and confirm with Engineering/founder whether this migration can be verified before starting, per the standing DB-migration gap. As a low-risk, no-schema-change first step, Frontend/Engineering could ship the ReportModal component and wire it to the *existing* `/listings/:id/report` endpoint immediately (replacing the window.confirm on ListingDetail.tsx) to validate the shared UI pattern while the user/message backend work is scoped separately.
