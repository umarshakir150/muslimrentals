# Roadmap

Lightweight, based on the actual state of the repo (`ai/current-state.md`),
not aspirational. Founder re-prioritizes this at will — treat it as a
living document, not a commitment.

## Now

- Validate this AI operating system on one small, real, low-risk task (see
  the suggested next prompt at the end of the setup task's final report).
- Add `.env.example` files for `rentals/frontend` and `rentals/backend` so
  the README's setup instructions actually work.
- Resolve the Netlify-vs-Vercel deployment ambiguity with the founder and
  document the decision in `ai/decisions.md`.

## Next

- Stand up a minimal automated test setup (even smoke-level: auth flow,
  listing CRUD ownership checks, message-participant authorization) so QA
  has something repeatable to run, and so this operating system's "run
  tests" workflow step stops being manual-only.
- Add a basic CI check (lint + type-check + build, then tests once they
  exist) so regressions are caught before merge.
- Add a report path for users/messages (not just listings), closing the
  Trust & Safety gap noted in `company/architecture.md`.
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
