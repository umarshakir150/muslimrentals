# Current State

Last verified against the repository: 2026-08-25, commit `f086c68` on
`main`. Update this file whenever the picture materially changes — don't
let it drift into fiction.

## Tech stack

- **Frontend:** Next.js 14.2 (App Router), React 18, TypeScript, Tailwind
  CSS, Radix UI, Zustand, Leaflet, Socket.IO client, react-hook-form + zod.
- **Backend:** Express 4, TypeScript, Prisma 5, PostgreSQL, Socket.IO
  server, JWT + Google OAuth, S3-compatible storage, Nodemailer.
- Full breakdown: `company/architecture.md`.

## Current working features

- Listing CRUD (create/edit/soft-remove by owner or admin/moderator),
  browse/filter/search/sort/paginate, map view, save/unsave, report.
- Real-time messaging per listing conversation, with typing indicators and
  read receipts.
- Email/password and Google OAuth registration/login, JWT refresh rotation,
  forgot/reset password.
- Admin panel: stats, user search, ban/unban, role change, listing removal,
  report triage.
- Static policy pages: Safety, Terms, Privacy, Contact.
- Seeded reference data: mosques and Canadian cities.

## Incomplete / not-yet-built features

- **Roommate profiles and roommate matching** — mentioned in the product
  vision but not implemented anywhere in the codebase (no schema, no
  routes, no UI). See `company/product.md`.
- **Reporting a user or a message directly** — only listings can be
  reported today.
- **User-initiated account/data deletion.**
- **Push or digest email notifications** — only transactional email exists.
- **Payments/monetization** — not built, not currently planned.

## Testing status

**No automated test suite exists.** No `*.test.*` or `*.spec.*` files, no
test runner configured in `rentals/frontend/package.json` or
`rentals/backend/package.json`. `type-check` (frontend `tsc --noEmit`) and
`lint` scripts exist on both sides and can be run as a cheap correctness
check, but they are not a substitute for tests. Until a test suite exists,
QA and manual verification are the only correctness gates — do not skip
them because "there are no tests to run."

## Deployment status

Not deployed by this session, and this operating system explicitly forbids
deploying without founder authorization. Per the README and
`rentals/frontend/netlify.toml`, the intended targets are ambiguous between
Vercel (README's stated recommendation) and Netlify (an actual config file
present) for the frontend, and Railway/Render/DigitalOcean for the backend
with a managed Postgres provider (Supabase/Railway/Neon). No `.env.example`
files are committed, so required environment variables are only documented
in `README.md`'s prose table.

## Security posture

The codebase is unusually security-conscious for its stage: layered rate
limiting, `.strict()` Zod validation everywhere, ownership checks before
mutation, UUID validation on path params, helmet/CSP/HSTS, sanitized
inputs, S3 keys that never trust client filenames, env validation that
hard-fails production startup on weak secrets. See
`company/architecture.md`'s "Known weaknesses" section for the specific
gaps worth tracking:

- `accessToken` persisted to `localStorage` (XSS exposure surface).
- `Listing.contactInfo` visible to unauthenticated viewers.
- No CI to enforce lint/build/(future) tests on every change.
- No committed `.env.example`.

None of these are necessarily wrong for the product's current stage — they
are documented so Security/Engineering treat them as known, not rediscover
them from scratch each time.

## Technical debt

- No test suite, no CI — the biggest structural gap.
- Frontend has `swr` installed but the actual data-fetching path is a
  hand-rolled `ApiClient` — worth resolving one way or the other rather
  than growing both patterns in parallel.
- Deployment target ambiguity (Netlify config vs. Vercel-recommended
  README) should be resolved with the founder rather than assumed.
- No root-level workspace tooling — frontend/backend are two independent
  npm projects; fine at this size, worth revisiting if the codebase grows
  a third package (e.g. a worker or shared types package).

## Major TODOs (grounded in the gaps above)

1. Decide and document the actual deployment target(s) — founder decision.
2. Add `.env.example` files for both `frontend` and `backend` (safe,
   non-destructive documentation work — good first task to validate this
   operating system, see the end of this task's final report for the
   suggested next prompt).
3. Stand up a minimal test runner (even a handful of smoke tests) before
   any large feature work, so QA has something automated to lean on.
4. Scope roommate profiles as new feature work (schema + auth model +
   Trust & Safety + Legal review) before implementing — do not bolt it onto
   the existing `Listing` model without a deliberate design pass.
