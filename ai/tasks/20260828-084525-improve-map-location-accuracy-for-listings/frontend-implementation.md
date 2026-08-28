# Engineering implementation result

**Task:** 20260828-084525-improve-map-location-accuracy-for-listings
**Branch:** agents/20260828-084525-improve-map-location-accuracy-for-listings/frontend
**No changes needed:** no

## Summary

Frontend half of Part A + Part B. Added a required, dependent Neighbourhood autocomplete to PostListingModal (mirrors CityAutocomplete's chrome exactly, disabled with "Select a city first" until a city is chosen, per-city suggestion list), made `neighbourhood` required (non-empty, trimmed) in the client Zod schema (extracted to src/lib/postListingSchema.ts), and wired neighbourhood-level coordinate resolution: selecting a curated suggestion sets lat/lng from that neighbourhood's real coordinates (src/lib/neighbourhood.ts's findNeighbourhoodCoords), never a city-center guess. To avoid the posting dead-end Designer flagged (a city with zero seeded neighbourhoods), the field accepts free text too -- typing always satisfies "required," but only a real curated match (via selection or exact match on blur) upgrades coordinates past the city fallback; a per-city helper note explains when no curated list exists yet. Selecting a new city clears any previously-selected neighbourhood so stale coordinates never leak across cities. Confirmed Part B (clustering/spiderfy) was already implemented via leaflet.markercluster in FullMap.tsx; refactored its config/icon-building/label logic into src/lib/mapMarkers.ts (pure, no Leaflet/DOM dependency) for testability, without changing behavior. Added neighbourhood to the map popup location label (falls back to city-only for older null-neighbourhood listings) -- ListingCard/ListingDetail already displayed it. Padded marker + cluster tap targets to the ~44px accessibility minimum via a wrapping .rental-marker-hit hit-area (visual pill size unchanged) per Designer's note. Added Vitest (not previously present in frontend despite the task brief's assumption) with a jsdom config and 19 passing tests: schema requires neighbourhood (rejects missing/empty/whitespace-only), coordinate resolution produces real distinct per-neighbourhood coordinates (never city center, never fabricated for free text), and cluster-config/touch-target regression guards.

## Files changed

- rentals/frontend/next-env.d.ts
- rentals/frontend/src/components/ui/NeighbourhoodAutocomplete.tsx
- rentals/frontend/src/lib/__tests__/mapMarkers.test.ts
- rentals/frontend/src/lib/__tests__/neighbourhood.test.ts
- rentals/frontend/src/lib/__tests__/postListingSchema.test.ts
- rentals/frontend/src/lib/mapMarkers.ts
- rentals/frontend/src/lib/neighbourhood.ts
- rentals/frontend/src/lib/postListingSchema.ts
- rentals/frontend/vitest.config.ts
- rentals/frontend/package-lock.json
- rentals/frontend/package.json
- rentals/frontend/src/app/globals.css
- rentals/frontend/src/components/listings/PostListingModal.tsx
- rentals/frontend/src/components/map/FullMap.tsx
- rentals/frontend/src/lib/api.ts

## Test plan

Ran locally in this worktree (network-enabled npm install succeeded): `npm run test` (Vitest) -- 3 files, 19/19 passed. `npm run type-check` (tsc --noEmit) -- clean, zero errors. `npm run build` (next build) -- compiled successfully, all 14 routes generated. Could not do a real-browser/manual click-through of the posting flow or the spiderfy interaction in this sandbox (no way to launch a browser here), so this is TYPECHECKED + BUILD_VERIFIED, not LOCAL_RUNTIME_VERIFIED or LIVE_SITE_VERIFIED -- recommend QA do a real dev-server + phone-viewport pass of: (1) posting flow with a city that has seeded neighbourhoods vs. one that doesn't, (2) map popup showing "Neighbourhood, City", (3) spiderfy tap-to-expand/tap-elsewhere-to-collapse on a touch device.

## Self-check notes

- ASSUMED BACKEND CONTRACT (needs Backend/Integrator confirmation): GET /neighbourhoods/all?city=<name> returning {data: {name, city, lat, lng}[]}, mirroring the existing /cities/all pattern. I did not implement this endpoint, the Neighbourhood Prisma model/table, the seed data, or the backend Zod schema change (listings.ts's neighbourhood is still .optional() in this worktree) -- that's Backend's file per role ownership, working concurrently in their own worktree. Frontend will silently degrade to free-text-only entry (still valid, city-fallback coordinates) if that endpoint doesn't exist or returns 404s -- confirm Backend ships a matching route before this merges.
- Client-side Zod requiring neighbourhood is UX only, per role boundaries -- the real security/validation boundary is Backend's schema, which Backend must also update for this to be enforced server-side.
- Did not touch MiniMap.tsx (homepage decorative widget using hardcoded DEMO_LISTINGS, unrelated to real listing data) -- out of scope.
- Could not verify in a real browser/device; all verification is TYPECHECKED + BUILD_VERIFIED (tsc --noEmit clean, next build succeeds, 19/19 Vitest tests pass) plus LOCAL_RUNTIME_VERIFIED is NOT claimed since I never started `next dev` and clicked through the UI in this sandbox.
- Left next-env.d.ts as an untracked build artifact generated by npm install/build (not previously committed, not gitignored either) -- flagging in case the orchestrator's auto-commit picks it up; it's a harmless standard Next.js file, safe either way.
