# designer analysis

**Task:** 20260828-084529-replace-the-bedroom-and-bathroom-dropdowns

## Summary

Reviewed current dropdown UX and the full bed/bath data path (PostListingModal.tsx, ListingCard/Detail rendering, ListingFilters.tsx, backend listings.ts + Zod schema). Backend already has sane numeric bounds in place (bedrooms: Float, min 0 max 20; bathrooms: Int, min 0 max 20) that the new client-side inputs should simply mirror — no schema/type change is needed for this task. Proposing a flow that swaps the two `<select>`s for plain `<input type="number">` fields matching the existing Price field pattern already in the same form row, with inline validation errors and a small "0 = studio" hint, and explicitly recommending against half-bath support and custom stepper controls to keep scope tight.

## Findings

1. **[INFO]** Backend Zod schema (rentals/backend/src/routes/listings.ts:38-39) already enforces sane bounds matching the schema types: bedrooms z.number().min(0).max(20) (Float, decimals technically allowed), bathrooms z.number().int().min(0).max(20). Frontend create schema (PostListingModal.tsx:29-30) already mirrors these bounds via z.coerce.number(). This significantly de-risks the task — no schema/type change is needed, only the input widget and its client-side error UI.
   - Evidence: rentals/backend/src/routes/listings.ts:38-39; rentals/frontend/src/components/listings/PostListingModal.tsx:29-30
2. **[LOW]** Current dropdowns cap visible options well below the already-permitted backend range (Beds dropdown: 0-6, Baths dropdown: 1-5, both max 20 server-side). Switching to numeric inputs is also a functional fix, not just a UI swap — it lets posters list larger properties (7+ bed houses, 6+ bath units) that the dropdown silently prevented today.
   - Evidence: PostListingModal.tsx:193-201 vs backend max 20 bound
3. **[LOW]** Bathrooms dropdown today starts at 1 (no 0 option) but the Zod schema allows min 0 on bathrooms. If the new number input's min is set to 0 to match the schema, a 0-bathroom listing becomes enterable for the first time even though it's not a realistic rental unit and the UI never surfaced it before.
   - Evidence: PostListingModal.tsx:199-201 (options start at 1) vs backend bathrooms min(0)
4. **[INFO]** No half-bedroom or half-bathroom rendering convention exists anywhere in the product today (ListingCard/ListingDetail only special-case bedrooms===0 as 'Studio'; bathrooms render as a bare count with no rounding/half logic). Bathrooms is also typed Int in Prisma, not Float, so half-baths aren't representable without a schema change.
   - Evidence: ListingCard.tsx:104-105; ListingDetail.tsx:126-127; rentals/backend/prisma/schema.prisma Listing.bathrooms Int
5. **[INFO]** ListingFilters.tsx (browse/map filter UI) only exposes min-beds/min-baths dropdowns (0/Any + 1-5), even though the backend supports maxBeds/maxBaths too. This task doesn't touch ListingFilters.tsx, but it's worth noting the filter UI itself is unaffected by and unrelated to this change — confirm QA tests filter correctness against the unchanged bedrooms/bathrooms columns, not against any new input widget.
   - Evidence: rentals/frontend/src/components/listings/ListingFilters.tsx:144-172; rentals/backend/src/routes/listings.ts:111-114

## Open questions

- Should the 0-bathroom lower bound be tightened to 1 as part of this task (since no real listing should have 0 bathrooms), or left at 0 to match the existing backend Zod bound exactly? Recommend leaving as-is (0) for this task and flagging the realism gap as a separate backlog item, since tightening it is a minor scope expansion beyond 'swap dropdown for number input.'
- Does Backend want to keep the shared 20-unit ceiling for both fields, or split them (e.g. bedrooms max 20, bathrooms max 10) given real multi-bath units are rarer than multi-bed ones? No product signal either way; 20/20 (status quo) is a reasonable default to ship without further founder input.

## Recommendation

Proceed with the following flow. Frontend and Backend can work concurrently — the backend Zod bounds (0–20, bedrooms Float/no int constraint, bathrooms Int) already match what's proposed here, so Backend's work is confirmation + a couple targeted error-message tweaks, not a schema change.

FLOW — Post Listing form, Step 1 ("Details"), Beds/Baths fields (currently PostListingModal.tsx:191-202):

1. Replace `<select {...register('bedrooms')}>` with:
   `<input {...register('bedrooms')} type="number" inputMode="numeric" step={1} min={0} max={20} placeholder="e.g. 2" className="input-field" />`
   plus a small helper line under the label: "Enter 0 for a studio" (bedrooms===0 already renders as "Studio" on ListingCard/ListingDetail — this hint just makes the same convention legible while typing instead of the reader having to guess what "0" means in a bare number box).
   Add error rendering that doesn't exist today for this field: `{errors.bedrooms && <p className="text-red-500 text-xs mt-1">{errors.bedrooms.message}</p>}` (dropdowns never errored since every option was pre-valid; a free-text number field can be empty/negative/absurd, so this state is new and must ship with the change).

2. Replace `<select {...register('bathrooms')}>` the same way, min=0 (mirrors existing backend bound even though 0-bathroom units are unrealistic — don't silently diverge from the server's allowed range; flag the 0-bathroom edge case as a backlog nit rather than fixing it in this task), max=20, step=1, no decimals. Add matching `errors.bathrooms` rendering.

3. Do NOT add half-bath support. Bathrooms is `Int` in the schema and today's UI has no half-bath convention (ListingCard/Detail just render "{bathrooms} bath" with no rounding logic). Introducing `.5` would require an Int→Float schema/migration change, which the task correctly flags as needing the same care as any schema change — out of scope here.

4. Do NOT expose decimal entry for bedrooms in the UI (keep `step={1}`) even though the Zod/Prisma type is Float and technically permits e.g. 2.5. There's no product convention for fractional bedrooms anywhere in seed data or rendering (only the 0="Studio" special case exists) — allowing decimals in the UI would produce ungainly "2.5 beds" copy on cards with no design behind it. Leave the Float column type untouched (harmless, no need to tighten it in this task) but constrain the input widget to whole numbers.

5. Validation copy (client, react-hook-form + zod, mirrors the existing Price field pattern at PostListingModal.tsx:187-189):
   - Empty/non-numeric: "Enter a number of bedrooms" / "Enter a number of bathrooms"
   - Negative: "Bedrooms can't be negative" / "Bathrooms can't be negative"
   - Over max: "That's higher than we support (max 20)" — reuse the existing backend bound (20) as the client ceiling so client and server never disagree.
   - Do NOT silently clamp out-of-range input — show the inline error and let the user correct it. Silent clamping reads as buggy and undermines the trust-through-clarity goal for this audience.

6. New UI states Frontend must build that didn't exist for the dropdowns: inline error state (see #1/#2), and confirm the default-value state still pre-fills 1 bed / 1 bath on open (existing `defaultValues` at PostListingModal.tsx:55) so the field never renders visually empty on first paint.

7. Stepper buttons / mobile ergonomics: use `inputMode="numeric"` so mobile shows a numeric keypad instead of full QWERTY — cheap, real mobile win, include it. Skip custom +/- stepper buttons for this task: a plain number input satisfies the founder's explicit "numeric input, not dropdown" ask, and for a 0–20 range typed on a numeric keypad the native input is adequate. Building accessible custom stepper controls (proper aria-labels, focus management, tap-target sizing) is real extra scope that wasn't requested — log it as a backlog nice-to-have, not a blocker for this task.

8. ListingFilters.tsx and the backend filter query (listings.ts:111-114, min/max gte/lte on the same `bedrooms`/`bathrooms` columns) need NO changes — the stored column types are unchanged, so filter correctness is a Backend/QA regression-test concern, not a design change. Confirm this explicitly in QA's pass so it isn't assumed rather than verified.

Verification level: LOCAL, code-only (no live-site check performed for this task — it targets an unshipped UI change, so there is nothing yet to observe on https://muslimrentals.netlify.app/; do not claim LIVE_SITE_VERIFIED or MOBILE_VERIFIED until Frontend implements this and it's checked on a phone-width viewport).
