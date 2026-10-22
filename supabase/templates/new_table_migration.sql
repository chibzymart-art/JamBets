-- Template for a migration that adds a table to the public schema.
-- Copy to supabase/migrations/YYYYMMDDHHMMSS_<description>.sql and edit.
--
-- Why explicit grants: from 30 Oct 2026 Supabase stops auto-granting new public tables to
-- anon / authenticated / service_role, and this project has "automatically expose new tables"
-- to be switched off. Every table must state who may touch it, on purpose.
--
-- Rules for Oddsbanta:
--   * Prediction, settlement and simulation data is NEVER readable by anon. The website reads it
--     through the Edge API with the service role, which bypasses RLS.
--   * Every policy names its roles (TO ...). A policy without TO applies to everyone, anon included.
--   * The service role needs no policy: it bypasses RLS. Do not add "USING (true)" policies for it.
--   * Views: create WITH (security_invoker = true) so they obey the caller's RLS.
--   * SECURITY DEFINER functions: SET search_path = '' and revoke EXECUTE from public, anon.

create table if not exists public.example_table (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.example_table enable row level security;

-- Grants: start from nothing, then add only what is needed.
revoke all on table public.example_table from anon, authenticated;
grant select, insert, update, delete on table public.example_table to service_role;
-- grant select on table public.example_table to authenticated;   -- only if signed-in users read it directly

-- Policies (only for roles that were granted access above):
-- create policy "example_select_own" on public.example_table
--   for select to authenticated
--   using (user_id = (select auth.uid()));

-- ROLLBACK:
--   drop table if exists public.example_table;
