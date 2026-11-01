-- Refuse any sign-up address with a "+" tag (31 Oct 2026).
--
-- 20261031000002 only refused "name+tag@domain" when "name@domain" already had an account. On
-- 31 Oct "chibueze+1@ultimaspark.online" got through because no "chibueze@ultimaspark.online"
-- existed yet, so each "+1", "+2", ... address could still open a fresh account and trial.
-- The owner wants "+" addresses refused outright. Existing accounts are not touched.
--
-- Same function as before with one new check first; grants are unchanged.
--
-- ROLLBACK: re-run public.hook_before_user_created from 20261031000002_signup_email_checks.sql.

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

  if position('+' in split_part(v_email, '@', 1)) > 0 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Email addresses with a "+" are not accepted. Please sign up with your main email address.'));
  end if;

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

-- Verify
do $$
begin
  if (public.hook_before_user_created('{"user":{"email":"someone+1@example.org"}}'::jsonb) -> 'error') is null then
    raise exception 'hook: plus address not rejected';
  end if;
  if public.hook_before_user_created('{"user":{"email":"brand-new-address-test@example.org"}}'::jsonb) <> '{}'::jsonb then
    raise exception 'hook: ordinary address rejected';
  end if;
end $$;
