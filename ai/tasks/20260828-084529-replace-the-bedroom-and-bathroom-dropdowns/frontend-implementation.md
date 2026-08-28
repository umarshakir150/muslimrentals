# Engineering implementation result

**Task:** 20260828-084529-replace-the-bedroom-and-bathroom-dropdowns
**Branch:** agents/20260828-084529-replace-the-bedroom-and-bathroom-dropdowns/frontend
**No changes needed:** no

## Summary

Replaced the Beds/Baths `<select>` dropdowns in PostListingModal.tsx (Step 1 of the post-listing flow) with plain numeric `<input type="number">` fields per Designer's spec, matching the existing Price field's `input-field` styling and mobile numeric-keypad convention (`inputMode="numeric"`). Extracted the bedrooms/bathrooms Zod validation into a new shared module (`src/lib/listingValidation.ts`) so it's independently unit-testable and so PostListingModal.tsx's client-side schema now imports the same bounds (min 0, max 20, bathrooms integer-only) already enforced server-side per Designer's finding — no backend schema/type change needed, this is a pure UI-layer swap. Added inline error rendering for both fields (new state — dropdowns never had invalid values before) and a "Enter 0 for a studio" hint reflecting the existing bedrooms===0 "Studio" convention used elsewhere (ListingCard/ListingDetail). Kept bedrooms input to whole-number steps in the UI (no decimal entry) since no fractional-bedroom convention exists anywhere in the product today, even though the underlying Prisma/Zod type is Float. Did not touch ListingFilters.tsx or any filter query logic — confirmed it uses separate `minBeds`/`minBaths` dropdown filters against the same unchanged `bedrooms`/`bathrooms` columns, so browse/map filtering is unaffected by this change. Also set up a minimal Vitest harness for the frontend package (previously absent despite the task brief assuming it existed) — `vitest.config.ts`, `test` script, `vitest` devDependency — and added `src/lib/listingValidation.test.ts` (13 tests) covering: studio (0), typical values, the max bound (20), negative rejection, absurd-value rejection (500), non-numeric rejection, and bathrooms' integer-only constraint (rejects 1.5). Added `next-env.d.ts` to `.gitignore` (untracked auto-generated file, standard Next.js convention, unrelated noise from running type-check).

## Files changed

- rentals/frontend/src/lib/listingValidation.test.ts
- rentals/frontend/src/lib/listingValidation.ts
- rentals/frontend/vitest.config.ts
- rentals/frontend/.gitignore
- rentals/frontend/package-lock.json
- rentals/frontend/package.json
- rentals/frontend/src/components/listings/PostListingModal.tsx

## Test plan

Ran `npm install` then `npm run test` (all 13 Vitest cases pass) and `npm run type-check` (`tsc --noEmit`, clean) in `rentals/frontend`. This is code-level/unit verification only — no dev server or browser check was performed (no `npm run dev` + manual click-through of the Post Listing modal, no mobile-viewport screenshot, no live browse/map filter check against posted listings). Backend's mirrored Zod bounds were confirmed by reading `rentals/backend/src/routes/listings.ts` (already 0–20 for both fields, bathrooms `.int()`) per Designer's prior finding, but I did not independently run the backend test suite or a live create-listing round trip. `npm run lint` could not run non-interactively (repo's ESLint has never been configured — pre-existing gap, unrelated to this change, left as-is). Recommend a follow-up manual/browser pass (dev server + phone-width viewport) before this is called fully verified, consistent with Designer's own "code-only, not LIVE_SITE_VERIFIED" caveat.

## Self-check notes

- Did not modify ListingFilters.tsx, listing card/detail rendering, or any backend files — those are out of this agent's scope and Designer confirmed no changes needed there.
- Backend Zod schema was not touched or re-verified live by me; Backend engineer should independently confirm/mirror per the task brief.
- No live-site or browser verification performed — flagged explicitly in testPlan rather than overclaiming.
