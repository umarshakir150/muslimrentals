# Engineering implementation result

**Task:** 20260828-151147-dead-map-button-on-listing-cards
**Branch:** agents/20260828-151147-dead-map-button-on-listing-cards/frontend
**No changes needed:** no

## Summary

Wired the previously dead 'Map' button on ListingCard (Browse/Saved) to a real deep-link flow instead of removing it, per Designer's recommendation. Browse and Saved now pass `onMap={(l) => router.push(`/map?listingId=${l.id}`)}` instead of a no-op. ListingCard disables (visually muted, `disabled`/`aria-disabled`, tooltip) the Map button for listings lacking lat/lng, since a disabled control is more honest than a navigate-then-fail dead end. The /map page now reads `listingId` from `useSearchParams()` (wrapped in `Suspense`, matching the existing `reset-password/page.tsx` pattern so the page still statically prerenders), and once the listings fetch resolves, pans/centers the map to the matching listing and opens the existing `ListingDetail` overlay (reusing the same component a marker click already opens). If the id isn't found in the fetched set, it shows a toast ('Listing not found...') rather than failing silently, and the map itself still renders normally. The `listingId` param is stripped via `router.replace` after handling so refresh/back-nav doesn't re-trigger it.

## Files changed

- rentals/frontend/src/app/browse/page.tsx
- rentals/frontend/src/app/map/page.tsx
- rentals/frontend/src/app/saved/page.tsx
- rentals/frontend/src/components/listings/ListingCard.tsx

## Test plan

Ran `npm run type-check` (clean) and `npm run build` (succeeds; `/map` still shows as a statically prerendered route `○`, confirming the Suspense boundary correctly isolates `useSearchParams`). Manual code-path review: Browse/Saved → Map button click navigates to `/map?listingId=<id>`; MapPage effect waits for `loading` to finish, finds the listing, calls `setMapCenter` + `setSelectedListing` (reusing existing marker-click UI), then clears the query param. Listings with null lat/lng render the Map button disabled with a title tooltip and no onClick side effect. Did not have a running dev server / browser available in this pass to click through visually — recommend a quick manual pass in the browser (narrow viewport too, per mobile-first) before merge to confirm the ListingDetail overlay opens correctly on deep-link and the toast displays for a stale/missing id.

## Self-check notes

_None._
