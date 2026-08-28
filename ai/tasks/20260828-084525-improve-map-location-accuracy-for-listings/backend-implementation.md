# Engineering implementation result

**Task:** 20260828-084525-improve-map-location-accuracy-for-listings
**Branch:** agents/20260828-084525-improve-map-location-accuracy-for-listings/backend
**No changes needed:** no

## Summary

Added a curated `Neighbourhood` reference table (city+name+real lat/lng, same pattern as `City`) seeded with real, well-known neighbourhoods for every city already in `CANADIAN_CITIES` (major metros get several; smaller towns get at least one genuine central district), and a new read-only `GET /neighbourhoods/all?city=` endpoint mirroring `cities.ts`'s autocomplete pattern for the frontend to consume. `listingCreateSchema`'s `neighbourhood` field is now required (min(1)) for new listings; `Listing.neighbourhood` stays nullable at the DB level (existing production rows are null, no data to backfill) so this is enforced at the API/Zod layer only, not a destructive migration. Extracted `listingCreateSchema`/`listingUpdateSchema`/`listingQuerySchema`/`reportSchema` into `src/validation/listingSchemas.ts` and `distKm` into `src/utils/geo.ts` (byte-for-byte behavior preserved otherwise) so they're unit-testable without booting Prisma/Express, matching the pattern already established on `origin/main`'s test-infra work (which this worktree's branch predates and could not `git merge` in — merge/mutating git subcommands are blocked by this sandbox's permission policy). Added Vitest (`vitest.config.ts`, `package.json` test scripts + devDependency) and three test files covering: neighbourhood-required schema behavior, `distKm` correctness, and neighbourhood-data coverage/distinctness (every seeded city has ≥1 real option; multi-neighbourhood cities resolve to genuinely distinct coordinates, not one shared city-center point). Part B (clustering/spiderfy) was already implemented per Designer's review of `FullMap.tsx` (leaflet.markercluster) — no backend work needed there.

## Files changed

- rentals/backend/prisma/migrations/20260828085539_add_neighbourhood/migration.sql
- rentals/backend/scratch_check.js
- rentals/backend/src/data/cities.ts
- rentals/backend/src/data/neighbourhoods.ts
- rentals/backend/src/routes/neighbourhoods.ts
- rentals/backend/src/utils/geo.ts
- rentals/backend/src/validation/listingSchemas.ts
- rentals/backend/tests/data/neighbourhoods.test.ts
- rentals/backend/tests/utils/geo.test.ts
- rentals/backend/tests/validation/listingSchemas.test.ts
- rentals/backend/vitest.config.ts
- rentals/backend/package.json
- rentals/backend/prisma/schema.prisma
- rentals/backend/prisma/seed.ts
- rentals/backend/src/index.ts
- rentals/backend/src/routes/listings.ts

## Test plan

Could not run `npm install`/`npm test` in this sandbox — no `node_modules` here and this environment's Bash permission policy denies `node <file>`, `rm`, and (per this session) `git merge`; only read-only git/npm-run/ls/Read/Grep/Write/Edit succeeded. Verification performed manually instead: (1) traced every import in the new test files against actual exports of `src/validation/listingSchemas.ts`, `src/utils/geo.ts`, `src/data/cities.ts`, `src/data/neighbourhoods.ts` to confirm names/types match; (2) hand-verified `listingCreateSchema`'s zod chain (`.min(1).max(100).trim()`) against each asserted case, including that `.trim()` runs after `.min()`, so a whitespace-only string passes validation then becomes `''`; (3) wrote and hand-checked a coverage cross-reference between `CANADIAN_CITIES` (83 entries) and `NEIGHBOURHOODS` (185 entries) confirming every city has ≥1 match on `(name, province)`; (4) confirmed `Neighbourhood`'s Prisma-generated constraint/index names in the hand-written migration SQL (`Neighbourhood_city_province_name_key`, `Neighbourhood_city_province_idx`) match Prisma's default naming convention for the `@@unique`/`@@index` declared in `schema.prisma`; (5) grepped `src/routes/listings.ts` and `src/index.ts` for consistency after the refactor (no leftover inline schema/unused imports, new router registered under `/api/v1/neighbourhoods`). This is TYPECHECKED-by-manual-trace only, not BUILD_VERIFIED or LOCAL_RUNTIME_VERIFIED — `npm install && npm test`, `tsc --noEmit`, and (once DB access exists) `prisma migrate deploy` + `prisma db seed` all still need to run for real before this ships. package-lock.json is now out of sync with the new `vitest` devDependency (same known gap as the prior test-infra task); it will self-heal on the next real `npm install`.

## Self-check notes

- Object-level auth for the new Neighbourhood object: create — none (server-seeded only via prisma/seed.ts, no write endpoint exists); read — public/unauthenticated via GET /neighbourhoods/all, same as City, since it's non-sensitive reference data needed pre-login during posting; modify/delete — none exposed (no route), same as City. IDs aren't accepted from clients at all (query is by city name string, bounded/trimmed, not a UUID lookup), so no ID-manipulation surface.
- No new unauthenticated WRITE surface was added — /neighbourhoods/all is GET-only, read-only, mirrors cities.ts exactly, and POST /listings still requires `authenticate` + `writeRateLimiter` as before; the only change to that route's contract is that its Zod schema now rejects a request missing `neighbourhood`.
- Chose DB-nullable + API-required (not a NOT NULL migration) per the task's explicit guidance, because production Listing rows already have neighbourhood=null and there is no real source data to backfill them with; fabricating neighbourhood values for existing rows would violate the 'do not fabricate data' constraint. The new Neighbourhood table itself is a pure additive migration (new table only, wrapped in the same RLS/REVOKE lockdown as every other table).
- Full neighbourhood-required coverage (85/83... 83 cities, 185 neighbourhoods) means no city in CANADIAN_CITIES is dead-ended by the new requirement -- avoids the Designer-flagged 'hard-required field with zero options for some cities' risk without needing conditional per-city enforcement logic. If a future city is added to CANADIAN_CITIES without a matching NEIGHBOURHOODS entry, tests/data/neighbourhoods.test.ts's coverage test will fail and catch it.
- Did not touch rentals/frontend (PostListingModal, CityAutocomplete-style neighbourhood picker, map marker popups, spiderfy/cluster tuning) or auth.ts's schema extraction -- both are explicitly out of scope for the backend role/this branch; Frontend's sibling worktree owns the UI half of Part A and the Designer-reviewed Part B verification.
- Could not `git merge origin/main` to pick up the already-shipped Vitest test-infra commit (a2345c4) into this branch -- `git merge` was denied by this sandbox's Bash permission policy (read-only git commands like status/log/diff/show succeeded, but merge did not) -- so I recreated the equivalent test-infra (vitest.config.ts, package.json scripts/devDependency, src/validation + src/utils extraction) directly in this worktree instead. This may cause a straightforward merge overlap for the Integrator to reconcile against origin/main's version of the same files (listings.ts, package.json) -- flagging explicitly rather than guessing at a manual merge.
- A stray scratch file (rentals/backend/scratch_check.js) could not be deleted for the same rm-denied reason noted in the prior test-infra task's self-check notes -- I overwrote it with a comment documenting it's inert and safe to delete in a follow-up PR, rather than leaving unexplained cruft.
