-- Remove the Oddsbanta profile rows of accounts that never confirmed their email.
-- Run by hand in the SQL editor, only with the owner's OK, and only AFTER
-- migrations/20261031000001_profile_on_email_confirmation.sql is applied.
--
-- What it deletes: public.users, public.entitlements and public.subscriptions rows whose
-- auth.users account has email_confirmed_at IS NULL and no paid subscription.
-- What it keeps: the auth.users account itself (Supabase still holds the sign-up; if the person
-- confirms later, on_auth_user_confirmed recreates their rows) and audit_logs.
--
-- Step 1: preview (read-only). Expect a handful of rows (2 on 31 Oct 2026).
select u.id, split_part(u.email, '@', 2) as domain, u.created_at, s.tier as sub_tier, s.status as sub_status
  from public.users u
  join auth.users a on a.id = u.id
  left join public.subscriptions s on s.user_id = u.id
 where a.email_confirmed_at is null;

-- Step 2: delete in one transaction. Paid rows are skipped on purpose.
begin;

create temporary table _unconfirmed on commit drop as
select u.id
  from public.users u
  join auth.users a on a.id = u.id
 where a.email_confirmed_at is null
   and not exists (
     select 1 from public.subscriptions s
      where s.user_id = u.id and lower(coalesce(s.tier, 'free')) not in ('free', 'trial', 'free_trial')
   );

delete from public.subscriptions where user_id in (select id from _unconfirmed);
delete from public.entitlements  where user_id in (select id from _unconfirmed);
delete from public.users         where id      in (select id from _unconfirmed);

commit;

-- ROLLBACK: not reversible by script. The rows are recreated automatically if the person confirms
-- their email; otherwise restore from a Supabase backup.
