# Task request

- **Task ID:** 20260918-003706-add-request-cancellation-abortcontroller-to-browses
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-09-18T00:37:06.278Z

## Objective

Add request cancellation (AbortController) to Browse's fetchListings to fix stale-filter race on 'Load more'

QA flagged during the pagination task that if a user changes a filter (e.g. city) while a page-2+ 'Load more' fetch is still in flight, the stale in-flight request's callback still has isFirstPage=false captured in its closure and will append its (now filter-mismatched) results onto the freshly-replaced page-1 listings once it resolves after the new filter's page-1 fetch completes. This is a pre-existing pattern (no AbortController/request-sequencing anywhere in fetchListings) rather than something newly introduced by any single task, and requires a specific timing window to trigger, so it has never surfaced as a user-facing bug report. A prior task already fixed the narrower 'stale in-flight Load More vs. another Load More' race with a requestIdRef sequencing guard (ai/tasks/20260828-181445), but that fix does not cover the cross-filter-change case described here.

Why this matters (backlog rationale): Concrete, already-evidenced gap from a QA review of shipped code (not speculative), on the app's primary listing-discovery journey (Browse). Narrow timing window and no reported user impact to date keep this low priority relative to everything else in the backlog, but it is a real correctness gap worth tracking so it isn't lost.

Evidence:
- ai/tasks/20260828-141247-add-pagination-to-the-browse-page/qa.json: "if a user changes a filter (e.g. city) while a 'Load more' (page 2+) fetch is still in flight, the stale in-flight request's callback captures isFirstPage=false from its own closure and will append its (now filter-mismatched) results onto the freshly-replaced page-1 listings for the new filter... no request cancellation/AbortController anywhere in fetchListings, before or after this change"
