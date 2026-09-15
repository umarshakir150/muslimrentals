# Changelog

Human-readable project history for Muslim Rentals. Newest first.

**How to read this file:**
- Dates are the date the change actually merged into `main` (from Git
  history), not when work started.
- **"Merged" and "deployed" are different things and this file always says
  which.** Since 2026-09-01 the founder has kept Netlify's production
  auto-deploy off on purpose, so merging a PR into `main` does not, by
  itself, put it in front of real users — production only moves forward
  when the founder explicitly triggers a deploy. Anything below marked
  "merged, not yet deployed" is real, working code sitting on `main` (and
  usually already live on the Render backend + Supabase database, which
  don't have this gating), waiting for that one deploy.
- This covers meaningful product changes, fixes, and infrastructure/
  security work. It leaves out pure implementation noise (merge-base
  syncs, formatting, temporary debugging, routine test-suite tweaks, and
  routine "nothing to do" autonomy-scheduler cycles).
- See the "Evidence gaps" section at the bottom for the few stretches of
  history this file can't fully reconstruct from Git alone.

---

## Where things stand today (2026-09-15)

- **Deployed to production** (`muslimrentals.ca`, Netlify build of commit
  `49d4bb7`, published 2026-09-01): the original MVP plus the first
  multi-feature milestone — multi-image gallery, User Settings/Account,
  the messaging bug fix, the Legal/Policy pages overhaul, and Forgot
  Password/Change Email. Backend (Render) and database (Supabase) track
  `main` directly and are current with everything below.
- **Merged into `main`, not yet deployed to the production frontend:**
  everything from "Report a user / report a message" (2026-09-02) onward.
  This is a deliberate choice — the founder is holding one single
  accumulated production deploy for a `main` HEAD they choose, rather than
  deploying every PR as it lands. **Reminder: that one accumulated
  production deploy is still pending as of this writing.**

---

## 2026-09-14 — Security fix: landlord contact info no longer public to anonymous visitors

**Merged to `main`, not yet deployed.**

- Raw listing contact info (phone/WhatsApp/email) was being sent to
  *anyone* who requested a listing, logged in or not — meaning it could be
  scraped at scale by an anonymous, automated crawl of the site. Browsing
  and listing details still work exactly the same for anonymous visitors;
  only the contact info itself is now withheld until they sign in. (PR #29)
- Fixed two orchestrator (internal AI-team) bugs found during a routine
  review: the automation could get permanently stuck reporting "already
  running" after a crashed process, and a founder decision to defer an
  idea (Roommate Profiles) could get silently un-deferred and re-asked
  later. Both fixed with regression tests. (PR #28)

## 2026-09-11 to 2026-09-12 — Housekeeping: CI, dead code cleanup, doc corrections

**Merged to `main`, not yet deployed.**

- Added automated Continuous Integration (GitHub Actions): every future
  pull request now automatically runs lint, type-checking, build, and the
  test suite for both frontend and backend, catching problems before merge
  instead of relying on someone remembering to test manually. (PR #27)
- Removed unused Google Sign-In scaffolding (a backend endpoint and
  frontend API call that were never actually wired up to a visible
  "Sign in with Google" button) rather than leaving dead, half-built auth
  code in place. (PR #25)
- Fixed a README that described an out-of-date deployment setup, and added
  a regression test that had been missing for MODERATOR-role permissions.
  (PR #26)
- Documentation-only corrections: recorded that PR #21 was confirmed truly
  merged into `main` (not just marked "merged" on GitHub) (PR #23), and
  formally logged that a complete Roommate Profiles feature was built and
  reviewed once already (2026-08-26) but never merged — its branch no
  longer even exists — so it's tracked as a founder decision (resume,
  rebuild, or abandon) rather than quietly lost. (PR #24)

## 2026-09-08 to 2026-09-09 — Browse: real address & place search with adjustable radius

**Merged to `main`, not yet deployed.** QA-cleared (two independent review
rounds) and Security-approved.

- Browse's location search can now resolve real street addresses (with
  genuine rooftop-level or approximate precision, clearly labeled) and
  place names — landmarks, businesses, schools, neighbourhoods, cities —
  not just whatever autocomplete happened to suggest. (PR #21)
- The search radius can now be set as small as 0.5km (previously 1km
  minimum), with a mini-map preview of the searched area.

## 2026-09-06 to 2026-09-07 — Listing editing, map/location refinements, notifications backend, geocoding fixes

**Merged to `main`, not yet deployed.**

- **Edit Listing** shipped: landlords can now edit an existing listing
  using the same form used to create one, instead of having to delete and
  re-post. (PR #14) A follow-up made Edit Listing always require
  re-confirming the map location, matching how posting a new listing
  already worked, so an edited listing can't end up with a stale or
  unconfirmed location. (PR #18)
- **Pin Confirmation** UX improved: confirming a listing's location now
  supports click/tap-to-move-the-pin and searching by address, not just
  dragging. (PR #13)
- The public, privacy-safe "approximate location" shown for a listing (to
  protect a landlord's exact address from anonymous viewers) was made more
  uniform across an area, rather than clustering in a way that could hint
  at the real location. (PR #12)
- **Notifications backend** landed: the server-side plumbing for
  notifying users about listing saves, new messages, and moderation
  actions. (PR #15) *Note: the matching frontend (notification bell,
  dropdown, live updates) was built as PR #16 but was never merged — it
  remains an open, unfinished pull request, so notifications are not
  visible to users yet despite the backend existing.*
- Fixed a geocoding regression around rate-limit handling and unnecessary
  re-geocoding of listings that hadn't moved (PR #17), and added Geocodio
  as a permanent, already-validated address-geocoding provider on the live
  backend (PR #19).
- A small orchestrator bug (the internal AI development automation could
  occasionally create a duplicate approval request for the same item) was
  fixed. (PR #11)

## 2026-09-05 to 2026-09-06 — Location privacy, "Locate Me," and a report-evidence fix

**Merged to `main`, not yet deployed.**

- Added a "Locate Me" button and made listing map locations
  privacy-safe by default: most viewers see a randomized, approximate
  point near a listing rather than its exact coordinates, with a "confirm
  your location" step for anyone posting or editing a listing so the real
  address is still captured accurately behind the scenes. Also fixed a bug
  where overlapping map markers in the same area didn't visually separate
  ("spiderfy") when clicked. (PR #9)
- Fixed a mismatch between what the backend expected and what the frontend
  sent when submitting evidence for a "qualifying interaction" report
  (part of the report-a-user feature below), which had been silently
  breaking that flow. (PR #10)

## 2026-09-02 to 2026-09-03 — Trust & Safety: reporting users and messages, admin moderation toolkit

**Merged to `main`, not yet deployed.**

- Previously only listings could be reported. Users can now report another
  **user** or a specific **message**, with a required reason and (for user
  reports) proof of a real prior interaction, to prevent frivolous or
  harassing reports. (PR #7)
- Built out the admin side to go with it: a moderation queue that branches
  by what's being reported (listing/user/message), the ability to
  restrict a user from messaging, a full audit trail of who reviewed a
  report and why, and message-content retention rules for evidence.
- Added ADMIN-only tools: permanently deleting an account (distinct from
  banning it) and a proper admin User Search. Also added the ability for
  an admin/moderator to remove a listing and restore it later, rather than
  removal being permanent. (PR #8)

## 2026-09-01 — First multi-feature milestone: **this is what's live in production today**

**Merged to `main` AND deployed to production** (Netlify build of commit
`49d4bb7`, published 2026-09-01). Everything in this entry is what real
visitors to `muslimrentals.ca` currently see.

- **Multi-image gallery & lightbox** on the listing detail page — browsing
  a listing's photos now works properly instead of showing only one image.
  (PR #2)
- **User Settings/Account**: users can update their display name, photo,
  email, phone, and password, and delete their own account (which
  anonymizes their data rather than breaking other users' shared
  conversation history). (PR #3)
- **Messaging fix**: the "Message landlord" button on the map page, which
  didn't do anything, now correctly opens a conversation. (PR #4)
- **Legal/Policy pages overhaul**: Terms, Privacy, Safety, and Community
  Guidelines were rewritten to remove fabricated/inaccurate claims and
  given real content and a proper document design, reviewed for legal
  issue-spotting along the way. (PR #5)
- **Forgot Password and Change Email now actually send real email**,
  via Resend, after Gmail's SMTP proved unreachable from the hosting
  provider — both flows were verified end-to-end before this shipped.
  (PR #6)

## 2026-08-28 to 2026-08-29 — Going live: production infrastructure stood up, and the first round of real-world bug fixes

**Deployed to production** during this period (this is the launch itself).

- The app went live for the first time on real infrastructure: frontend on
  Netlify, backend on Render, database on Supabase (via Prisma), and image
  storage on Cloudflare R2 — connected, verified with real traffic, and
  confirmed working end-to-end (CORS, auth, database, uploads).
- The AI development team adopted a structured multi-agent workflow around
  this time (starting 2026-08-25) — every feature from here on goes
  through Engineering/Frontend/Backend build, then independent QA and
  Security review, before merging. This is a process change, not a product
  feature, but it's the reason later entries in this file mention QA/
  Security review and PR numbers consistently and earlier ones don't.
- A wave of real bugs found by actually using the live site were fixed in
  quick succession, including: a wrong error message on incorrect
  password, a broken forgot/reset-password page, an empty city dropdown
  blocking new listing posts, a CSS bug that broke map/marker styling in
  production only, a broken image-upload permission on the storage
  provider, and a map layering bug that let the map render on top of
  modal dialogs.
- Listing improvements: replaced free-text bedroom/bathroom fields with
  proper dropdowns, added pagination to the Browse page, improved map
  location accuracy and neighbourhood-based clustering, and added the
  ability to permanently delete a listing.

## 2026-08-25 to 2026-08-27 — Early fixes under the new AI-agent workflow

**Merged to `main`** (pre-dates the production launch above).

- Built the "Saved Listings" page, which existed as a nav link but had no
  actual page behind it.
- Fixed a crash in the automation tooling used to build features (not
  user-facing).

## 2026-06-01 to 2026-06-02 — Initial project scaffold

The very first commits to this repository: a founder-uploaded initial
version of the app — Next.js frontend (browse, map, post, messages, admin,
and static pages; auth, listing, and messaging UI) and an Express backend
(auth, listings, messaging, uploads, users, and a Prisma database schema).
This is the foundation everything else in this file was built on top of.
See "Evidence gaps" below — the exact process behind this initial version
isn't reconstructable from Git alone.

---

## Evidence gaps

Places where the Git/PR history isn't enough to confidently say more than
what's written above:

- **2026-06-01/02 (initial scaffold):** the 28 commits from this period
  have no descriptive commit messages (e.g. "Add files via upload",
  "Create page.tsx") — consistent with a manual file upload rather than
  normal development, but Git alone can't say what tool or process
  produced this code, or over what timeframe it was actually written
  before being uploaded.
- **2026-06-02 to 2026-08-25 (~12 weeks):** there are no commits at all in
  this window. This file can't say what happened during that gap.
- **PR #1** ("Fix signup, map/modal stacking, city autocomplete, filters,
  and empty states," opened 2026-08-06, a 13,500+ line diff): still open,
  never merged. Its exact relationship to what actually shipped between
  June and August isn't fully traceable from Git history alone.
- **PR #16** (the frontend half of the notifications feature — bell,
  dropdown, live updates, deep links): substantial, apparently complete
  work, but still open/unmerged as of this writing (mentioned above under
  2026-09-06/07).
- **PR #20** (adding `.env.local` and related variants to the backend's
  `.gitignore`): a small, still-open, unmerged fix.
