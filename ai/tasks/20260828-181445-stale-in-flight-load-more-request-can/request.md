# Task request

- **Task ID:** 20260828-181445-stale-in-flight-load-more-request-can
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-28T18:14:45.934Z

## Objective

Stale in-flight 'Load more' request can append filter-mismatched listings after a filter change on Browse

If a user changes a filter (e.g. city) while a page-2+ 'Load more' fetch is still in flight, the stale request's callback captures isFirstPage=false from its own closure and appends its (now filter-mismatched) results onto the freshly-replaced page-1 listings for the new filter once it resolves after the new fetch completes. This is a pre-existing pattern (no request cancellation/AbortController anywhere in fetchListings, before or after the pagination fix) rather than something newly introduced by that fix, and needs a specific timing window to trigger.

Why this matters (backlog rationale): Flagged directly by QA during the pagination task's review (sig_419a26eb) as a real, if narrow, correctness edge case in the product's core browse journey. Deliberately not selected this cycle: fixing it properly means introducing request sequencing/AbortController into fetchListings, a broader change than a quick patch, and QA characterized it as a pre-existing, narrow-window issue rather than an urgent regression — better scoped and fixed deliberately in its own pass than rushed.

Evidence:
- ai/tasks/20260828-141247-add-pagination-to-the-browse-page/qa.json
