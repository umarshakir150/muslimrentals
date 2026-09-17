# Task: UX Overhaul — Milestone Tracker

## Objective

A comprehensive UX/UI overhaul of the Muslim Rentals frontend, executed in 9
reviewable milestones on a single accumulating branch/PR
(`ux-overhaul/milestone-1-foundation-shell`,
[PR #32](https://github.com/umarshakir150/muslimrentals/pull/32)), each
gated on the founder's visual approval before the next milestone starts.
Target feel: "mature, calm, premium Canadian housing marketplace" —
residential, trustworthy, warm, restrained, modern, spacious,
photography-led, marketplace-first — replacing the current
component-library/startup-landing-page feel. Full avoid-list and palette
direction came from the founder's original overhaul brief (not duplicated
here in full — see PR #32's description and this file's milestone entries
for what was actually approved/rejected).

## Business context

Product/UX maturity work, not a functional change — see
`company/product.md`/`company/principles.md` for the underlying product this
redesign wraps. No new product functionality is in scope anywhere in this
overhaul; existing search/filter/radius/map/listing/location/privacy
behavior and API contracts must be preserved exactly unless a milestone
explicitly changes UX (and never changes underlying behavior/contracts).

## Status

`IN_REVIEW` — Milestones 1 approved, 2 rejected/reverted/skipped, 3
implemented and awaiting founder visual approval before Milestone 4.

## Owner

Engineering (this session), with the Product Designer specialist consulted
per milestone before implementation, per the founder's explicit
"UX-agent ownership" instruction.

## Participating agents

- Engineering (implementation, testing, PR/preview management)
- Product Designer (`agents/designer.md`) — per-milestone flow/spec input

## Dependencies

- Netlify Deploy Preview auto-build on PR #32 (working, confirmed).
- Standing production-freeze instruction: **do not deploy or modify
  production as part of this overhaul.** Production is only republished
  once, after every milestone is approved and final QA passes, and only on
  the founder's own explicit trigger.

## Requirements

Preserve all existing product functionality, permissions, privacy,
backend contracts, and responsive behavior throughout, unless a specific
milestone explicitly changes UX (never underlying behavior). No new
product functionality or speculative business-rule changes at any point in
this overhaul.

## Milestone log

### Milestone 1 — Foundation & Global Shell — **APPROVED**

Design tokens (additive: `forest`/`neutral`/`destructive` scales,
`control`/`surface`/`panel` radii, `elevation1`/`elevation2` shadows), new
shared UI primitives (`Button`/`ButtonLink`, `Spinner`, `Badge`, `Chip`,
`Surface`, `Field`, `Skeleton`, `EmptyState`), a rebuilt `Navbar` (full-width
header, off-canvas mobile drawer), a new global `Footer`, and consolidation
of `Navbar`+`Footer` into `app/layout.tsx` (fixed a real double-Navbar bug
and a missing-footer gap). Tests/lint/type-check/build all clean at the
time. Founder reviewed the Deploy Preview and approved it as the baseline
for the rest of the overhaul — **this work stands and must not be reverted
or altered by any later milestone.**

### Milestone 2 — Homepage — **REJECTED, REVERTED, INTENTIONALLY SKIPPED**

Implemented per a Product Designer spec (location-first hero search, a
real "recently listed" section, an audience-category browse section, a
real problem-statement/safety section replacing the old marketing-card
section, a closing post-a-listing strip). Pushed to PR #32, Deploy Preview
rebuilt, founder reviewed it.

**Outcome: the founder did not like the redesign and rejected it outright**
(no specific fix requested — a full rejection of the direction, not a
change-request). Per the founder's explicit instruction, the homepage
(`rentals/frontend/src/app/page.tsx`) was reverted byte-for-byte to its
exact Milestone-1-approved state (`git checkout afe4294 --
rentals/frontend/src/app/page.tsx`, verified via `git diff` showing zero
difference against that commit, and via matching production-build output
size for `/` before/after). No other Milestone 1 file (design tokens,
Navbar, Footer, layout, primitives, accessibility work) was touched by
either the Milestone 2 attempt or this revert.

**The homepage is not part of the rest of this overhaul.** Do not
redesign, restyle, or otherwise touch `app/page.tsx` in any later milestone
of this overhaul unless the founder explicitly reopens homepage work by
name. Milestone numbering below continues from the original plan's
Milestone 3 onward; there is no renumbering, and "Milestone 2" refers only
to this rejected/reverted/skipped homepage attempt.

### Milestone 3 — Browse + Integrated Map (including listing-card UX) — **IMPLEMENTED, AWAITING FOUNDER REVIEW**

Scope: Browse page, the integrated map experience, filters, listing cards,
responsive behavior — the full original Milestone 3 scope, not narrowed to
"listing cards" alone. Implemented per a Product Designer spec, entirely a
visual/layout/token pass on the Milestone 1 design system — no behavioral,
API-contract, filter-logic, autocomplete, radius-search, geolocation, or
map-interaction change of any kind.

Key changes:
- **Listing cards** (`ListingCard.tsx`, `ListingDetail.tsx`): fixed the
  real "rainbow category colors" anti-pattern — `lib/utils.ts`'s
  `audienceColor()` (BROTHERS=blue/SISTERS=pink/COUPLES=purple/
  FAMILIES=amber) deleted; both components now use the shared `Badge`
  component (single forest-tinted treatment, differentiated by label text
  only). Card container/price pill/amenity tags/no-photo placeholder
  migrated to Milestone 1 tokens (`rounded-surface`, `neutral-*`,
  `forest-*`), Message/Map buttons migrated to the `Button` primitive.
- **Browse page** (`browse/page.tsx`): loading grid now uses `Skeleton`,
  zero-results/load-error states now use `EmptyState`, "load more"/"try
  again" now use `Button` — same copy, same handlers, same data.
- **Filters** (`ListingFilters.tsx`, `LocationRadiusSearch.tsx`,
  `SearchRadiusMiniMap.tsx`): keyword/sort/beds/baths controls migrated to
  `Input`/`SelectField`, amenity toggles migrated to `Chip`, "More
  filters" panel and the location-radius search widget migrated to
  `Surface` containers, More/Reset buttons migrated to `Button`. Audience
  pills deliberately left untouched (already the correct neutral pattern).
  Radius slider, autocomplete debounce/cache, geolocation, and the
  suggestion dropdown's logic are byte-for-byte unchanged — only
  color/border/radius tokens moved to the Milestone 1 scale.
- **Map page** (`map/page.tsx`, `FullMap.tsx`): className-only token
  migration on the header and map-card border/shadow; the loading
  overlay's inner spinner/text swapped for the `Spinner` primitive. The
  fragile exact-pixel layout (`100dvh`/`paddingTop: 72px` flex column) and
  the `isolation: 'isolate'` stacking-context fix on the map card's inline
  style are untouched byte-for-byte — only the wrapper's separate
  `className` (border/shadow) was touched, never the inline style object.
  Added one new, previously-missing state: a small non-interactive
  "No listings match your filters" banner when a filtered search returns
  zero results (was previously just an empty basemap with no explanation),
  positioned inside the same isolated stacking context, `pointer-events:
  none`, z-index 10 (well below the loading overlay's 1000).
- `map/page.test.tsx`'s CSS-selector target was updated to match the new
  class names (same "sync the selector to the real classes" pattern as
  Milestone 1's own test fix) — the actual regression assertions
  (`isolation: isolate`, `position: relative`) are byte-for-byte unchanged.

Verified: type-check clean, lint clean (only pre-existing unrelated
warnings), full suite 395/395 passing, production build succeeds, and a
manual dev-server smoke check of `/browse` and `/map` (200 responses,
skeleton loading state renders, no runtime errors).

## UX considerations

Per-milestone Product Designer consultation is mandatory before
implementation (founder's explicit instruction) — see each milestone entry
above/below for what was actually produced and whether the founder approved
it. A milestone the founder rejects gets reverted, not iterated-on
speculatively without a fresh founder steer.

## Trust & Safety considerations

N/A for Milestones 1-2 (pure presentational/navigational changes, no new
user-generated content, moderation, or messaging surface touched). To be
assessed per `agents/trust-safety.md` for Milestone 3 given it touches
listing cards and map/location display — flag if location-privacy or
audience-display treatment changes in any way that isn't purely visual.

## Legal / privacy considerations

N/A so far — no privacy, retention, consent, housing-regulation, or terms
content has been touched by Milestones 1-2. Milestone 2's homepage did
paraphrase already-published Safety Guidelines copy, but that milestone
was rejected/reverted in full, so nothing from it is live; N/A now that
it's reverted.

## Technical plan

Single accumulating branch (`ux-overhaul/milestone-1-foundation-shell`),
single PR (#32), single Deploy Preview URL, updated per milestone. Each
milestone: Product Designer spec → implementation → type-check/lint/test/
build → manual smoke check → commit → push → PR/preview update → stop for
founder visual review.

## Files likely affected

Milestone-dependent — see each milestone's own PR commit for its exact
file list. Milestone 3 will touch `app/browse/page.tsx`, `app/map/page.tsx`
(carefully, given its fragile exact-pixel Leaflet layout — see Milestone 1's
own notes), `components/listings/ListingCard.tsx`, `ListingFilters.tsx`,
`LocationRadiusSearch.tsx`, and related map/marker files — exact list to be
finalized once the Milestone 3 design spec is in hand.

## Test plan

Every milestone: `npm run type-check`, `npm run lint`, `npm test` (395/395
at last check), `npm run build`, plus a manual dev-server smoke check for
new/changed states. No automated test suite exists at the repo/CI level
beyond these local Vitest suites (see `ai/current-state.md`) — this is
"run tests" per `CLAUDE.md` step 8 for this repo's actual current state.

## QA result

Not a separate formal QA pass per milestone so far — Engineering has been
running the full check suite itself and the founder has been the visual
reviewer/approver. Flag to the founder if a later, higher-risk milestone
(e.g. Milestone 3's map/location work) should get an independent QA pass
before merge, given `CLAUDE.md`'s standing QA requirement.

## Security result

N/A so far — no auth, permission, or data-exposure surface has been
touched by any milestone to date (Milestones 1-2 were purely presentational
and navigational). To be reassessed if Milestone 3 touches location-privacy
rendering.

## T&S result

N/A so far — see "Trust & Safety considerations" above.

## Legal flags

N/A so far — see "Legal / privacy considerations" above.

## Open questions

None outstanding. The one raised during Milestone 2 (Trust & Safety/Legal
glance at paraphrased safety copy) is moot now that Milestone 2 is
reverted.

## Founder approval required?

Yes, for two separate things throughout this overhaul: (1) visual approval
of each milestone's Deploy Preview before the next milestone starts
(already the operating model), and (2) the eventual single production
deploy once the entire overhaul is complete and final QA passes — no agent
may trigger that deploy.

## Final result

In progress — will be filled in once the full 9-milestone overhaul (minus
the now-skipped homepage milestone) is complete and the founder approves a
final release.
