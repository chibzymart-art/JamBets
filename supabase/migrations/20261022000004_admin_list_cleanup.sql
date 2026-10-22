-- Admin list cleanup (22 Oct 2026, audit AZT-13). Safe to re-run.
--
-- chibuezeamuchie@gmail.com was on the hardcoded admin list but has no account. Anyone able to sign
-- up with that address would have become admin. It is removed from the two live functions that list
-- admin emails, by editing their current definitions in place (the live bodies differ from the old
-- migration files, so rewriting them from the files would undo other live fixes).
-- Phase 2 replaces these lists with a private.admin_users table.
--
-- ROLLBACK: re-add the address to both lists (not recommended unless that account is created first).

do $$
declare
  fn text;
  def text;
  new_def text;
begin
  foreach fn in array array['is_admin', 'is_multisport_entitled'] loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn and p.pronargs = 0;
    if def is null then
      continue;
    end if;
    -- Remove the list entry and one adjacent comma, whether the list is on one line or one per line.
    new_def := regexp_replace(def, E'''chibuezeamuchie@gmail\\.com''\\s*,\\s*', '', 'gi');
    new_def := regexp_replace(new_def, E'\\s*,\\s*''chibuezeamuchie@gmail\\.com''', '', 'gi');
    if new_def <> def then
      execute new_def;
      raise notice 'removed address from public.%()', fn;
    end if;
  end loop;
end $$;

-- Verify: no function may still list the address.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc ilike '%chibuezeamuchie@gmail.com%') then
    raise exception 'address still listed in a public function';
  end if;
end $$;

select p.proname,
       array_length(regexp_split_to_array(p.prosrc, '@gmail\.com'), 1) - 1 as listed_admin_emails
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('is_admin', 'is_multisport_entitled');
