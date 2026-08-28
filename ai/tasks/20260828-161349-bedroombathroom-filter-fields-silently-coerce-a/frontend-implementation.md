# Engineering implementation result

**Task:** 20260828-161349-bedroombathroom-filter-fields-silently-coerce-a
**Branch:** agents/20260828-161349-bedroombathroom-filter-fields-silently-coerce-a/frontend
**No changes needed:** no

## Summary

bedroomsSchema/bathroomsSchema in rentals/frontend/src/lib/listingValidation.ts used z.coerce.number(), and since Number('') === 0, clearing the Beds/Baths input in PostListingModal silently coerced to a valid 0 instead of surfacing the intended 'Enter a number of bedrooms/bathrooms' error. Wrapped both schemas in z.preprocess to map '' to undefined before coercion, and added matching required_error/invalid_type_error messages so an emptied field now fails validation with the expected copy. 0 itself (studio listings) is still accepted as before. Added regression tests for the empty-string case for both schemas in listingValidation.test.ts.

## Files changed

- rentals/frontend/src/lib/listingValidation.test.ts
- rentals/frontend/src/lib/listingValidation.ts

## Test plan

Added `rejects an emptied field instead of silently coercing to 0` tests to listingValidation.test.ts for both bedroomsSchema and bathroomsSchema, asserting safeParse('') fails and returns the 'Enter a number of bedrooms'/'Enter a number of bathrooms' message. Verified by tracing zod v3.22.4's coercion/parsedType logic (Number(undefined) => NaN => zod's special 'nan' parsedType => invalid_type issue) confirms the preprocessed empty-string input now fails with the intended message; unable to execute `npx vitest run` in this sandbox because the Bash tool was denied for non-trivial commands during this session, so this should be spot-checked by CI/QA by running `cd rentals/frontend && npx vitest run src/lib/listingValidation.test.ts`. Manually confirmed existing valid cases (0, typical values, max) and existing invalid cases (negative, too large, non-numeric 'abc') are unaffected by the preprocess wrapper.

## Self-check notes

- Confirmed bedroomsSchema/bathroomsSchema are only consumed by postListingSchema.ts (used in PostListingModal) — no separate filter-field schema exists elsewhere in the codebase, despite the task title mentioning 'filter fields'; the task body and evidence confirm listingValidation.ts is the correct and only target.
- Could not execute the test suite directly in this session (Bash tool denied for real commands); reasoning verified against zod v3.22.4's known coercion/parsedType semantics instead. Recommend CI or a follow-up run confirms `npx vitest run src/lib/listingValidation.test.ts` passes.
