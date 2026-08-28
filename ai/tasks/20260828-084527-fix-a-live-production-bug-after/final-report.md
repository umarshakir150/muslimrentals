# Final task report

- **Task ID:** 20260828-084527-fix-a-live-production-bug-after
- **Final state:** COMPLETE
- **Agents involved:** designer, frontend, qa
- **Correction cycles used:** 0
- **QA verdict:** PASS
- **Security verdict:** N/A

## Objective

Fix a live production bug: after visiting the Map page, map content/overlay remains visible on top of other pages after navigating away (e.g. Map -> Login, Map -> Sign Up, Map -> a listing, Map -> Browse).

This is a real, founder-reproduced live bug, not hypothetical. Root-cause it, don't just patch symptoms. The map is Leaflet-based via react-leaflet (FullMap/MiniMap components per company/architecture.md) inside a Next.js 14 App Router app. Common real causes worth checking specifically: a Leaflet map instance (`L.map(...)`) not calling `.remove()` in a React `useEffect` cleanup function on unmount; Leaflet injecting DOM/CSS panes or controls that end up outside the React-managed subtree (e.g. via a portal or Leaflet's own internal DOM manipulation) so Next.js's route transition doesn't tear them down with the rest of the page; global window/document event listeners Leaflet or a related library adds that are never removed; z-index/stacking-context leftovers from a Leaflet pane or control staying in the DOM/CSS after the React component believes it's unmounted; or component state that assumes it's always mounted and throws/leaks on an interval or resize handler after navigation.

Reproduce it first (Product/QA) to confirm the exact repro path and what's actually left behind (a specific element, a specific control, tile layer remnants, etc. -- inspect the actual DOM/console, don't guess). Then have Frontend fix it so the map, its overlays, controls, markers, event listeners, portals, and any related component state completely clean up on route change away from /map. Test explicitly: Map -> Login, Map -> Sign Up, Map -> a listing detail page, Map -> Browse, and on a mobile viewport, plus normal back/forward navigation. Navigating anywhere else must show only the destination page, nothing left over from the map.

Regression coverage: add an automated test (Vitest + React Testing Library is already set up in rentals/frontend) that mounts the map component, unmounts it, and asserts no leftover DOM nodes/listeners it owns remain attached -- or the closest practical equivalent if a full Leaflet-in-jsdom test isn't practical; if so, at minimum assert the cleanup function is actually registered and invoked, and document what a real browser QA pass must still catch that the automated test cannot.

Designer should sanity-check there isn't also a legitimate transition/animation being mistaken for the bug. Security review is not required for this one (pure UI cleanup bug, no auth/data surface). Report real verification levels honestly -- if you can only get LOCAL_RUNTIME_VERIFIED or BROWSER_VERIFIED (not LIVE_SITE_VERIFIED), say so.

## Founder approval gate

Not required for this task.

## Summary

Task complete. Agents involved: designer, frontend, qa. 0 correction cycle(s) used.

## Files changed

- rentals/frontend/next-env.d.ts
- rentals/frontend/src/components/map/__tests__/dbg.test.tsx
- rentals/frontend/src/components/map/__tests__/mapCleanup.test.tsx
- rentals/frontend/vitest.config.ts
- rentals/frontend/vitest.setup.ts
- rentals/frontend/package-lock.json
- rentals/frontend/package.json
- rentals/frontend/src/components/map/FullMap.tsx
- rentals/frontend/src/components/map/MiniMap.tsx

## Next steps

- Implementer branch "agents/20260828-084527-fix-a-live-production-bug-after/frontend" (frontend) at /home/user/muslimrentals/orchestrator/.worktrees/20260828-084527-fix-a-live-production-bug-after-frontend — not auto-merged by the orchestrator.
