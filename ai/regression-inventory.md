# Regression Inventory

Durable, per-journey record of what QA has actually checked, when, in what
environment, and with what result. This is a log of real checks, not a
checklist to fill in with assumed passes — an unchecked journey stays
`NOT_YET_CHECKED` until someone genuinely checks it. See `agents/qa.md`
("Regression inventory") for how this is maintained, and
`ai/operating-directive.md` for the honesty rule governing verification
levels.

Rotate coverage by risk/recency/changed-area rather than re-running every
journey every cycle. `importance` guides how often a journey should come
up for re-check when nothing has specifically changed near it.

Columns: **journey / importance / last_checked / environment /
verification_type / result / related_errors**.

Seeded from the real feature list in `company/product.md` — nothing below
has been checked yet under this inventory, so every row starts honest:
`last_checked: never`, `result: NOT_YET_CHECKED`. Do not backfill invented
history.

## Core journeys

| Journey | Importance | Last checked | Environment | Verification type | Result | Related errors |
|---|---|---|---|---|---|---|
| Browse listings (list view, filters, pagination, sort) | critical | never | — | — | NOT_YET_CHECKED | — |
| Map browsing (full map + mini-map) | high | never | — | — | NOT_YET_CHECKED | — |
| View listing detail | critical | never | — | — | NOT_YET_CHECKED | — |
| Post a new listing | critical | 2026-08-28 | production | Founder confirmed: successfully posted a real listing on production | LIVE_SITE_VERIFIED | Confirmed as part of verifying the city-selection fix below |
| Post listing — city selection shows suggestions, selects a city, sets valid lat/lng | critical | 2026-08-28 | production | Founder confirmed live: dropdown shows suggestions, city selectable, a real listing was successfully posted on production | LIVE_SITE_VERIFIED | Fixed in commits `1612757`/`20b32e0` (module-cache + HTTP-cache staleness bugs, see ai/decisions.md 2026-08-28 entries). First round wrongly assumed the data seed alone fixed it — do not repeat that mistake for other data-layer fixes; always get an explicit live re-check |
| Edit a listing (owner) | medium | never | — | — | NOT_YET_CHECKED | — |
| Save / unsave a listing | medium | never | — | — | NOT_YET_CHECKED | — |
| Remove a listing (owner, soft-remove) | medium | never | — | — | NOT_YET_CHECKED | — |
| Post listing — neighbourhood required, real coordinates resolved (not city center) | critical | 2026-08-28 | production (DB) | Migration applied + 151-row neighbourhood seed loaded and coverage-verified directly against production Supabase; code merged to `main`; TYPECHECKED, 5 backend Zod tests + frontend unit tests pass, full `next build` succeeds | FIXED_NOT_LIVE_SITE_VERIFIED | DB and code are live-ready; Render/Netlify deploy completion not yet confirmed (MCP + egress both down at check time) — do not flip to LIVE_SITE_VERIFIED until a real browser post-listing flow is verified. See ai/decisions.md 2026-08-28 "MCP access restored..." entry |
| Map: marker clustering (collapses at low zoom, separates on zoom in) | high | 2026-08-28 | — | TYPECHECKED; pure config/logic unit-tested (mapMarkers.ts); real Leaflet rendering not practical to unit-test | FIXED_NOT_LIVE_SITE_VERIFIED | Needs a real browser check once deployed — clustering visuals can't be fully verified by unit tests alone |
| Map: spiderfy overlapping/identical-coordinate markers, mobile/touch | high | 2026-08-28 | — | TYPECHECKED; config verified (spiderfyOnMaxZoom, 44px touch targets) | FIXED_NOT_LIVE_SITE_VERIFIED | Same as above — needs a real device/browser check once deployed, especially touch behavior |
| Map cleanup on navigation away (Map → Login/Sign Up/listing/Browse) | high | 2026-08-28 | — | TYPECHECKED; automated cleanup-registration test; full `next build` succeeds | FIXED_NOT_LIVE_SITE_VERIFIED | Root cause fixed (async Leaflet init race with unmount) and merged to `main` + deployed live — this one IS live, just not yet re-confirmed by a real browser nav-away check |
| Owner deletes their own listing (permanent) | critical | 2026-08-28 | production (DB) | Conversation.listingId SetNull migration applied to production Supabase; code merged to `main`; TYPECHECKED, 5 backend ownership/cleanup tests + 5 frontend dialog tests pass; Security-reviewed (initial CHANGES_REQUIRED on related-data handling, fixed and re-verified) | FIXED_NOT_LIVE_SITE_VERIFIED | DB and code are live-ready; Render/Netlify deploy completion not yet confirmed. See ai/decisions.md 2026-08-28 "MCP access restored..." entry |
| Non-owner cannot delete another user's listing | critical | 2026-08-28 | — | Backend test: non-owner request returns 403, delete never called; unauthenticated request returns 401 | FIXED_NOT_LIVE_SITE_VERIFIED | Code merged to `main` — needs a live re-check (e.g. attempt via devtools/API directly) once deploy is confirmed |
| Deleted listing disappears from My Listings / browse / map / saved | high | 2026-08-28 | — | Code-reviewed: no shared listing cache exists (each page fetches its own state), so deletion propagates naturally on next fetch; local list pruned immediately via callback | FIXED_NOT_LIVE_SITE_VERIFIED | Code merged to `main` — needs a real live check once deploy is confirmed, including confirming a saved reference to a deleted listing behaves correctly |
| Beds/Baths numeric input entry + filtering by bed/bath count | high | 2026-08-28 | production | TYPECHECKED, 55 backend + relevant frontend tests pass, Security APPROVED, deployed live (Render + Netlify) | FIXED_NOT_LIVE_SITE_VERIFIED | Merged to main and deployed — needs a real browser post+filter check to flip to LIVE_SITE_VERIFIED |
| My Listings → click a listing → detail view renders (not a client-side crash), regardless of amenities/owner | critical | 2026-08-28 | — | TYPECHECKED; 4 new backend tests (usersMeListings.test.ts) assert `amenities` returns as `string[]` and `user` relation is present; root-caused via reading the actual GET /users/me/listings response shape vs. the correctly-shaped GET /users/me/saved | FIXED_NOT_LIVE_SITE_VERIFIED | Merged to `main` (`64b48d7`) — needs a real logged-in browser check: view an owned listing with amenities from My Listings, confirm no "Application error", confirm the owner sees "Delete listing" not "Message landlord" |
| Post Listing: clicking Continue (step 2→3) does not submit the listing | critical | 2026-08-28 | — | Root-caused with a Playwright stack-trace-capturing fetch wrapper (real browser, not just code reading): React reconciling the type="button" Continue and type="submit" Post-listing buttons at the same JSX position without keys let one click both advance the step and submit. Fixed with distinct `key`s; re-verified with Playwright that reaching step 3 no longer fires `POST /listings`, and covered by 2 new frontend unit tests (confirmed meaningful by reverting the fix and seeing them fail) | FIXED_NOT_LIVE_SITE_VERIFIED | Merged to `main` (`64b48d7`) — needs a real browser re-check once deployed, this was the actual cause of the founder's "pressing upload submits the listing" report |
| Post Listing: photo upload actually persists and appears on the listing | critical | 2026-08-28 | — | Root-caused: `imageUrls: []` was hardcoded, upload endpoint never called. Wired `listingsApi.uploadImages()` (calls the existing, unchanged `POST /uploads/listing-images/:id` — auth/ownership/file-type/size validation confirmed already correct) after listing creation. Verified end-to-end with Playwright (mocked network): dropzone click opens file picker without submitting, file selection shows a preview, submit calls both create and upload with the right listing id | FIXED_NOT_LIVE_SITE_VERIFIED | Merged to `main` (`64b48d7`) — needs a real browser+real backend check: select a photo, submit, confirm it appears on the listing detail page and in Browse/My Listings |
| Post Listing modal survives an accidental outside click (data intact, closes only via X) | high | 2026-08-28 | — | Root-caused (backdrop `onClick` calling the form-resetting `handleClose`), fixed on both modal variants, verified with Playwright (typed data survives a backdrop click; X button still closes), covered by 2 new frontend unit tests | FIXED_NOT_LIVE_SITE_VERIFIED | Merged to `main` (`64b48d7`) — needs a real browser re-check once deployed |
| Map: Leaflet controls (zoom/attribution) never visually outrank a modal | medium | 2026-08-28 | — | Defensive fix per Designer review (Leaflet's own CSS ships `.leaflet-top`/`.leaflet-bottom` at z-index:1000, above every app modal's z-[100]/z-[110]); capped to z-index:40. Verified zoom controls remain fully clickable/functional after the cap | FIXED_NOT_LIVE_SITE_VERIFIED | Merged to `main` (`64b48d7`) — this is hardening, not a confirmed fix for the founder's map-overlay report; extensive local Playwright testing (dev + local prod build) never reproduced that report at all — see ai/decisions.md, may be a stale-Netlify-build artifact that needs a live-site recheck once the fastq deploy fix is confirmed current |
| Report a listing | high | never | — | — | NOT_YET_CHECKED | — |
| Sign up (email/password) | critical | never | — | — | NOT_YET_CHECKED | — |
| Log in (email/password) | critical | never | — | — | NOT_YET_CHECKED | — |
| Log in with wrong credentials shows correct error (not "Session expired") | high | 2026-08-28 | production | Founder confirmed live in a real browser | LIVE_SITE_VERIFIED | Fixed in api.ts (PUBLIC_AUTH_ENDPOINTS), commit `fe20a0d` |
| Google OAuth sign-in | high | never | — | — | NOT_YET_CHECKED | — |
| Forgot / reset password (request → email → set new password → login with new password) | high | 2026-08-28 | production | Founder confirmed live: `/reset-password` page itself works (token validation, form, error states); LIVE_SITE_VERIFIED confirmed no reset email ever arrives | NOT_OPERATIONAL (email delivery) — do not treat as fixed | Root cause confirmed in Render logs: `ECONNREFUSED 127.0.0.1:587` — SMTP_HOST/USER/PASS are genuinely unset. `sendEmail()` now fails fast with a clear log instead of a confusing connection attempt (commit `1612757`, Security-reviewed APPROVED — anti-enumeration SAFE_RESPONSE unchanged), but this does NOT restore delivery. **External blocker, not fixable from this session:** needs a real transactional email provider account (e.g. Resend/SendGrid/Postmark/SES) and its credentials set as SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_FROM on Render — founder action required. See ai/current-state.md "Known gap" and ai/decisions.md 2026-08-28 entries |
| JWT refresh / session persistence | high | never | — | — | NOT_YET_CHECKED | — |
| Start a conversation about a listing | critical | never | — | — | NOT_YET_CHECKED | — |
| Send/receive messages in real time (Socket.IO) | critical | never | — | — | NOT_YET_CHECKED | — |
| Messaging REST fallback | medium | never | — | — | NOT_YET_CHECKED | — |
| In-app notifications (e.g. new message) | medium | never | — | — | NOT_YET_CHECKED | — |
| Admin: stats dashboard | low | never | — | — | NOT_YET_CHECKED | — |
| Admin: user search / ban / unban / role change | high | never | — | — | NOT_YET_CHECKED | — |
| Admin: listing removal | high | never | — | — | NOT_YET_CHECKED | — |
| Admin: report review (resolve/dismiss) | high | never | — | — | NOT_YET_CHECKED | — |
| Static/policy pages render (Home, Browse, Map, Post, Contact, Messages, Safety, Terms, Privacy) | medium | never | — | — | NOT_YET_CHECKED | — |
| City autocomplete | medium | 2026-08-28 | production | DB-verified (82 real cities seeded, `/cities/all` now returns lat/lng) | FIXED_NOT_LIVE_SITE_VERIFIED | Bumped from low to medium — this endpoint directly blocks listing posts when broken; see ai/decisions.md 2026-08-28 entry |
| Mobile viewport — browse/map/post/messages | high | never | — | — | NOT_YET_CHECKED | — |
| Unauthorized-access checks (cross-user listing/conversation/report actions, non-admin hitting admin routes) | critical | never | — | — | NOT_YET_CHECKED | — |

## Notes

- "Environment", "Verification type", and "Result" columns are filled in
  only once a real check happens — use the verification-level vocabulary
  from `agents/qa.md` (`CODE_REVIEWED`, `TYPECHECKED`, `BUILD_VERIFIED`,
  `API_VERIFIED`, `LOCAL_RUNTIME_VERIFIED`, `PREVIEW_VERIFIED`,
  `LIVE_SITE_VERIFIED`, plus `BROWSER_VERIFIED`/`MOBILE_VERIFIED` where
  genuinely applicable).
- `related_errors` links to a backlog item or task file, not a free-text
  description, once one exists.
- Roommate profiles/matching, direct user/message reporting, payments, and
  push notifications are intentionally absent — not built yet per
  `company/product.md`, so there is nothing to regression-test.
