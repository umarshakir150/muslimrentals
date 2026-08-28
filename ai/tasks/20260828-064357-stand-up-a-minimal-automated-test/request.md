# Task request

- **Task ID:** 20260828-064357-stand-up-a-minimal-automated-test
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-28T06:43:57.813Z

## Objective

Stand up a minimal automated test framework with DB-independent smoke tests (backend + frontend)

Add a test runner (Vitest — already used by the orchestrator's own tooling, so no new ecosystem is introduced) to both rentals/backend and rentals/frontend, with an initial set of smoke-level tests scoped specifically to logic verifiable WITHOUT a live Postgres instance or a browser, since neither is available in this sandboxed environment (mem_480b2bf7-74fd-4ece-8ccf-18c4b14a6191: no reachable dev Postgres, no Docker, Prisma DB-touching subcommands sandbox-denied, no browser/computer-use tool). Backend scope: JWT sign/verify roundtrip and expiry-cast behavior (src/utils/jwt.ts), Zod request-validation schemas correctly accepting/rejecting boundary inputs, sanitizeInputs middleware stripping script tags and prototype-pollution keys, the in-memory geo-distance calculation used for radius filtering. Frontend scope: component/form-level tests with React Testing Library and the API client mocked (auth form validation in AuthModal, ListingFilters state, CityAutocomplete). Explicitly OUT of scope for this item: any test that needs a live database (auth flow end-to-end, listing CRUD ownership checks, message-participant authorization against real rows) — track that as a clearly separate follow-up once this environment gains real DB/browser access, so this item doesn't get stuck the way bl_368a454b did. Wire `npm test` (or `npm run test:unit`) into both package.json files so future cycles have something automated to run instead of manual-only verification.

Why this matters (backlog rationale): Confirmed directly (not assumed): neither rentals/backend/package.json nor rentals/frontend/package.json has a test script or test-runner devDependency, and a repo-wide glob for *.test.ts/*.spec.ts under rentals/ returns nothing. This is the single largest reliability/testability gap left in an MVP that is otherwise unusually security-conscious for its stage (company/architecture.md's own 'Known weaknesses' section leads with it), and it's explicitly named as the top unstarted item in both ai/current-state.md's 'Major TODOs' (#3) and ai/roadmap.md's 'Next' section. It also directly serves priority tier 5 of the standing operating directive ('Reliability/testing gaps unsafe for autonomy') at a moment when this autonomy loop is actively shipping change after change with no automated safety net beyond manual QA review.

Evidence:
- rentals/backend/package.json (no test script or test-runner dependency)
- rentals/frontend/package.json (no test script or test-runner dependency)
- glob search: no *.test.ts or *.spec.ts files anywhere under rentals/
- company/architecture.md: 'Known weaknesses — No automated test suite'
- ai/current-state.md: 'Testing status' and 'Major TODOs' #3
- ai/roadmap.md: 'Next — Stand up a minimal automated test setup'
- mem_480b2bf7-74fd-4ece-8ccf-18c4b14a6197 (no DB/browser access in this sandbox — scoping constraint)
