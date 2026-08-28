# designer analysis

**Task:** 20260828-151147-dead-map-button-on-listing-cards

## Summary

The 'Map' button on ListingCard (Browse/Saved) is a dead no-op — visibly interactive but does nothing, which undermines trust. Recommend wiring it to a real deep-link flow to /map rather than removing it, since jumping from a specific listing to its location on the map is a legitimate, expected use case for this audience (proximity to mosques, neighbourhood context matter more here than on generic rental sites).

## Findings

1. **[LOW]** ListingCard's 'Map' button (rentals/frontend/src/components/listings/ListingCard.tsx:126-131) is rendered as a fully interactive, hover-styled button but is wired to a no-op (`onMap={() => {}}`) from both Browse (browse/page.tsx:141) and Saved (saved/page.tsx:137). This is a visible dead control on the primary listing-discovery surface.
   - Evidence: rentals/frontend/src/app/browse/page.tsx:141, rentals/frontend/src/app/saved/page.tsx:137, rentals/frontend/src/components/listings/ListingCard.tsx:126-131
   - Recommended action: Wire to /map?listingId= deep link per recommendation above; do not remove, since per-listing map context (mosque/neighbourhood proximity) is core to this product's value prop.
2. **[INFO]** map/page.tsx has no query-param handling at all today — `selectedListing` is only ever set from a marker click inside the page (map/page.tsx:95). Some listings have nullable lat/lng (types/index.ts:119-120), so a deep-link target may not always be plottable.
   - Evidence: rentals/frontend/src/app/map/page.tsx (full file, no useSearchParams import)
   - Recommended action: Add searchParams handling as described; disable the Map button client-side for listings without coordinates rather than relying solely on a map-side not-found fallback.

## Open questions

- Should the disabled-state Map button (for listings with no coordinates) be hidden entirely instead of shown-but-disabled? Hiding avoids a visible dead control but changes card layout consistency across the grid — leaning toward disabled-with-tooltip/toast for layout consistency, but worth Frontend's call.
- Does `listingsApi.getAll({ limit: 200 })` on the map page reliably include any listing a user could have seen in Browse/Saved (which may paginate beyond 200 or apply different filters)? If not, the 'not found' fallback path will be hit fairly often and may need a dedicated single-listing fetch (`listingsApi.getOne(id)`) instead of relying on the bulk 200-listing fetch — recommend Frontend/Backend confirm which is cheaper before implementing.

## Recommendation

Wire the button to a deep link instead of removing it. Flow:

1. **Trigger (Browse/Saved cards):** `onMap={(l) => router.push(`/map?listingId=${l.id}`)}`. Keep `e.stopPropagation()` already on the button (line 127) so it doesn't also fire card `onView`.
   - If the listing has no `lat`/`lng` (nullable per `types/index.ts:119-120`), don't navigate — instead the button should be visually/functionally disabled for that card (`aria-disabled`, muted styling, no onClick) OR on click show a toast: "Location not available for this listing." Recommend disabling proactively rather than navigate-then-fail, since a disabled state is more honest and still avoids a second dead-end interaction.

2. **Landing (`/map` page):** Read `listingId` from `useSearchParams()`. After `fetchListings()` resolves, find the matching listing in the fetched array:
   - **Found + has coords:** call `setMapCenter([lat, lng])` and `setSelectedListing(listing)` — this reuses the exact same `ListingDetail` overlay that clicking a map marker already produces (`map/page.tsx:100-106`), so the destination state is not new UI, just reached a new way. Also pan/zoom the map to that point (FullMap already accepts `center`).
   - **Not found** (e.g. listing fell outside the `limit: 200` fetch, or was removed since the card was rendered): don't silently do nothing. Show a small inline banner/toast: "This listing couldn't be located on the map right now." Do not throw a blocking error — the map itself should still render normally with all other listings, since the primary map browsing use case must keep working.
   - Clear `listingId` from the URL after handling it (`router.replace('/map', { scroll: false })` or similar) so a page refresh/back-nav doesn't repeatedly re-trigger the same auto-select, and so sharing/bookmarking the map URL doesn't carry stale intent.

3. **Loading state:** the existing full-map loading overlay (`map/page.tsx:69-87`, spinner + "Loading listings...") already covers the fetch window before the deep-link target can be resolved — no new loading state needed, just don't attempt the `listingId` match until `loading` is false.

New UI states Frontend will need to build:
- Disabled/no-op styling for the Map button on cards whose listing lacks coordinates (empty-state-adjacent case, not a full empty state).
- Not-found toast/banner on `/map` when a deep-linked `listingId` doesn't resolve to a listing in the current fetch.
- URL cleanup after handling the param (not visible to user, but required so back/forward and refresh don't misbehave).

No new destructive-action confirmation needed — this is pure navigation, not a mutation. No Legal/founder sign-off needed — doesn't touch money, payments, or legal copy.
