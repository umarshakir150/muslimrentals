# Task

## Objective

Add `.env.example` files for `rentals/backend` and `rentals/frontend` so the
README's documented setup steps (`cp backend/.env.example backend/.env`,
`cp frontend/.env.example frontend/.env.local`) actually work, and so every
environment variable the code reads is documented in one place.

## Business context

Flagged as a gap in `company/architecture.md` ("Known weaknesses") and
`ai/current-state.md`/`ai/roadmap.md` ("Now"). Founder requested this as the
first task to validate the supervisor/worker operating system end-to-end.
Low-risk, additive, non-destructive — good first exercise of the workflow.

## Status

`DONE`

## Owner

Supervisor (this task has no ongoing Engineering-Lead-owned implementation
beyond the two example files; Supervisor retained ownership throughout).

## Participating agents

- **Supervisor** — scoped the task, decided which roles were needed, opened
  this file, delegated to Backend/Frontend, then to QA/Security, reconciled
  results, wrote the final report.
- **Backend Engineer** — independently inspected `rentals/backend` for every
  environment variable actually read by the code, cross-checked against
  `validateEnv.ts`, the README, and config/auth/database/storage code, and
  authored `rentals/backend/.env.example`.
- **Frontend Engineer** — did the same for `rentals/frontend` and authored
  `rentals/frontend/.env.example`.
- **QA Engineer** — independently re-derived the list of environment
  variables from the codebase (not from the Backend/Frontend agents'
  summaries) and checked both files against that independent list, and
  checked for accidentally-copied secrets.
- **Security Reviewer** — reviewed both files for leaked credentials,
  insecure suggested defaults, and misleading production-like values.

**Not engaged, and why:** Product Designer (no user-facing flow — this is
dev tooling), Trust & Safety (no user-generated content or moderation
surface), Legal (no privacy/retention/consent/housing/discrimination
surface — these are placeholder config values, not user data), Support (no
inbound user issue to triage).

## Dependencies

None. Builds directly on `ai/current-state.md`'s "Now" item.

## Requirements

1. `rentals/backend/.env.example` and `rentals/frontend/.env.example`
   exist, each covering every environment variable actually referenced in
   that side's code.
2. Cross-checked against: env validation code, README, config files, auth
   config, database config, storage config, and any other code reading
   `process.env`/`process.env.NEXT_PUBLIC_*`.
3. No real secrets or current environment values — placeholders only, with
   explanatory comments where useful.
4. No runtime application code changed.
5. QA independently verifies completeness, no leaked secrets, and that
   names match the code exactly.
6. Security independently reviews for leaked credentials, insecure
   defaults, and misleading production values.
7. Any `CHANGES_REQUIRED` from QA or Security is corrected and the same
   reviewer re-checks before this task is marked done.
8. No deployment. No unrelated changes.

## UX considerations

N/A — not a user-facing change.

## Trust & Safety considerations

N/A — no user-generated content, messaging, profiles, or moderation surface
involved.

## Legal / privacy considerations

N/A — no privacy, retention, consent, housing-regulatory, discrimination,
terms, or liability surface. The files contain only placeholder
configuration values, never real user or secret data.

## Technical plan

Two new files, no existing files modified:

- `rentals/backend/.env.example`
- `rentals/frontend/.env.example`

No schema change, no new object type, so the object-level authorization
checklist (`agents/backend.md`) does not apply — this task creates no new
user-owned/user-generated object.

## Files likely affected

- `rentals/backend/.env.example` (new)
- `rentals/frontend/.env.example` (new)

## Test plan

No automated tests exist for this area (`ai/current-state.md`). Manual
verification performed by QA: for each variable referenced anywhere in
`rentals/backend/src/**` and `rentals/frontend/src/**` /
`rentals/frontend/next.config.js` via a fresh independent grep, confirm it
appears in the corresponding `.env.example` with the exact same name, and
confirm nothing in either file is a real credential or a value that exists
anywhere else in the repo's git history for this session.

## QA result

**Round 1: `PASS`**, with two non-blocking minor findings (independently
re-derived the full environment variable list from a fresh grep of both
`rentals/backend/src` and `rentals/frontend/src` rather than trusting the
workers' summaries; confirmed 100% completeness — 25/25 backend vars,
2/2 frontend vars, exact case-sensitive name matches, no fabricated
entries, no secrets present):

1. *Minor* — `NODE_ENV` comment claimed it controls "CORS strictness,"
   which is not accurate (`src/index.ts`'s CORS allow-list is driven only
   by `ALLOWED_ORIGINS`/`FRONTEND_URL`, not `NODE_ENV`).
2. *Minor* — `JWT_SECRET`/`JWT_REFRESH_SECRET` placeholders didn't trip
   `validateEnv.ts`'s own placeholder-pattern check — the same issue
   Security independently found and treated as blocking (see below).

Both were fixed in the same revision that resolved Security's round-1
finding (see below) — no separate QA re-review round was needed since the
fix directly addressed both of QA's noted items and touched nothing else
QA had already verified as correct. Also noted, non-blocking and out of
scope for this task: no `.gitignore` in `rentals/backend`/`rentals/frontend`
excludes `.env`/`.env.local` — flagged for `ai/roadmap.md` as a follow-up,
not fixed here since it isn't an environment-variable documentation gap.

## Security result

**Round 1: `CHANGES_REQUIRED`**

- **Severity:** High
- **Reproduction steps:** In `rentals/backend/.env.example`, the
  `JWT_SECRET` placeholder (`please-generate-a-real-random-32-plus-character-string`,
  54 chars) and `JWT_REFRESH_SECRET` placeholder (64 chars) both satisfy
  `validateEnv.ts`'s length check (≥32) and contain none of its
  `PLACEHOLDER_PATTERNS` tokens (`your_`, `changeme`, `change_this`,
  `replace_me`, `example`, `secret_key`, `XXXXXXXXX`).
- **Expected behavior:** If a developer copies the example value verbatim
  into a real `.env` and deploys with `NODE_ENV=production`, the app's own
  `validateEnv.ts` hard-fail guard should catch the unedited placeholder
  and refuse to boot.
- **Actual behavior:** It doesn't — the guard passes silently, so the
  server would boot signing tokens with a secret that is public in the
  repo, allowing anyone who reads the file to forge access/refresh tokens
  for any user, including admins.
- **Recommended fix:** Reword both placeholder values to include one of the
  existing `PLACEHOLDER_PATTERNS` tokens (e.g. `changeme_...`) while
  staying ≥32 chars and distinct from each other, so `validateEnv.ts`
  actually hard-fails if left unchanged in production.

Also noted as informational/non-blocking: `COOKIE_SECRET` isn't
strength-checked by `validateEnv.ts` at all (pre-existing app-level gap,
not introduced by this task — out of scope for this task since fixing it
would mean changing `validateEnv.ts`, which is application code).

Confirmed by Security: no real/working credentials in either file; no
runtime application code modified (`git status --porcelain` showed only
the three new files); frontend file correctly scopes to the two
`NEXT_PUBLIC_*` vars actually read, with an accurate bundle-exposure
warning.

**Round 2 (re-review of the fix): `APPROVED`**

Confirmed: `JWT_SECRET`/`JWT_REFRESH_SECRET` now contain a
`PLACEHOLDER_PATTERNS` token (`changeme`), stay well over the 32-character
minimum (57/67 chars), and remain distinct from each other — a developer
who deploys with either value unedited in production now hits
`validateEnv.ts`'s hard-fail as intended. The `NODE_ENV` comment no longer
misattributes CORS behavior to it. `COOKIE_SECRET` was updated
consistently (not required by `validateEnv.ts`, but treated with the same
care). No new issues introduced; no runtime application code touched.

## T&S result

N/A — see Trust & Safety considerations above.

## Legal flags

N/A — see Legal / privacy considerations above.

## Open questions

None blocking. Noted for the founder, not blocking this task:

- The `ALLOWED_ORIGINS` / `FRONTEND_URL` split and the Netlify-vs-Vercel
  deployment ambiguity (`company/architecture.md`) mean the exact
  production value of a few variables is a founder-level decision — the
  example files document the variable and its purpose, not a recommended
  production value.
- Frontend worker found that `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (listed in
  `README.md`) is not actually read anywhere in the frontend code — Google
  Sign-In does not appear to be wired up client-side, even though the
  backend's `/auth/google` endpoint and `authApi.googleAuth()` on the
  frontend both exist. This is a real product/engineering gap, not a
  documentation error — flagged here for the Supervisor to open a separate
  task if the founder wants Google Sign-In to actually work end-to-end.
- No `.gitignore` excludes `.env`/`.env.local` in either `rentals/backend`
  or `rentals/frontend` (QA finding, non-blocking) — recommended follow-up
  for `ai/roadmap.md`, not fixed in this task.

## Founder approval required?

No. This is additive documentation/tooling only — no production deploy, no
ban, no data deletion, no legal policy publication, no spend, no auth/
security behavior change (only documenting existing auth-related variable
*names*, not changing how auth works).

## Final result

Shipped. `rentals/backend/.env.example` (25 variables) and
`rentals/frontend/.env.example` (2 variables) created, documenting every
environment variable actually read by the code, cross-checked against
`validateEnv.ts`, the README, and all config/auth/database/storage/rate-
limiting code on both sides. No runtime application code changed.

Went through one `CHANGES_REQUIRED` → fix → re-review round: Security's
round-1 finding (JWT secret placeholders would silently bypass the app's
own placeholder-rejection check if deployed unedited) was fixed and
Security re-approved on round 2. QA passed on round 1 with the same issue
flagged as non-blocking, plus one inaccurate comment (`NODE_ENV`/CORS) —
both resolved by the same fix.

Follow-ups identified but out of scope for this task, recorded in
`ai/roadmap.md`/Open questions above: missing `.gitignore` entries for
`.env`/`.env.local`, and the apparent gap between the documented and
actually-implemented Google Sign-In flow on the frontend.
