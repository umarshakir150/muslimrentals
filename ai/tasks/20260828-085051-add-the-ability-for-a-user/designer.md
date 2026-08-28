# designer analysis

**Task:** 20260828-085051-add-the-ability-for-a-user

## Summary

Scoped the UX for owner-initiated permanent listing deletion. Key finding: there is currently no "My Listings" or owner listing-management surface in the frontend at all — Navbar links to /profile and /saved (rentals/frontend/src/app/layout/Navbar.tsx:133-134) but neither page exists in rentals/frontend/src/app. The only existing "delete a listing" UI pattern is the admin panel's "Remove listing" button (rentals/frontend/src/app/admin/page.tsx:87-97), which has NO confirmation step at all — not a pattern to copy for a user-facing, irreversible action. The only confirmation convention that exists anywhere is a native window.confirm() used for reporting (ListingDetail.tsx:45). There is also an existing backend DELETE /listings/:id that does a SOFT remove (status=REMOVED, isActive=false) with correct ownership checks (listings.ts:270-281) — this is a different, reversible-by-admin action from the new permanent hard-delete this task asks for, and the two must not be confused in copy or routing.

## Findings

1. **[HIGH]** No 'My Listings' page exists yet. This task's brief assumes an owner listing-management view to attach the delete action to; it doesn't exist in the codebase. Building it is in scope for this task, not a pre-existing surface to extend.
   - Evidence: Navbar.tsx:133-134 link to /profile and /saved; neither rentals/frontend/src/app/profile nor /saved has a page.tsx (Glob of app/**/page.tsx confirms only admin, home, browse, contact, map, messages, post, safety, terms, privacy, reset-password exist).
2. **[MEDIUM]** The one existing 'delete a listing' UI pattern (admin panel) has zero confirmation before an irreversible-feeling action, and a second existing endpoint (DELETE /listings/:id) is actually a soft-remove, not the hard delete this task requires. Naming/copy must clearly disambiguate 'Delete listing permanently' from any existing 'remove' language so owners aren't confused about reversibility, and Backend should use a distinct route (do not overload the existing soft-delete DELETE /:id) — flagging for Engineering Lead/Backend.
   - Evidence: admin/page.tsx:87-97 (no confirm dialog); listings.ts:270-281 (soft remove: status=REMOVED, isActive=false).
3. **[INFO]** No reusable modal/dialog component exists to standardize on; ListingDetail.tsx and PostListingModal.tsx / AuthModal.tsx use ad-hoc Framer Motion AnimatePresence overlays with a shared rounded-2xl white-card visual language. New confirm dialog should match that visual language rather than introduce a new one or use window.confirm (too easy to dismiss without reading, no room for real warning copy, not screen-reader-friendly).

## Open questions

- Should 'My Listings' live at a new top-level route or be a tab within a to-be-built /profile page? Either is fine UX-wise but affects nav/IA scope — Engineering Lead should decide given /profile is already a dead link that needs building anyway.
- Should conversations tied to a permanently-deleted listing show any in-UI indicator ('This listing was deleted') in Messages, or just silently lose the listing link? Needs a Messages-surface decision from Frontend/Product, not just the delete dialog copy.

## Recommendation

Before Frontend/Backend start building, Engineering Lead should confirm scope includes creating a minimal "My Listings" page (e.g. /my-listings or under /profile), since no owner-facing listing-management surface exists today — this is a prerequisite, not optional polish. Proposed flow:

**Entry points (both, not either/or):**
1. My Listings list (new page, reachable from Navbar user menu): each row shows title/photo/status/price with a kebab or inline "Manage" affordance exposing Edit and "Delete listing" (destructive, visually secondary — small text-red-600 link/button, not a prominent red block button, so it's findable but not accident-prone).
2. Listing detail view, owner-only footer action block (ListingDetail.tsx currently has no owner action block at all — footer only shows Message/Contact for non-owners): add "Edit" and "Delete listing" buttons visible only when `isOwner` is true, replacing the non-owner Message/Contact row.

**Confirmation dialog (new reusable component, not window.confirm):** Framer Motion overlay matching PostListingModal/AuthModal visual style. Copy:
- Title: "Delete this listing?"
- Body: "This will permanently delete '[listing title]' and its photos. This can't be undone. Any existing conversations about this listing will remain, but will no longer link to a live listing."
- Primary action: "Delete permanently" (red, destructive style) — disabled while request in flight, replaced with a spinner/"Deleting…" label.
- Secondary action: "Cancel" (default focus, so keyboard/screen-reader users don't land on the destructive action).
- Trap focus in the dialog; Escape and backdrop click both act as Cancel.

**States Frontend must build:**
- My Listings empty state (new user, 0 listings): friendly copy + "Post a listing" CTA, not a bare blank list.
- My Listings loading state (skeleton rows, not spinner-only).
- Delete-in-progress state (button disabled/spinner, dialog stays open, background list not yet mutated until success).
- Delete error state (e.g. network failure or 403 from a race condition): inline error text in the dialog ("Couldn't delete this listing. Try again."), dialog stays open, user can retry or cancel — never fail silently.
- Post-success state: toast confirmation ("Listing deleted"), dialog closes, row/card removed from My Listings, and — per the task's cross-surface requirement — any Zustand store or client cache holding this listing (browse results, map markers, saved-listings references) must be pruned by id so the listing disappears without a full reload.

Backend should expose this as its own endpoint distinct from the existing soft-remove DELETE /listings/:id (e.g. a query flag or a separate route) to avoid ambiguity between "remove" (soft, admin-reversible) and "delete" (permanent, S3 cleanup) — Engineering Lead to decide exact routing, but the two must not share unclear semantics. Security must independently verify ownership enforcement per agents/backend.md's object-level authorization checklist before this ships; this review was not performed by Designer and is out of scope here. No live-site verification was performed for this task (pre-implementation design pass, feature doesn't exist yet, so LIVE_SITE_VERIFIED does not apply).
