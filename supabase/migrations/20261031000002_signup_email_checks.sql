-- Sign-up email checks (31 Oct 2026): block disposable addresses and alias duplicates.
--
-- Adds a Supabase Auth "Before User Created" hook, public.hook_before_user_created(event jsonb).
-- Supabase calls it before inserting into auth.users (email and Google sign-ups alike). It rejects:
--   1. Disposable / throwaway domains listed in public.disposable_email_domains.
--   2. An address that is the same inbox as an existing account, after normalization:
--        lowercase; drop everything from "+" to "@" (all providers);
--        gmail.com / googlemail.com only: drop dots in the local part, googlemail.com -> gmail.com.
--      So john+promo@gmail.com and j.o.h.n@gmail.com are refused when john@gmail.com exists.
-- Existing accounts are never touched; the check only runs for new sign-ups.
--
-- After applying, switch the hook on: Supabase Dashboard > Authentication > Auth Hooks >
-- Add hook > "Before User Created" > Postgres > public.hook_before_user_created.
-- Until then nothing changes for users.
--
-- The domain list is seeded with common throwaway providers below and refreshed monthly from the
-- open-source disposable-email-domains list by .github/workflows/refresh_disposable_domains.yml.
--
-- ROLLBACK:
--   (Dashboard) remove the Before User Created hook first, then:
--   drop function if exists public.hook_before_user_created(jsonb);
--   drop function if exists public.normalize_email(text);
--   drop table if exists public.disposable_email_domains;

-- 1. Domain blocklist. Not readable through the Data API; only the auth hook and the service role use it.
create table if not exists public.disposable_email_domains (
  domain text primary key check (domain = lower(domain)),
  source text not null default 'seed',
  added_at timestamptz not null default now()
);

alter table public.disposable_email_domains enable row level security;
revoke all on table public.disposable_email_domains from public, anon, authenticated;
grant select, insert, update, delete on table public.disposable_email_domains to service_role;
grant select on table public.disposable_email_domains to supabase_auth_admin;

insert into public.disposable_email_domains (domain) values
  ('10minutemail.com'), ('10minutemail.net'), ('20minutemail.com'), ('33mail.com'), ('anonaddy.me'),
  ('burnermail.io'), ('byom.de'), ('chacuo.net'), ('discard.email'), ('dispostable.com'),
  ('dropmail.me'), ('emailondeck.com'), ('emailtemporanea.net'), ('fakeinbox.com'), ('fakemail.net'),
  ('getairmail.com'), ('getnada.com'), ('guerrillamail.biz'), ('guerrillamail.com'), ('guerrillamail.de'),
  ('guerrillamail.info'), ('guerrillamail.net'), ('guerrillamail.org'), ('guerrillamailblock.com'), ('harakirimail.com'),
  ('inboxbear.com'), ('inboxkitten.com'), ('incognitomail.org'), ('jetable.org'), ('mail-temp.com'),
  ('mail.tm'), ('mailcatch.com'), ('maildrop.cc'), ('mailinator.com'), ('mailinator.net'),
  ('mailnesia.com'), ('mailpoof.com'), ('mailsac.com'), ('mintemail.com'), ('moakt.com'),
  ('mohmal.com'), ('mvrht.net'), ('mytemp.email'), ('nada.email'), ('owlymail.com'),
  ('sharklasers.com'), ('spam4.me'), ('spambox.us'), ('spamgourmet.com'), ('temp-mail.io'),
  ('temp-mail.org'), ('tempail.com'), ('tempinbox.com'), ('tempmail.com'), ('tempmail.dev'),
  ('tempmail.net'), ('tempmailo.com'), ('tempr.email'), ('throwawaymail.com'), ('tmail.ws'),
  ('tmpmail.net'), ('tmpmail.org'), ('trashmail.com'), ('trashmail.de'), ('trashmail.net'),
  ('wegwerfmail.de'), ('yopmail.com'), ('yopmail.fr'), ('yopmail.net'), ('emailfake.com'),
  ('grr.la'), ('pokemail.net'), ('spamthisplease.com'), ('mailnull.com'), ('minuteinbox.com'),
  ('tempmailaddress.com'), ('trbvm.com'), ('vomoto.com'), ('linshiyouxiang.net'), ('cuvox.de')
on conflict (domain) do nothing;

-- 2. Normalization used for the duplicate check (also handy for Admin queries).
create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then lower(p_email)
    else (
      with parts as (
        select split_part(lower(trim(p_email)), '@', 1) as local_part,
               split_part(lower(trim(p_email)), '@', 2) as domain_part
      ), stripped as (
        select split_part(local_part, '+', 1) as local_part, domain_part from parts
      )
      select case
        when domain_part in ('gmail.com', 'googlemail.com') then replace(local_part, '.', '') || '@gmail.com'
        else local_part || '@' || domain_part
      end
      from stripped
    )
  end
$$;

revoke all on function public.normalize_email(text) from public, anon, authenticated;
grant execute on function public.normalize_email(text) to service_role, supabase_auth_admin;

-- 3. The hook. Runs as supabase_auth_admin (SECURITY INVOKER), which owns auth.users.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(event #>> '{user,email}', '')));
  v_domain text;
  v_norm text;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return '{}'::jsonb; -- phone or other sign-ups: nothing to check
  end if;

  v_domain := split_part(v_email, '@', 2);

  if exists (select 1 from public.disposable_email_domains d where d.domain = v_domain) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Please use a permanent email address. Temporary inboxes are not accepted.'));
  end if;

  v_norm := public.normalize_email(v_email);
  if exists (
    select 1 from auth.users u
     where u.email is not null
       and split_part(lower(u.email), '@', 2) = any (case when v_domain in ('gmail.com', 'googlemail.com')
                                                         then array['gmail.com', 'googlemail.com']
                                                         else array[v_domain] end)
       and public.normalize_email(u.email) = v_norm
       and lower(u.email) <> v_email
  ) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 409,
      'message', 'An account already exists for this email address. Please sign in instead.'));
  end if;

  return '{}'::jsonb;
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- Verify the normalization rules.
do $$
begin
  if public.normalize_email('J.O.H.N+promo@GoogleMail.com') <> 'john@gmail.com' then
    raise exception 'normalize_email: gmail rule broken';
  end if;
  if public.normalize_email('jane.doe+x@yahoo.com') <> 'jane.doe@yahoo.com' then
    raise exception 'normalize_email: non-gmail dots must be kept';
  end if;
  if (public.hook_before_user_created('{"user":{"email":"a@mailinator.com"}}'::jsonb) -> 'error') is null then
    raise exception 'hook: disposable domain not rejected';
  end if;
  if public.hook_before_user_created('{"user":{"email":"brand-new-address-test@example.org"}}'::jsonb) <> '{}'::jsonb then
    raise exception 'hook: ordinary address rejected';
  end if;
end $$;
