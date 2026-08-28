# Engineering implementation result

**Task:** 20260828-084527-fix-a-live-production-bug-after
**Branch:** agents/20260828-084527-fix-a-live-production-bug-after/frontend
**No changes needed:** no

## Summary

Root-caused and fixed the map-persists-after-navigation bug, confirming Designer's analysis: FullMap.tsx and MiniMap.tsx both create their Leaflet instance inside an async IIFE (`await import('leaflet')` [+ `leaflet.markercluster` for FullMap]) nested in a useEffect. If the user navigated away from /map before that dynamic import resolved, the effect's cleanup ran as a no-op (nothing to remove yet), and the async callback then finished *after* unmount and built a full orphaned map — tiles, marker cluster, click listener, global `window.__mapListingClick` bridge, and a ResizeObserver — with no cleanup ever registered for it, so it stayed rendered on top of whatever page the user navigated to. FullMap's ResizeObserver-disconnect logic had the same race, reading `containerRef.current.__leaflet_ro` off a ref React had already nulled during the same unmount.

Fix (both components): capture a `cancelled` boolean and the container DOM node in local variables at effect start; check `cancelled` immediately after the dynamic import resolves (and again right after `L.map()` is constructed, as defense-in-depth for the narrow synchronous window between those lines) and bail out before ever attaching tiles/markers/listeners if the component has already unmounted; have cleanup set `cancelled = true` first, then tear down whatever was actually created (map instance, ResizeObserver, global click bridge). FullMap's staggered `invalidateSize` calls (via `requestAnimationFrame`/`setTimeout`) also now check `cancelled` before touching a possibly-removed map. This guarantees nothing Leaflet-owned is ever left attached to the DOM once the React component believes it's unmounted, regardless of when the async init resolves relative to navigation — fixing Map → Login, Sign Up, listing detail, Browse, and back/forward navigation identically, since all of them go through the same React unmount/cleanup path.

Also stood up Vitest + React Testing Library for this repo (not actually present despite the task brief's assumption — package.json had no test tooling and no config existed) and added regression tests exercising exactly this race for both components, plus a normal-unmount teardown test verifying map.remove(), ResizeObserver.disconnect(), and the global click-bridge cleanup all fire.

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

## Test plan

Ran `npm run test` (Vitest): 5/5 passing, including the two new race-condition regression tests (FullMap + MiniMap unmount-before-Leaflet-resolves) and a normal-unmount teardown test for FullMap and MiniMap. Ran `npm run type-check` (`tsc --noEmit`): clean, no errors.

Verification level: LOCAL_RUNTIME_VERIFIED only (automated test suite + type-check). I did NOT perform a real-browser pass — no browser tooling was available in this session — so the explicit manual checks the task requires (Map → Login, Map → Sign Up, Map → listing detail, Map → Browse, back/forward navigation, and a mobile viewport, watching the actual DOM/console for leftover Leaflet panes/controls) are still outstanding and must be done by QA/a BROWSER_VERIFIED pass before this is called fully done, per the task's own instruction to report real verification levels honestly.

What the automated test can and cannot catch, documented in the test file's header comment: it proves the cancellation guard prevents `L.map()`/tileLayer/marker/cluster construction (or removes it immediately) when unmount happens before/around Leaflet's dynamic import resolving, and proves normal unmount calls `map.remove()`, disconnects the ResizeObserver, and clears `window.__mapListingClick` — using a fully mocked `leaflet`/`leaflet.markercluster` in jsdom. It cannot catch real Leaflet DOM/CSS pane leftovers, actual visual overlap/z-index issues, or the browser's native back/forward (bfcache) navigation path specifically, since jsdom has no real layout/painting and this test only exercises the React-unmount path, not history restoration.

Note: also had to add a `next-env.d.ts` (Next.js auto-generates this on first `tsc`/`next` invocation; it's standard boilerplate, not hand-edited) and could not delete a stray debug-named test file (`__tests__/dbg.test.tsx`) because `rm`/`mv` were blocked by this session's sandbox policy — repurposed it into a small legitimate assertion (verifies the jsdom `ResizeObserver` stub is present) rather than leaving throwaway content, but flagging the filename as a minor cosmetic wart for whoever reviews the diff.

## Self-check notes

- Root cause matches Designer's pre-analysis (async-init/unmount race), confirmed by writing a failing test first that reproduced the exact scenario, then fixing FullMap.tsx and MiniMap.tsx and watching the test go green.
- Verification is LOCAL_RUNTIME_VERIFIED (vitest + tsc) only — no real browser was used, so the task's explicit browser/mobile/back-forward checks are still pending and should go to QA before this is considered fully closed.
- Could not delete a stray debug test file due to sandboxed rm/mv restrictions in this session; repurposed its content into a real, harmless assertion instead of leaving it empty or misleading.
