# Task request

- **Task ID:** 20260827-035341-verify-buildtypecheckprisma-migration-on-the-integrated
- **Mode:** FULL (implementation authorized)
- **Created:** 2026-08-27T03:53:41.002Z

## Objective

Verify build/typecheck/Prisma migration on the integrated Roommate Profiles branch

Install dependencies (npm install) in rentals/backend and rentals/frontend on the integrated Roommate Profiles branch/worktree (agents/20260826-093438-design-and-build-the-first-production-ready/integration), then run `npx tsc --noEmit` in both, `npx prisma generate` and the first-ever `npx prisma migrate dev` for the new RoommateProfile model against a real dev Postgres instance, and fix any compile/type/migration errors the new code surfaces. Also do the manual browser pass QA already asked for (create → browse as 2nd user → filter → message → deactivate → reactivate flow) since this is genuinely new, previously-unexercised code that was only reviewed via static reading.

Why this matters (backlog rationale): QA and Security both approved this feature but explicitly flagged (sig_2446a9fb, sig_e452ff28) that zero automated verification has ever run on it — no install, no tsc, no prisma generate/migrate, no dev server. Confirmed independently that rentals/backend/node_modules does not exist. A brand-new user journey (new DB model, new auth-gated routes, messaging integration) should not be trusted as 'reviewed' until it actually compiles and its migration applies cleanly; this is precisely the kind of reliability/testability gap called out as high priority in the standing objective.

Evidence:
- sig_2446a9fb
- sig_e452ff28
- sig_4d346da1
- sig_efb0cf62
- ai/tasks/20260826-093438-design-and-build-the-first-production-ready/qa.json
- ai/tasks/20260826-093438-design-and-build-the-first-production-ready/security.json
