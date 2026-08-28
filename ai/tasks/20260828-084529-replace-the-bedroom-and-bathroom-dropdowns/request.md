# Task request

- **Task ID:** 20260828-084529-replace-the-bedroom-and-bathroom-dropdowns
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-28T08:45:29.099Z

## Objective

Replace the Bedroom and Bathroom dropdowns on the Post Listing form with plain numeric inputs.

Background: rentals/backend/prisma/schema.prisma's Listing model has `bedrooms Float` and `bathrooms Int`. The Post Listing form (PostListingModal.tsx) currently uses dropdown selects for these; the same values are also used as filter criteria on the browse/map pages (check ListingFilters and the corresponding backend query params in rentals/backend/src/routes/listings.ts for the exact filter contract -- min/max range params, exact-match params, whatever the existing pattern is).

Replace both dropdowns with simple numeric `<input type="number">`-style fields (matching this app's existing `input-field` styling convention). Add sensible client-side validation: no negative values, a reasonable sane upper bound (e.g. reject absurd values like 500 bedrooms), and correct handling of the fact bedrooms is a Float in this schema (studio/0.5 conventions may exist -- check how bedrooms is currently used/rendered elsewhere, e.g. listing cards or detail pages, e.g. "Studio" for 0, before deciding whether to allow decimals or restrict to sensible increments) while bathrooms is an Int (whole numbers, or standard real-estate half-bath convention if that's how it's used today -- verify against the actual schema type, don't assume). Mirror the same validation server-side in the Zod create/update-listing schema -- client-side validation is UX only, never the security/correctness boundary.

Make sure the browse/map filters continue to work correctly against these fields after the input method changes -- the stored data shape/type must not change in a way that breaks existing filter queries or existing listings' stored values. If any type adjustment turns out to be genuinely necessary, treat it with the same care as any schema change (additive/reversible, documented, not applied to production without it being called out clearly).

Test posting listings with a range of realistic bed/bath values (including edge cases like 0 bedrooms/studio, and whatever the top of your sane validation range is) and verify browse/map filtering by bed/bath count returns the correct listings both before and after this change, so existing filter behavior isn't regressed.

Regression coverage: add automated tests (Vitest is set up in both rentals/backend and rentals/frontend) covering the numeric input's validation rules and the backend schema's validation, plus a filter-correctness test if practical against the existing filter query logic.

Have QA/Product confirm current dropdown behavior and the exact filter contract first, Frontend and Backend can work concurrently once that contract is confirmed, Designer review whether plain numeric inputs are actually the friendliest UI here (e.g. should there be +/- stepper affordances, is a bare number input awkward on mobile) while keeping the founder's explicit ask (numeric inputs, not dropdowns) as the baseline. Security review is low-priority here (no new auth surface) but Security should still glance at the schema change for basic input-bounds sanity. Report real verification levels honestly.
