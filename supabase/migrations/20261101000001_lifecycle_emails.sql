-- Lifecycle and daily results emails (1 Nov 2026).
--
-- Two service-role-only tables for the daily email job (python/src/email_engine/lifecycle.py):
--   * email_preferences: one row per user with a random unsubscribe token and the opt-outs. The
--     unsubscribe page (api/unsubscribe.ts) finds the row by token, so no shared secret is needed.
--   * email_send_log: one row per (user, campaign, period). The unique key stops the job from sending
--     the same reminder twice when it is re-run or two runs overlap.
--
-- The 14 Sep email tables (email_subscribers, email_queue, ...) were never applied to the live
-- database and are not used by this job.
--
-- Nobody reads these through the Data API: RLS is on, there are no policies, and anon/authenticated
-- have no grants. The Python job and the unsubscribe endpoint use the service role.
--
-- ROLLBACK:
--   drop table if exists public.email_send_log;
--   drop table if exists public.email_preferences;

create table if not exists public.email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  unsubscribe_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  daily_results boolean not null default true,  -- daily results email (marketing)
  lifecycle boolean not null default true,      -- trial, renewal and win-back reminders
  unsubscribed_all_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_send_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign text not null,
  period_key text not null,  -- e.g. '2026-11-01' for daily results, period end for renewals
  status text not null default 'sent' check (status in ('sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (user_id, campaign, period_key)
);

create index if not exists idx_email_send_log_created_at on public.email_send_log (created_at);

alter table public.email_preferences enable row level security;
alter table public.email_send_log enable row level security;

revoke all on table public.email_preferences from anon, authenticated;
revoke all on table public.email_send_log from anon, authenticated;
grant select, insert, update, delete on table public.email_preferences to service_role;
grant select, insert, update, delete on table public.email_send_log to service_role;
