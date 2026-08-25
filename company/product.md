# Product

## Problem being solved

Finding halal-conscious, community-appropriate housing in Canada is hard
through general rental sites: no way to filter for who a unit is being
rented to (brothers-only, sisters-only, couples, families), no roommate
matching within the community, and a real risk of scams that generic
listing sites don't address for this audience specifically. Muslim Rentals
is a focused marketplace/community platform to close that gap.

## Current product (what actually exists today)

Confirmed by reading `rentals/backend/prisma/schema.prisma` and the route
handlers — not aspirational:

- **Listings.** Create, browse, filter, view detail, save/unsave, edit
  (owner or admin/moderator), soft-remove (owner or admin/moderator, status
  set to `REMOVED` rather than hard-deleted), report.
- **Listing filtering.** By city, audience (BROTHERS/SISTERS/COUPLES/
  FAMILIES/ALL), bedroom/bathroom range, price range, amenities, keyword,
  geo-radius (in-memory distance calc), with pagination and sort.
- **Map browsing.** Leaflet-based full map and mini-map views of listings.
- **Messaging.** Per-listing conversations between a poster and an
  interested user, real-time via Socket.IO (typing indicators, read
  receipts, live message delivery), plus a REST fallback.
- **Auth.** Email/password (bcrypt, cost 12) and Google OAuth, JWT access
  tokens + httpOnly refresh-token cookie with rotation, forgot/reset
  password flow.
- **Notifications.** In-app notification records (e.g. "new message"),
  no push/email notification delivery beyond the transactional emails sent
  via Nodemailer (welcome email, password reset email).
- **Reporting.** Users can report a listing with a reason + optional
  description; admins/moderators triage via an admin panel.
- **Admin panel.** Stats (user count, active listings, pending reports,
  message count), user search, ban/unban, role change (ADMIN only), listing
  removal, report review (resolve/dismiss with a resolution note).
- **Static/policy pages.** Home, Browse, Map, Post, Contact, Messages,
  Safety, Terms, Privacy — all present in `rentals/frontend/src/app`.
- **Mosques and cities data.** Seeded reference data (52 mosques, 80+ cities)
  used for autocomplete and listing-mosque proximity features.

## Business model

**Free at launch.** No payment processing, subscription, or paid-listing
tier exists in the codebase today (no payment models in the schema, no
billing routes). Any future monetization is a founder-level product and
possibly legal decision, not something to introduce inline in a feature
task.

## Current product priorities

Inferred from what's built and what's clearly unfinished, not guessed:

- Make listing discovery (browse, map, filters) reliable and trustworthy.
- Make messaging between renters and posters safe and low-friction.
- Keep moderation/reporting functional so scams and abuse can be caught.
- Close the gap between what the product promises (roommate finding/
  profiles — see below) and what's implemented.

## Intentionally not priorities yet (do not invent as built)

- **Roommate profiles / roommate matching.** Mentioned in the product's
  intended scope (`CLAUDE.md`) but **not implemented** — no schema model,
  no routes, no frontend pages exist for this (verified: no "roommate"
  string appears anywhere in `rentals/backend` or `rentals/frontend`
  outside this documentation). Treat any roommate-related task as new
  feature work, not a bug fix.
- **Reporting users or messages directly.** Only listings are reportable
  today (`POST /listings/:id/report`). Flag this as a gap if a task touches
  harassment-via-messaging.
- **Payments/monetization.** Not built; not currently a priority.
- **Push notifications / email digests.** Only transactional emails
  (welcome, password reset) exist.
- **User-initiated account/data deletion.** Not implemented — see
  `company/architecture.md` and `agents/legal.md`.
- **Automated test suite / CI.** Not present — see `ai/current-state.md`.
