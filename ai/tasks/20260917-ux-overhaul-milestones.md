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

`IN_REVIEW` — Milestones 1, 3, 4, 5, and 6 (Account + Marketplace
Utilities, including the Messages page-scroll fix) approved, 2
rejected/reverted/skipped. Milestone 7 (Supporting/content pages) starting
now on the same branch/PR per the founder's explicit confirmation that PR
#32 stays open and accumulating through Milestone 9 — merge/production
release happens once, at the end, exactly as the original brief specifies
("Do not merge milestone-by-milestone into production... accumulated,
fully reviewed, regression-tested, and then released all at once").

**2026-09-18 clarification (no plan change):** the founder asked to
"complete the normal PR #32 closeout/merge workflow" after approving the
Milestone 6 fix. Flagged the direct conflict with the original brief's
explicit "accumulate on one branch, merge/release once at the very end"
design before acting — founder confirmed the original plan stands: no
merge to `main` now, PR #32 stays open, "closeout" here means marking
Milestone 6 approved and continuing to Milestone 7 on the same branch.

**Process correction (applied starting this milestone):** for Milestones
3–5, the founder had to send a follow-up message before the Deploy
Preview URL in the final report was actually confirmed working — the
report was sent before polling confirmed the Netlify build had finished.
From Milestone 6 onward, the Deploy Preview is polled to a confirmed
terminal state (and verified actually reachable) before the
founder-facing report is sent, with no follow-up required. If a deploy
fails, that gets investigated and fixed before reporting, not left for
the founder to notice.

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

### Milestone 3 — Browse + Integrated Map (including listing-card UX) — **APPROVED**

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

### Milestone 4 — Listing Detail — **APPROVED**

Scope: `ListingDetail.tsx` (the full listing-detail modal), plus token-level
consistency passes on `ListingLocationMap.tsx`, `DeleteListingDialog.tsx`,
and the shared `ReportModal.tsx` (used beyond just listings — for user and
message reports too — so left structurally/behaviorally untouched, only
its color tokens/buttons migrated). Implemented per a Product Designer
spec. Presentation-only — no change to auth requirements, contactInfo
gating, approximate-location/privacy behavior, messaging/report/save
flows, gallery/lightbox interaction logic, or any API contract.

Key changes:
- **Hierarchy**: header simplified to a plain icon-action strip
  (save/report/close, now `Button` ghost icon-circular); the audience
  badge moved out of the header into the content flow as a kicker line
  directly above the title, closer to price — a deliberate reposition
  (same `Badge`, same text, no behavior change, not covered by any test
  assertion). Price bumped to `text-3xl font-bold text-forest-700` as the
  clear second-priority element, now on its own line.
- **Gallery**: presentation-only — swipe/tap/arrow/lightbox behavior is
  byte-for-byte unchanged. Desktop gallery height increased (`h-72` →
  `sm:h-[400px]`) to make photos the visual lead per the founder's
  "property itself is the priority" direction; arrow buttons and counter
  chip migrated to Milestone 1 tokens. Zero-image placeholder swapped
  from a literal 🏠 emoji + gradient background to a flat `bg-forest-50`
  fill with a labeled lucide `Home` icon (`role="img"
  aria-label="No photos available"`) — consistent with `ListingCard.tsx`'s
  own Milestone 3 placeholder fix. This is the one required test-contract
  sync: `ListingDetail.test.tsx`'s emoji assertion was updated to query
  the icon's accessible role/name instead; the underlying guarantee (an
  intentional, non-blank placeholder with no arrows/counter) is preserved
  and still verified.
- **Location**: presentation-only retoken of the location line and the
  approximate-location privacy caption (exact required phrases
  "approximate location" / "exact address hidden for privacy" kept
  verbatim — test-locked). `ListingLocationMap`'s own container migrated
  to `rounded-panel`/`neutral-200`; its actual marker/circle/privacy-zone
  drawing (from `mapMarkers.ts`, shared with `FullMap.tsx`) is untouched.
- **Amenities**: migrated from an ad hoc pill span to the shared `Badge`
  (`variant="neutral"`), matching `ListingCard.tsx`'s Milestone 3
  treatment — still shows the full list, same data.
- **Footer actions**: "Message landlord" → `Button variant="primary"
  size="lg"`; "Contact" → `Button variant="secondary" size="lg"`,
  contactInfo reveal mechanism (an explicit-click toast) unchanged;
  owner-only "Delete listing" → `Button variant="destructive-ghost"
  size="sm"`. Same conditions, same handlers.
- **Posted-by block**: demoted from a `bg-gray-50` mini-card (a
  card-in-card) to a plain row above a `border-t` divider; its avatar
  circle's gradient fill replaced with a flat `bg-forest-600`.
- **DeleteListingDialog / ReportModal**: token-level only — warning/report
  icon circles retoned to the `destructive` color token, action buttons
  migrated to `Button`'s `destructive-solid`/`ghost` variants (using
  `Button`'s built-in `loading` prop instead of hand-rolled spinners).
  Copy, step flow, and reason taxonomy are unchanged; `ReportModal` is
  shared with the user/message report surfaces, so this was intentionally
  scoped to tokens only, not a structural redesign.

Verified: type-check clean, lint clean (only pre-existing unrelated
warnings), full suite 395/395 passing (including the one updated
assertion), production build succeeds, and a manual dev-server smoke
check of `/browse`, `/saved`, and `/my-listings` (all pages that render
`ListingDetail`).

### Milestone 5 — Post + Edit Listing — **APPROVED**

Scope: `PostListingModal.tsx` (the single 612-line component that handles
both create and edit via a `mode` prop) plus its exhaustive existing test
suite. Implemented per a Product Designer spec, restructuring the old
generic 3-step wizard into 5 named steps: **Property** (city, address,
unit, town, bedrooms, bathrooms) → **Details** (title, description, price,
contactInfo) → **Preferences** (audience, amenities) → **Photos** →
**Review** (new — a read-only renter-facing preview + the real submit
action). No new fields, no redefined fields, no weakened validation, no
backend changes, no change to the confirm-property-location gate's
mandatory/unskippable nature.

Key changes:
- **Field regrouping** per the spec's rationale (Property = objective
  facts about the place, Details = the fields that require composing
  something plus price/contact, Preferences unchanged conceptually,
  Photos unchanged). Per-step "Continue" validation gates only the
  schema-backed fields in that step (Preferences/Photos have none, so
  Continue is never blocked there — matches what the backend already
  allows).
- **Progress**: a thin bar (all breakpoints) plus a desktop-only labeled
  5-step row (`Chip`s) with jump navigation — in **create mode**, a step
  chip is only reachable at or before the furthest step already validated
  via Continue (no skip-ahead on an unproven submission); in **edit
  mode**, since the form starts from a real, already-live, already-valid
  listing, every step is jump-reachable immediately (an owner can go
  straight to Photos and back to Review without walking through Continue
  five times) — a UX rule keyed on `mode`, not a new code path.
- **Preferences**: audience (single-select) and amenities (multi-select)
  migrated from ad hoc pill/radio markup to the shared `Chip` component.
- **Photos**: pending (not-yet-uploaded) photos are now reorderable via
  move-earlier/move-later icon buttons — genuinely supported with zero
  backend changes, since `uploads.ts` assigns each new image's stored
  `order` from its position in the uploaded array. Already-existing
  photos in edit mode stay remove-only with no reorder control, since
  there is no endpoint to persist a reordered existing-image order (a
  real backend gap, correctly left alone rather than worked around).
  Fixed a real pre-existing mobile bug in passing: the photo-remove
  button was hover-only (`opacity-0 group-hover:opacity-100`), unreachable
  on touch devices without an extra tap; it's now always visible on
  coarse/touch pointers and hover-reveals only on real hover-capable
  pointers.
- **Review** (new): a `Surface`-wrapped visual preview (hero photo, title,
  price, audience `Badge`, beds/baths, city, full description, amenity
  `Badge`s) using the same visual grammar established in Milestones 3–4,
  plus a plain "details you're submitting" list (address/unit — flagged
  private, contact info, suitability/amenities, photo count) each with a
  small "Edit" link that jumps straight back to the step owning that
  field — safe since the form never unmounts across steps, so no data is
  lost. The real submit button lives here, with unchanged copy/logic
  ("Post listing" / "Save changes").
- **Confirm-property-location gate**: mechanism, copy, and unskippable
  nature are byte-for-byte unchanged (still triggered by the backend's
  `needsLocationConfirmation` response on literally every create and every
  edit submission) — only its buttons/map-container chrome were migrated
  to `Button`/`panel` radius. "Back" from it now returns to Review (the
  step whose submit triggered it), the direct generalization of its old
  "return to wherever submission was initiated, nothing created" behavior.
- Field inputs migrated to `Input`/`Textarea` (gaining built-in error
  styling), buttons to `Button`, tags to `Badge`.
- **Test suite**: comprehensively rewritten to match the new 5-step
  structure and field regrouping (step-count/label strings, per-step
  field-fill helpers) while preserving every behavioral guarantee the
  original ~35 tests encoded — the universal confirm-location flow (both
  create and edit), the create-vs-edit photo-upload-failure divergence
  (full rollback vs. save-anyway-with-a-warning-toast), immediate
  existing-photo removal/restore-on-failure, PATCH-vs-POST, prefill,
  auth gating, and the type="button"/type="submit" key-remount guard —
  plus new tests for pending-photo reordering, the absence of a reorder
  control on existing photos, and both modes' step-jump gating. 401/401
  tests pass (six net-new tests; zero guarantees removed or weakened).

Verified: type-check clean, lint clean (same pre-existing `<img>`-element
warning category, now also on this file's two new preview `<img>` uses —
consistent with its own pre-existing style, no new warning category),
full suite 401/401 passing, production build succeeds, manual dev-server
smoke check of `/post` and `/my-listings`.

### Milestone 6 — Account + Marketplace Utilities — **APPROVED**

Founder reviewed the Deploy Preview and called it "good overall," with one
fix required before final approval (the Messages page-scroll bug logged
immediately below). Fix implemented, verified, and confirmed working by
the founder against the live Deploy Preview on 2026-09-18. Milestone 6 —
including the fix — is now fully approved, alongside Milestones 1, 3, 4,
and 5.

Scope (a deliberate scoping call, not a founder-expanded list): the
account-management page (Settings + `DeleteAccountDialog`) and the three
pages where a signed-in user manages their own marketplace activity
(Saved listings, My Listings, Messages/Inbox). `/contact` was explicitly
excluded — a support/legal-adjacent page, better suited to a later
milestone. Implemented per a Product Designer spec (its first attempt
hit a session rate limit mid-run and was retried cleanly). Presentation-
layer only — no change to any API call, auth/ownership check, real-time
socket behavior, avatar/profile/email/password flows, the account-
deletion confirmation mechanism, or listing edit/delete/save wiring.

Key changes:
- **Settings**: `SectionCard` → `Surface`; all inputs → `Input`/
  `Textarea`; all submit actions → `Button` (using its built-in `loading`
  prop); avatar gradient → flat `forest-600`; danger zone retoned to the
  `destructive` token. `DeleteAccountDialog` got the same token-level-only
  pass already established for `DeleteListingDialog` in Milestone 4 (no
  structural change — it's a single confirm-or-cancel dialog with no
  reason to go further). Zero test changes needed in either file — every
  assertion targets copy/placeholders/roles that didn't move.
- **Saved / My Listings**: loading/empty/error states migrated to
  `Skeleton`/`EmptyState`, the exact pattern Browse established in
  Milestone 3 (no test file exists for `saved/page.tsx`, so zero risk
  there). My Listings' rows migrated to `Surface hoverable` with `Button`
  actions. **Status badges** (`ACTIVE`/`INACTIVE`/`PENDING`/`REMOVED`) got
  their own explicit, reasoned call — this is a real status indicator,
  not the audience rainbow-color bug fixed in Milestone 3, so it wasn't
  auto-collapsed to one flat scheme: `ACTIVE` gets a light forest accent,
  `INACTIVE`/`PENDING` share one neutral tone (differentiated by label
  text — "Pending review" vs. "Inactive"), and `REMOVED` keeps a
  destructive flag since it's the one state (possibly moderation-driven)
  an owner most needs to notice. `my-listings/page.test.tsx` needed zero
  changes.
- **Messages/Inbox**: the highest-risk file in this milestone (real-time
  Socket.IO messaging) — confirmed zero change to socket connect/
  disconnect lifecycle, room join/leave timing, or any listener
  registration/cleanup/dedupe logic; every change is a className/
  component swap on JSX those handlers already render. Outer shell →
  `Surface`; conversation rows, avatars, unread pill, thread header
  retoned from `brand`/gradient to `forest`/`neutral`; "me" message
  bubbles → `forest-600` (the primary participant-to-participant
  messaging path); the moderator (read-only) view's two-side
  purple/gray colors were **deliberately left untouched** this round — a
  real, different case (functional sender disambiguation on an admin-
  only screen, not decorative rainbow-coding) noted as a candidate for a
  later internal-tooling-only pass rather than folded in here. Two
  genuine low-risk UX fixes made in passing: the empty-inbox and
  "select a conversation" placeholders now use `EmptyState`, and the
  send button now uses `Button`'s `loading` prop. `Inbox.test.tsx`
  needed one literal-string sync (`bg-brand-600` → `bg-forest-600` in
  three "me"-bubble color assertions) — the guarantee those tests
  protect (correct sender attribution, including over a live socket
  push) is unchanged and still verified.

Verified: type-check clean, lint clean (same pre-existing `<img>`-element
warning category), full suite 401/401 passing, production build
succeeds, manual dev-server smoke check of `/settings`, `/saved`,
`/my-listings`, and `/messages`.

### Milestone 6 fix — Messages: sending a message scrolled the outer page

Founder visual review of Milestone 6 called it "good overall" but withheld
approval pending this one bug: sending a message on `/messages`
auto-scrolled the whole page/viewport downward, not just the conversation
thread.

Root cause: `Inbox.tsx`'s `scrollToBottom` called
`messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })` on an
anchor `<div>` at the end of the message list. `scrollIntoView()` with the
default `block: 'start'` is specified to walk and adjust *every* scrollable
ancestor in the containing-block chain as needed to bring the target into
view, not just the nearest scrollable one — so if any ancestor between the
thread pane and the document was itself scrollable, the browser could also
move the outer page. This is a real engineering root cause, not a cosmetic
symptom to paper over.

Fix: replaced the anchor-based `scrollIntoView()` call with
`container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })`
called directly on the message-thread pane's own scroll container (a new
`messageThreadRef` on the existing `data-testid="message-thread"` div).
`Element.scrollTo()` only ever affects the element it's called on, so this
is architecturally guaranteed to never leak a scroll effect to the outer
page, regardless of any ancestor's scrollability — not dependent on
`/messages/page.tsx`'s wrapper having (or continuing to have) any
particular height/overflow setup. The now-unused `messagesEndRef` and its
anchor `<div>` were removed as dead code. All three call sites (socket
`message:new` handler, `openConversation`, and `sendMessage` — the exact
path in the bug report) now go through the same fixed `scrollToBottom`.
Zero change to sending, real-time delivery, typing indicators, read state,
conversation selection, mobile behavior, or any socket event/listener
logic — this is purely which element receives a scroll call.

Regression test added: jsdom implements neither `Element.scrollIntoView`
nor `Element.scrollTo` (both previously/newly stubbed as no-ops in
`src/test/setup.ts`, matching the existing pattern for other jsdom gaps
like `ResizeObserver`), so there's no real scroll-geometry behavior to
assert against directly. Instead, two new tests in `Inbox.test.tsx` spy on
the message-thread container's own `scrollTo` and on
`Element.prototype.scrollIntoView` globally, asserting: (1) after a
successful send, the thread pane's `scrollTo` is called and
`scrollIntoView` is never called anywhere; (2) the same holds when opening
a conversation and when a live message arrives over the socket. This
guards against ever reintroducing `scrollIntoView` for this purpose.

Verified: full suite 403/403 passing (15/15 in `Inbox.test.tsx`,
confirmed with no unhandled errors after adding the `scrollTo` jsdom
stub), type-check clean, lint clean (same pre-existing `<img>`-element
warning category, unrelated to this file), production build succeeds.
Manual reasoning: `Element.scrollTo()` scoped strictly to the element it's
invoked on is a DOM API guarantee, not a jsdom quirk, so this fix holds in
real browsers exactly as it does in the test double.

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
