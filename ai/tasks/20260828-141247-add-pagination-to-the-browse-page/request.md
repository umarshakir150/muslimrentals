# Task request

- **Task ID:** 20260828-141247-add-pagination-to-the-browse-page
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-28T14:12:47.086Z

## Objective

Add pagination to the Browse page — listings beyond the first 24 are permanently unreachable

rentals/frontend/src/app/browse/page.tsx:39-53 fetches listings with a hardcoded `limit: 24` and never mutates `filters.page` away from its default anywhere in the codebase (confirmed via repo-wide grep for setPage|filters\.page|page:|infinite|IntersectionObserver, and a glob for **/*agination*/ under src returns no files at all — no pagination component exists). The page does display the real total listing count (`${total} listings across Canada`, browse/page.tsx:98), so a user can see that more listings exist but has no UI path to reach them. The backend's GET /listings already accepts page/limit query params (confirmed working — this was fixed for the map page's limit=200 case per ai/decisions.md), so this is a frontend-only gap. Fix: add pagination controls (numbered pages or a 'Load more' / infinite-scroll pattern) wired to filters.page, reusing the total already returned by the API.

Why this matters (backlog rationale): This is a genuine, evidenced defect in the product's single most core journey — browsing listings — not a cosmetic issue: any city/search with more than 24 active listings has content that is completely unreachable through the UI today, while the page's own total count implies more exists. This sits in the standing operating directive's top priority tiers ('Broken core journeys' / 'Launch-blocking missing functionality'), ahead of any remaining polish or infra item currently in the backlog.

Evidence:
- sig_24716ca6-0d33-433d-8e84-1c0db1080f15
- rentals/frontend/src/app/browse/page.tsx:39-53
- rentals/frontend/src/app/browse/page.tsx:98
