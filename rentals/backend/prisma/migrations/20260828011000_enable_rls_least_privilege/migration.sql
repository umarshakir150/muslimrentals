-- Enable Row Level Security on every public table and revoke the default
-- PostgREST-role table grants (anon, authenticated, and the implicit
-- `public` role Postgres grants inherit from).
--
-- This app's ONLY intended database access path is the Express/Prisma
-- backend, which connects via Supabase's `postgres` role. That role has
-- BYPASSRLS=true (confirmed directly: SELECT rolbypassrls FROM pg_roles),
-- so none of this affects it -- Prisma keeps working exactly as before.
-- `service_role` also has BYPASSRLS=true and is unaffected.
--
-- `anon`/`authenticated` (the roles Supabase's REST API / PostgREST uses)
-- get two independent layers of denial, so a mistake in one doesn't
-- reopen access:
--   1. REVOKE ALL removes table-level privilege outright -- a query from
--      these roles fails with "permission denied" before RLS is even
--      evaluated.
--   2. RLS enabled with ZERO policies means, even if a future migration
--      re-grants table privilege by mistake, Postgres's RLS default is
--      deny-all: no policy matches, so no row is visible or writable.
--
-- No permissive policies are added for anon/authenticated because this
-- application has no intended Supabase-client/PostgREST access pattern at
-- all (confirmed: no @supabase/supabase-js usage anywhere in the
-- frontend or backend) -- every read/write goes through the Express
-- backend's own auth/ownership checks, per explicit founder direction to
-- keep authorization logic in Express, not duplicate it into RLS. If a
-- genuine public-API use case is ever needed, add a narrowly-scoped
-- policy for it explicitly then.
--
-- Reviewed independently by Security before being applied to production
-- (APPROVED, no changes required) and empirically verified after
-- applying: anon denied SELECT/INSERT on User/Report/City (real
-- "permission denied for table" errors, not assumed); the `postgres`
-- role retained full INSERT/SELECT/UPDATE/DELETE throughout. See
-- ai/decisions.md for the full verification record.

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."User" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."Listing" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Listing" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."ListingImage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ListingImage" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."ListingAmenity" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ListingAmenity" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."SavedListing" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SavedListing" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Conversation" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."ConversationParticipant" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ConversationParticipant" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."Message" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Message" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."City" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."City" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."Report" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Report" FROM PUBLIC, anon, authenticated;

ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Notification" FROM PUBLIC, anon, authenticated;
