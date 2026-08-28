# designer analysis

**Task:** 20260828-210708-task-fix-5-founder-reported-live-product

## Summary

Reviewed UX for items 1 (map overlay), 2 (marker color), and 4 (modal outside-click) against actual current code. No live-site check performed this pass (not executed — do not treat as LIVE_SITE_VERIFIED/MOBILE_VERIFIED). Findings below are code-level UX review only.

## Findings

1. **[MEDIUM]** Item 2: `.rental-marker` background `#0a5c42` is a dark forest green (close to near-black at small marker size on a bright map). It reads as 'dark' before it reads as 'green,' especially over green park/land tiles or in dense clusters, which works against the founder's ask for a 'clear green bubble.'
   - Evidence: rentals/frontend/src/app/globals.css:113-131 — background #0a5c42, white text, 2.5px white border; hover state lightens slightly to #0f7a57.
   - Recommended action: Brighten the base fill to a more saturated, unambiguous green (e.g. in the #14824f–#1a9c5c range) while keeping the white border/text and existing padding/size untouched. Verify contrast of white price text stays ≥4.5:1 against the new fill (AA for small text) before finalizing. Do not touch size, touch-target CSS, or CLUSTER_OPTIONS.
2. **[LOW]** Item 4: Removing backdrop-click-to-close from PostListingModal only (not AuthModal, which uses the identical `onClick={e => e.target === e.currentTarget && handleClose()}` pattern) is an intentional, justified inconsistency, not an oversight — Post Listing has real multi-step form/photo data to lose, AuthModal fields are trivial to retype. Frontend should not 'fix' AuthModal to match; that would be scope creep and isn't what the founder asked for.
   - Evidence: AuthModal.tsx:100-101 and 121-122 both use the same backdrop-click-close pattern PostListingModal.tsx uses; PostListingModal.tsx is the only one the founder flagged.
3. **[INFO]** No Escape-key-closes-modal convention exists anywhere in the app today (grep across components found no keydown/Escape handling in any modal). There is nothing to 'stay consistent with' — do not introduce Escape-to-close only on PostListingModal, since that would create a new inconsistency (one modal closable by Escape, others not) rather than resolve one.
   - Evidence: Grep for Escape|keydown across rentals/frontend/src/components returned no matches in AuthModal.tsx, PostListingModal.tsx, DeleteListingDialog.tsx, or ListingDetail.tsx.
4. **[LOW]** After removing outside-click-to-close, PostListingModal has no visual affordance telling the user why clicking the backdrop does nothing — on a first click it may feel unresponsive rather than intentional. This is a minor trust/clarity gap, not a blocker.
   - Recommended action: Optional, non-blocking: on a backdrop click, briefly nudge/shake the modal card (a cheap framer-motion keyframe already available since the modal is framer-motion-driven) so the user gets feedback that the click registered but the modal is deliberately staying open. Skip if Frontend judges it adds risk/complexity disproportionate to a bug-fix task — the X button alone is an acceptable minimum fix.
5. **[LOW]** Item 1's proposed root cause (Leaflet's `.leaflet-top`/`.leaflet-bottom` control layer at z-index:1000 vs AuthModal/PostListingModal at z-[100]) is plausible from a stacking-context read of the code, but I did not visually reproduce a leaflet control painting over a modal locally or on the live site in this pass.
   - Recommended action: Only pursue the z-index fix if QA/Frontend confirm the fresh-deploy live check still shows a visible overlay — if the stale-build theory is confirmed instead, no design change is needed for item 1 and that should be reported plainly, not papered over with an unnecessary z-index change.

## Open questions

- Did QA/Frontend confirm the current Netlify deploy is fresh (post b730deb) before re-testing item 1 live? Design's z-index recommendation is conditional on that check still showing a repro.
- Should backdrop-click-to-close eventually be reconsidered app-wide as a single documented modal convention (with Escape-to-close added consistently) as a separate backlog item, rather than diverging per-modal on a case-by-case basis?

## Recommendation

Ship item 4's outside-click removal with copy/interaction notes below. For item 2, brighten #0a5c42 to a more unambiguous green — current value is legible but reads dark/near-forest at marker size, not clearly "green" to a casual glance, especially over green park tiles. For item 1, if the fresh-deploy check in QA's pass doesn't fully clear it, treat the Leaflet z-index vs modal z-[100] stacking as the most plausible remaining design-level cause and fix by raising modal z-index above Leaflet's control layer (Leaflet controls are z-index:1000; AuthModal/PostListingModal are z-[100]) rather than reintroducing lifecycle guards.
