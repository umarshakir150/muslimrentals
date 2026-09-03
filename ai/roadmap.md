# Roadmap

Lightweight, based on the actual state of the repo (`ai/current-state.md`),
not aspirational. Founder re-prioritizes this at will — treat it as a
living document, not a commitment.

## Now

- ~~Validate this AI operating system on one small, real, low-risk task~~ —
  done: `ai/tasks/env-example-files.md` (added `.env.example` files for
  both `rentals/frontend` and `rentals/backend`, Supervisor → Backend/
  Frontend → QA/Security, one `CHANGES_REQUIRED` → fix → re-approve round).
- Resolve the Netlify-vs-Vercel deployment ambiguity with the founder and
  document the decision in `ai/decisions.md`.
- Add `.gitignore` entries for `.env`/`.env.local` in `rentals/backend` and
  `rentals/frontend` — neither is currently excluded, so nothing stops a
  developer's real `.env` from being committed once they run
  `cp .env.example .env` (flagged by QA in `ai/tasks/env-example-files.md`).
- Investigate the Google Sign-In gap: the backend's `/auth/google` endpoint
  and the frontend's `authApi.googleAuth()` call both exist, but no
  frontend code actually reads `NEXT_PUBLIC_GOOGLE_CLIENT_ID` or renders a
  Google Sign-In button (flagged by Frontend Engineer in
  `ai/tasks/env-example-files.md`) — decide whether to finish wiring it up
  or remove the unused backend/frontend scaffolding.

## Next

- Map: overlapping same-neighborhood/nearby price bubbles need a real
  presentation solution (spiderfy or similar) once that work resumes —
  founder-confirmed backlog item from the 2026-08-29 live retest. The
  green price-bubble styling itself is confirmed working correctly in
  production; this is purely about markers that sit close enough together
  to visually overlap. Spiderfy/neighbourhood clustering is explicitly
  paused for now (see `ai/decisions.md`) — do not start this until the
  founder resumes that work.
- Stand up a minimal automated test setup (even smoke-level: auth flow,
  listing CRUD ownership checks, message-participant authorization) so QA
  has something repeatable to run, and so this operating system's "run
  tests" workflow step stops being manual-only.
- Add a basic CI check (lint + type-check + build, then tests once they
  exist) so regressions are caught before merge.
- Decide on and, if approved, implement a user-initiated account/data
  deletion path (Legal + Backend + founder).

## Later

- Roommate profiles and matching — the headline missing feature from the
  product vision. This needs a full pass: Product Designer for the flow,
  Backend for a new data model and its own object-level authorization
  checklist, Trust & Safety for abuse-case review (this is a higher-risk
  surface than listings — see `company/users.md`), and Legal for privacy/
  consent review, before any implementation starts.
- Decide whether the frontend consolidates onto `swr` or the existing
  `ApiClient`, rather than carrying both.
- Revisit monetization only if/when the founder decides to raise it —
  currently explicitly out of scope (`company/product.md`).
