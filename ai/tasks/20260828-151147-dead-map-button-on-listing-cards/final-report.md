# Final task report

- **Task ID:** 20260828-151147-dead-map-button-on-listing-cards
- **Final state:** COMPLETE
- **Agents involved:** designer, frontend, qa, security
- **Correction cycles used:** 0
- **QA verdict:** PASS
- **Security verdict:** APPROVED

## Objective

Dead 'Map' button on listing cards (Browse/Saved) does nothing when clicked

rentals/frontend/src/app/browse/page.tsx:141 and rentals/frontend/src/app/saved/page.tsx:137 both pass `onMap={() => {}}` into <ListingCard>. ListingCard.tsx:126-131 renders a visible, clearly-interactive button with a Map icon labeled 'Map', wired to onClick calling onMap(listing) — so it looks actionable but is a complete no-op. There's also no map-side deep-link support to receive such an action even if wired up: rentals/frontend/src/app/map/page.tsx only tracks `selectedListing` via local useState set from within the map page itself, with no listingId/query-param handling. Fix: either wire the button to navigate to /map with a query param the map page reads to auto-select/pan to that listing, or remove the button if that behavior isn't wanted for this MVP.

Why this matters (backlog rationale): A visibly interactive control that silently does nothing erodes trust in a product whose core differentiator is being a trustworthy, community-appropriate platform (company/principles.md: 'Trust before growth hacks'). Lower severity than the pagination gap since users can still reach the map via primary navigation, but it's a real, evidenced defect worth fixing as routine frontend work.

Evidence:
- sig_68c9e508-313b-448b-b53a-87c9c3665a3b
- rentals/frontend/src/app/browse/page.tsx:141
- rentals/frontend/src/app/saved/page.tsx:137
- rentals/frontend/src/components/listings/ListingCard.tsx:126-131
- rentals/frontend/src/app/map/page.tsx

## Founder approval gate

Not required for this task.

## Summary

Task complete. Agents involved: designer, frontend, qa, security. 0 correction cycle(s) used.

## Files changed

- rentals/frontend/src/app/browse/page.tsx
- rentals/frontend/src/app/map/page.tsx
- rentals/frontend/src/app/saved/page.tsx
- rentals/frontend/src/components/listings/ListingCard.tsx

## Next steps

- Implementer branch "agents/20260828-151147-dead-map-button-on-listing-cards/frontend" (frontend) at /home/user/muslimrentals/orchestrator/.worktrees/20260828-151147-dead-map-button-on-listing-cards-frontend — not auto-merged by the orchestrator.
