# Task request

- **Task ID:** 20260825-053836-build-the-missing-saved-page-so
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-25T05:38:36.035Z

## Objective

Build the missing /saved page so signed-in users can view their saved rental listings.

Save/unsave and the isSaved indicator on a listing already work end-to-end: POST /listings/:id/save toggles a SavedListing row with a unique (userId, listingId) constraint in rentals/backend/prisma/schema.prisma; GET /listings and GET /listings/:id already return isSaved per user; save/unsave heart-icon buttons already exist in rentals/frontend/src/components/listings/ListingCard.tsx and ListingDetail.tsx. GET /users/me/saved and usersApi.getSaved() already exist on the backend and API client but are never called from any page. The Navbar's user menu already links to href: '/saved', but no /saved route exists in rentals/frontend/src/app, so that link currently leads nowhere.

Do NOT rebuild save/unsave or the SavedListing model — that already works. Scope:

1. Frontend: build the /saved page. Call usersApi.getSaved(), render results using the existing ListingCard grid pattern used on the /browse page, and handle empty state (no saved listings yet), loading state, and error state consistent with existing patterns. Gate access the same way other authenticated-only pages in this app already handle a logged-out visitor — do not invent a new auth pattern. Unsaving a listing from this page (via the existing ListingCard save toggle) should update the visible list.

2. Backend: audit the existing save/unsave implementation (listings.ts's POST /listings/:id/save, users.ts's GET /users/me/saved, and the SavedListing model) for authorization/ownership correctness (can a user ever read or affect another user's saved-listing rows), duplicate-save handling, behavior once a saved listing is later removed, invalid/malformed listing IDs, and unauthenticated request handling. Only change code if the audit finds an actual gap — do not modify working code just to have something to change. Any schema change must be additive and non-destructive.

3. Do not introduce new dependencies. Do not modify messaging, admin, or unrelated pages.
