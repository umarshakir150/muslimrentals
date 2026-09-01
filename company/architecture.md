# Architecture

This documents what actually exists in the repository as of this writing.
It is not a target architecture — if something described here changes,
update this file as part of that change, and don't add sections describing
things that don't exist yet (put those in `ai/roadmap.md` instead).

## Repository layout

The app lives under `rentals/`, not the repo root:

```
rentals/
  frontend/     Next.js 14 app
  backend/      Express API
```

There is no root-level `package.json` or workspace tooling (no npm/pnpm/yarn
workspaces, no Turborepo/Nx) — frontend and backend are installed and run
independently, each with its own `package.json` and `node_modules`.

## Frontend

- **Framework:** Next.js 14.2 (App Router), React 18, TypeScript.
- **Styling:** Tailwind CSS + `tailwindcss-animate`, `class-variance-authority`,
  custom design tokens (serif headings, `brand` color scale, `shadow-card`).
- **UI primitives:** Radix UI (dialog, dropdown, select, tabs, toast, etc.),
  `lucide-react` icons, `framer-motion` for animation.
- **State:** Zustand (`src/store/authStore.ts`, `src/store/filterStore.ts`).
  `authStore` persists `user` and `accessToken` to `localStorage` via
  Zustand's `persist` middleware.
- **Data fetching:** a hand-rolled `ApiClient` in `src/lib/api.ts` — not the
  installed `swr` package used for cache-aware fetching in most places yet
  (worth noting as a possible inconsistency, not something to "fix"
  unprompted). `ApiClient` handles base-URL normalization, attaches the
  bearer token, and transparently retries once via `/auth/refresh` on a 401.
- **Realtime:** `socket.io-client` (`src/lib/socket.ts`) for live messaging.
- **Maps:** Leaflet + `leaflet.markercluster` (`FullMap`, `MiniMap`).
- **Forms:** `react-hook-form` + `zod` via `@hookform/resolvers`.
- **Routes (App Router pages):** `/`, `/browse`, `/map`, `/post`,
  `/messages`, `/contact`, `/admin`, `/safety`, `/terms`, `/privacy`,
  `/community-guidelines`, `/settings`, `/confirm-email`,
  `/reset-password`, `/saved`, `/my-listings`.
- **Deployment config present:** `rentals/frontend/netlify.toml` (Netlify,
  via `@netlify/plugin-nextjs`). The README's own recommendation is Vercel.
  **These two are inconsistent** — treat "which platform is actually used
  for the frontend" as an open question rather than assuming either; ask
  the founder if a task depends on it.

## Backend

- **Framework:** Express 4, TypeScript, run via `ts-node-dev` in
  development and compiled with `tsc` for production (`npm run build` /
  `npm start`).
- **ORM / database:** Prisma 5 against PostgreSQL (`prisma/schema.prisma`).
  No raw SQL in the codebase as read.
- **Auth:**
  - Email/password: bcrypt (cost 12) password hashing.
  - Google OAuth: `google-auth-library`, ID token verified server-side
    against `GOOGLE_CLIENT_ID`.
  - JWT access tokens (short-lived, sent as `Authorization: Bearer`) +
    refresh tokens (httpOnly, `Secure` in production, `SameSite=Strict`
    cookie scoped to `/api/v1/auth`, stored server-side on the `User` row
    and rotated on every `/auth/refresh` call).
  - `rentals/backend/src/middleware/auth.ts` provides `authenticate`
    (required), `optionalAuth` (attach user if present), `requireRole`
    (role gate). Every request re-reads the user from the DB so a ban takes
    effect immediately even with a still-valid token.
- **Realtime:** Socket.IO server (`src/socket/socketServer.ts`) — connection
  requires a valid JWT via handshake; room joins are re-verified against
  DB participant records, not trusted from the client.
- **Storage:** AWS S3 (or S3-compatible, e.g. Cloudflare R2 via
  `S3_ENDPOINT`) for listing images and avatars, via `multer-s3`. Files are
  keyed by UUID, not original filename. MIME + extension allowlisted,
  size-capped (10MB listing images, 5MB avatars), file-count capped (10 per
  listing).
- **Email:** `nodemailer` (`src/utils/email.ts`) for welcome and
  password-reset transactional email. No marketing/digest email exists.
- **Security middleware stack** (`src/index.ts`), applied in this order:
  `helmet` (CSP, HSTS in production, hides `X-Powered-By`) → CORS
  (allowlist from `ALLOWED_ORIGINS`/`FRONTEND_URL`, credentials enabled) →
  body size limits (1MB JSON) → cookie parsing → compression →
  `sanitizeInputs` (strips HTML/script tags and prototype-pollution keys
  from body/query/params) → `preventHpp` → request logging (`morgan` piped
  to `winston`) → global rate limiter.
- **Rate limiting tiers** (`src/middleware/rateLimiter.ts`): global (100/15min
  per IP), auth (10/15min), write (30/15min), upload (20/hour), admin
  (60/15min).
- **Validation:** Zod schemas with `.strict()` on essentially every route,
  rejecting unknown fields (mass-assignment defense) and bounding every
  field's type/length/range.
- **Env validation:** `src/utils/validateEnv.ts` hard-fails startup in
  production if required secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`,
  `DATABASE_URL`, `FRONTEND_URL`) are missing, too short, or look like
  placeholder values.
- **Logging:** `winston` (`src/utils/logger.ts`), structured, piped from
  `morgan` for HTTP request logs.

## Database schema (actual models)

`User, Listing, ListingImage, ListingAmenity, SavedListing, Conversation,
ConversationParticipant, Message, City, Report, Notification` — see
`rentals/backend/prisma/schema.prisma` for the authoritative field list.
Notably: `User.role` is `USER | ADMIN | MODERATOR`; `Listing.status` is
`ACTIVE | INACTIVE | PENDING | REMOVED` (soft-delete pattern, no hard
delete on listings); `Report.status` is
`PENDING | REVIEWED | RESOLVED | DISMISSED`, scoped to listings only (no
`userId`/`messageId` target on `Report` — users and messages aren't
reportable today).

No `RoommateProfile` (or similar) model exists.

## Authorization model

- Public (no auth): browse/search listings, view a listing detail, view a
  public user profile, view static/policy pages.
- `optionalAuth` routes (work either way, personalize if logged in):
  listing list/detail (adds `isSaved` when authenticated).
- `authenticate`-required: creating/editing/deleting a listing, saving a
  listing, reporting a listing, all of messaging, all of `/users/me/*`,
  uploads.
- Ownership check (in addition to `authenticate`): editing/deleting a
  listing (owner, or any role above `USER`), deleting an uploaded image
  (owner only), messaging (must be a conversation participant, verified
  server-side on both REST and Socket.IO paths).
- `requireRole(ADMIN, MODERATOR)`: the entire `/admin` router.
- `requireRole(ADMIN)` specifically: ban, unban, role change (a stricter
  gate layered on top of the router-level admin gate).

## Data flows worth knowing

- **Listing creation → discovery:** `POST /listings` → Prisma create with
  nested amenity/image creates → shows up in `GET /listings` once `status`
  is `ACTIVE` (the default) and filters match.
- **Messaging:** `POST /messages/conversations` (start) or
  `POST /messages/conversations/:id/messages` (reply) → Prisma write →
  Socket.IO emit to the conversation room (`conv:<id>`) and/or the
  recipient's personal room (`user:<id>`) → client receives in real time if
  connected, otherwise sees it on next fetch. A `Notification` row is also
  created on new-conversation start.
- **Auth refresh:** frontend's `ApiClient` automatically calls
  `/auth/refresh` on a 401 and retries the original request once before
  giving up and clearing local auth state.

## Known weaknesses (observed, not yet fixed — for review triage, not silent action)

- **No automated test suite.** No `*.test.*`/`*.spec.*` files, no test
  runner configured in either `package.json`. "Run tests" in the required
  workflow currently means a documented manual test pass.
- **No CI/CD.** No `.github/workflows` or equivalent — nothing enforces
  lint/build/test on a PR today.
- **No `.env.example` committed** in either `rentals/frontend` or
  `rentals/backend`, despite the README referencing `cp backend/.env.example
  backend/.env` — required env vars are only documented in prose in
  `README.md`.
- **Frontend/deployment target ambiguity** — see the Netlify vs. Vercel note
  above.
- **`Listing.contactInfo` is visible to any viewer**, including
  unauthenticated ones, on `GET /listings/:id`. This may be intentional
  (reduces friction to contact a poster) but is a real privacy tradeoff
  worth confirming with the founder before changing adjacent behavior.
- **`accessToken` is persisted to `localStorage`** on the frontend
  (`authStore.ts`), which is more exposed to XSS-based token theft than an
  in-memory-only token would be. The backend's CSP (`script-src 'self'`)
  and global input sanitization mitigate but don't eliminate this class of
  risk.
- **Only listings are reportable** — no report path for a user or a message
  directly, which limits Trust & Safety's tooling for harassment-via-
  messaging today.
