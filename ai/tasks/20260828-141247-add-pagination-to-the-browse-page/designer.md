# designer analysis

**Task:** 20260828-141247-add-pagination-to-the-browse-page

## Summary

Browse page fetches with a hardcoded limit=24 and filters.page is never advanced by any UI, so listings beyond the first page are permanently unreachable even though the header already displays the true total. filterStore already resets page to 1 on any filter change (filterStore.ts:33,36) and preserves it when the change is to 'page' itself, so the store-level plumbing for pagination already exists — this is purely a missing UI control plus one call site wiring.

## Findings

1. **[HIGH]** Listings beyond the first 24 (per current city/filter combination) are completely unreachable in the UI despite the page displaying the true total count, making the core browse journey broken for any search returning more than 24 results.
   - Evidence: rentals/frontend/src/app/browse/page.tsx:39-53 (limit: 24 hardcoded, page: filters.page||1 never advanced by any control); rentals/frontend/src/app/browse/page.tsx:98 (total count displayed to user with no path to reach beyond page 1)
2. **[INFO]** filterStore already resets page to 1 on any non-page filter change and preserves page when the change is to page itself, so no new state-reset logic is needed in the store — only a UI control and an append-vs-replace tweak to fetchListings.
   - Evidence: rentals/frontend/src/store/filterStore.ts:25,33,36

## Open questions

- Should Load More be capped at some max page count for very large result sets (e.g. thousands of listings in one city), or is that not a realistic scale concern yet?
- Does the backend pagination response include a stable `hasMore`/`totalPages` field, or should the frontend derive completion purely from listings.length >= total (need Backend/Frontend to confirm exact GET /listings response shape before implementation)?

## Recommendation

Add a numbered "Load more" pagination pattern (not infinite scroll) to Browse, wired to the existing filters.page/setFilter('page', n) state, reusing `total` and `pagination` already returned by GET /listings. Flow: (1) render grid of up to 24 results as today; (2) below the grid, if `listings.length < total` (i.e. current page * 24 < total), render a centered "Load more listings" button in the existing btn-ghost/btn-brand style, sized to a comfortable mobile tap target (min 44px height); (3) on click, call setFilter('page', filters.page + 1), fetch the next page, and APPEND the new results to the existing `listings` array (do not replace) so scroll position is preserved — this requires changing fetchListings' setListings(res.data) to append when filters.page > 1 and replace when filters.page === 1 (e.g. reset on filter/sort change, append on page-only change); (4) while fetching the next page, replace the button with a small inline loading state ("Loading more...") in the same slot rather than a full-page skeleton, so already-loaded cards don't disappear; (5) once listings.length >= total, hide the button entirely (no "you've reached the end" needed, hiding the control is enough); (6) on fetch error for a subsequent page, show inline error text with a "Try again" retry button in the same slot rather than losing already-loaded results or triggering the full-page error state. Keep the existing full-page skeleton/error/empty states unchanged for the initial page-1 load. This is scoped to browse/page.tsx only — do not touch the map page's separate limit=200 fetch or ListingFilters. New states Frontend must build: (a) load-more button (default), (b) load-more loading state, (c) load-more error/retry state, (d) hidden state once fully loaded. No destructive-action or trust/legal concerns — this is a pure discovery-completeness fix.
