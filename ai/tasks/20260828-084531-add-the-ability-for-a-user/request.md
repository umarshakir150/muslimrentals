# Task request

- **Task ID:** 20260828-084531-add-the-ability-for-a-user
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-28T08:45:31.057Z

## Objective

Add the ability for a user to permanently delete a listing they own.

Background: rentals/backend/prisma/schema.prisma already defines the right cascade behavior for this -- Listing's related rows (ListingImage, ListingAmenity, SavedListing, Conversation -> ConversationParticipant/Message) are all `onDelete: Cascade`, and Report.listingId is `onDelete: SetNull` (so reports about a deleted listing survive with a null listingId rather than vanishing, which is correct -- do not change this). This means a straightforward `prisma.listing.delete()` already does the right thing at the DB level; you should NOT need a schema/migration change for this feature. One thing the DB cascade does NOT handle: ListingImage.key stores each image's S3 object key -- deleting the DB rows does not delete the actual S3 objects, so the delete flow must also remove the real S3 objects (see rentals/backend/src/routes/uploads.ts's existing S3 delete pattern) or you will leak orphaned storage.

Add an "obvious but appropriately placed" delete option to the owner's listing-management UI (their listing detail/edit view and/or "My Listings" list -- follow this app's existing patterns for owner-only actions, e.g. how edit/remove-style actions are already surfaced elsewhere). Require authentication (`authenticate` middleware) and enforce ownership authorization strictly server-side: the backend must verify the listing belongs to `req.user.id` (never trust a client-supplied user id) before deleting -- follow agents/backend.md's "Object-level authorization checklist" exactly and write the answers into the task file. A user must never be able to delete another user's listing by manipulating the frontend request (wrong listing id in the URL/body, tampered auth token, etc.) -- Security must specifically verify this, including testing what happens when a non-owner (or an unauthenticated request) attempts the delete endpoint directly.

Show a clear, unambiguous confirmation dialog before deletion (this is irreversible from the user's perspective) so it can't happen by accident -- match this app's existing dialog/modal conventions if one already exists for a comparable destructive action.

After a successful delete, the listing must cleanly disappear everywhere it could still appear: the owner's "My Listings", browse/search results, map results, any other user's saved-listings list/references, and anywhere else a listing reference is rendered or cached client-side (check for any client-side cache/store that might hold a stale copy, e.g. Zustand state, and invalidate/update it appropriately rather than requiring a full page reload to see the listing gone).

Regression coverage: add automated tests (Vitest is set up in both rentals/backend and rentals/frontend) covering: an owner successfully deleting their own listing (and its related rows/S3 objects being cleaned up), a non-owner being rejected (403/404 as appropriate -- follow existing convention for "not yours" vs "doesn't exist" responses in this codebase), an unauthenticated request being rejected, and the deleted listing actually disappearing from the relevant list/search/map queries afterward.

Have Product/QA confirm the exact current "My Listings"/listing-management UI and existing destructive-action confirmation patterns first, Frontend and Backend work concurrently on the UI and the DELETE endpoint + S3 cleanup, Designer review the confirmation flow and placement (obvious enough to find, not so prominent it invites accidental clicks), and Security do a focused, explicit review of the delete authorization and related-data cleanup specifically (this is the highest-risk item of this batch -- do not skip or soften this review). Integrate, and report real verification levels honestly per agents/qa.md's vocabulary.
