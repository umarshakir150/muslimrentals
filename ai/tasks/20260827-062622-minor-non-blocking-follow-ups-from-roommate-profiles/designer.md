# designer analysis

**Task:** 20260827-062622-minor-non-blocking-follow-ups-from-roommate-profiles

## Summary

Reviewed both flagged items. Item 2 (participants.every() in POST /roommate-profiles/:id/message) is a backend hardening question, not a design one — no UX surface, out of scope for this role. Item 1 (the "Either" audience pill only strictly matching profiles with audiencePref=EITHER, missing profiles that left the field unset) is confirmed in code: RoommateProfileFormModal.tsx renders audiencePref as three radio options (Brothers only / Sisters only / Either) with no option pre-checked and the field is optional in the Zod schema, so a poster can submit with audiencePref=null. RoommateProfileFilters.tsx's "Either" pill (labelled "Either") drives an exact-match backend query (`where.audiencePref = q.audiencePref`), so null-preference profiles are invisible to a searcher using that pill.

## Findings

1. **[LOW]** RoommateProfileFormModal.tsx renders audiencePref as an optional radio group with no default selection, so posters can submit profiles with no stated audience preference; RoommateProfileFilters.tsx's 'Either' pill drives a strict-equality backend filter (roommateProfiles.ts: `if (q.audiencePref) where.audiencePref = q.audiencePref`), so these unset profiles are invisible to searchers using that pill even though they may be open to anyone.
   - Evidence: RoommateProfileFormModal.tsx line 32 (`audiencePref: z.enum([...]).optional()`) and lines 217-227 (radio group, no default checked); RoommateProfileFilters.tsx lines 14-19 (AUDIENCE_OPTIONS incl. 'EITHER'); roommateProfiles.ts line 123 (`if (q.audiencePref) where.audiencePref = q.audiencePref;`).
   - Recommended action: Make audiencePref a required field at profile creation (Frontend validation change) rather than changing filter-match semantics to include null, to avoid implying an unstated preference. Engineering/founder should decide the backfill approach for existing null profiles.
2. **[LOW]** POST /roommate-profiles/:id/message uses `participants: { every: { userId: { in: [...] } } }` for conversation lookup, which is correct only because conversations are always created with exactly 2 participants; no current bug, but lacks an explicit count check.
   - Evidence: roommateProfiles.ts lines 275-280 and 295-298 (conversation always created with exactly `[{userId: req.user!.id}, {userId: profile.userId}]`).
   - Recommended action: Out of scope for design — route directly to Engineering/Backend as a defense-in-depth hardening item (e.g. add `participants: { every: {...} }` AND `participantsCount: 2` style guard, or use a compound lookup key).

## Open questions

- Should existing audiencePref=null roommate profiles be backfilled to EITHER (more inclusive, infers intent) or left as-is with a 'complete your profile' nudge to the poster (safer, may reduce their visibility until they act)? Recommend Engineering + founder decide given this touches existing user-facing data at scale.
- Is renaming the 'Either' filter pill label to 'Open to either' worth a small copy change, or is 'Either' clear enough as-is? Non-blocking either way.

## Recommendation

Fix at the source, not at the filter: make audiencePref a required choice at profile creation instead of quietly treating a searcher-side "Either" pill as inclusive of unset values.

Rationale: silently expanding the "Either" filter's backend match to include null (audiencePref IS NULL OR audiencePref='EITHER') would let a searcher message a poster who never actually confirmed they're open to either gender — that's a trust/legibility regression (implying a stated preference the poster didn't give), not a fix. The correct fix removes the ambiguous null state entirely so the filter's existing strict-match semantics become accurate for every profile, not just new ones.

Flow changes needed (Frontend — RoommateProfileFormModal.tsx):
1. Make the "Who I'm open to living with" radio group required. Add Zod validation (`z.enum([...])` without `.optional()`) with an inline error state: "Select who you're open to living with" shown under the radio group on submit attempt, same pattern as other required-field errors in this form.
2. No option pre-checked by default — force an explicit choice rather than silently defaulting to "Either" on the poster's behalf (defaulting on their behalf has the same trust problem as inferring it from null).
3. New UI state Frontend needs to build: the inline validation-error state for this radio group (doesn't currently exist since the field was optional).

Backend/data (flag to Engineering, not mine to decide): existing profiles with audiencePref=null need a resolution path before this becomes a hard requirement going forward — either (a) a one-time backfill defaulting them to EITHER with a transparent in-app notice to the affected poster ("We've set your roommate profile to 'Open to either' by default — update it anytime from your profile"), or (b) a "complete your profile" prompt shown to the poster on their own profile until they set it, leaving the profile as-is (visible, filtered under strict semantics as today) until then. (a) is more inclusive immediately but writes an inferred value to existing user data at scale, so it should get a quick Engineering/founder sanity check before running; (b) is safer but may leave some profiles permanently unfiltered by audience. I'd lean toward (b) given the audience is scam-wary and trust is the higher priority than search recall, but this is a judgment call for Engineering to make with founder input, not something for me to force through code.

Filter UI itself (RoommateProfileFilters.tsx): no matching-logic change needed once the null state is closed off — keep the strict `audiencePref = 'EITHER'` query. Optionally rename the pill label from "Either" to "Open to either" for clarity, but this is cosmetic and non-blocking.

Item 2 (participants.every() defense-in-depth): no design input required — route to Engineering/Backend as a small hardening task (e.g. also assert `participants.length === 2` in the conversation lookup), independent of this filter work.
