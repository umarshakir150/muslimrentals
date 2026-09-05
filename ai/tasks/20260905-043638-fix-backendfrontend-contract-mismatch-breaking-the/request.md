# Task request

- **Task ID:** 20260905-043638-fix-backendfrontend-contract-mismatch-breaking-the
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-09-05T04:36:38.893Z

## Objective

Fix backend/frontend contract mismatch breaking the prior-interaction moderator-evidence panel

The recently-attempted feature to record which prior-interaction path (shared conversation vs. listing-messaged vs. listing-saved) qualified a USER report (task 20260904-053114-record-which-prior-interaction-path-qualified-a, related to backlog item bl_7a0b37d9) shipped with a contract mismatch: the backend's admin.ts returns the qualifying path as a bare scalar/shape that does not match what the frontend expects (an object of the form { type, listing } with listing.title), so the new moderator-facing evidence never renders correctly in the admin Reports panel. Security review explicitly flagged this must be reconciled before merge. Fix by either (a) having admin.ts join and return the qualifying listing (for LISTING_MESSAGED/LISTING_SAVED paths) in the shape the frontend already expects, or (b) simplifying the frontend to render the plain scalar string the backend actually returns. Re-verify by hitting GET /admin/reports against a real USER report of each of the three qualifying-path types and confirming the panel shows a correct, human-readable label.

Why this matters (backlog rationale): This is a concrete, already-evidenced defect in recently-written code (not speculative) that leaves a shipped Trust & Safety feature non-functional for moderators. It is a narrow, low-risk correction (no schema change, no new auth surface, touches only the response-shape contract between one admin route and one admin UI component) rather than new feature scope, making it a good candidate for immediate correction ahead of larger gated items.

Evidence:
- ai/tasks/20260904-053114-record-which-prior-interaction-path-qualified-a/qa.json: "The frontend's `.listing?.title` optional-chaining anticipates this data but it will never be populated under the current backend implementation."
- ai/tasks/20260904-053114-record-which-prior-interaction-path-qualified-a/security.json: "Backend/frontend contract mismatch renders the new moderator evidence non-functional as merged. — Reconcile the contract before merge..."
