-- Acca slip saved to the member's account, so it follows them across devices.
-- Additive only: one new table and two functions. No existing table, view, policy or function changes.
-- Owner decision (18 Nov 2026): "Yes, sync slip to account".
--
-- The website keeps its existing per-device copy (localStorage) and syncs it with this row:
-- first sign-in on a device merges both, after that the newest save wins.
-- Any signed-in user may store their own slip (the slip is not a paid feature). Nobody can read
-- or write anyone else's: RLS on, no grants, no policies; only the two functions below touch it.

create table if not exists public.user_slips (
  user_id uuid primary key references public.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  fixture_ids text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint user_slips_items_array check (jsonb_typeof(items) = 'array'),
  constraint user_slips_items_count check (jsonb_array_length(items) <= 200),
  constraint user_slips_items_size check (pg_column_size(items) <= 262144),
  constraint user_slips_fixture_count check (cardinality(fixture_ids) <= 500)
);

alter table public.user_slips enable row level security;
revoke all on table public.user_slips from public, anon, authenticated;
grant select, insert, update, delete on table public.user_slips to service_role;

-- The caller's saved slip, or an empty one (updated_at null) if they have never saved.
create or replace function public.slip_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.user_slips%rowtype;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into v_row from public.user_slips s where s.user_id = v_uid;
  if not found then
    return jsonb_build_object('items', '[]'::jsonb, 'fixture_ids', '[]'::jsonb, 'updated_at', null);
  end if;
  return jsonb_build_object('items', v_row.items, 'fixture_ids', to_jsonb(v_row.fixture_ids), 'updated_at', v_row.updated_at);
end;
$$;

-- Replace the caller's saved slip. Returns the new updated_at.
-- Errors: not_signed_in, slip_invalid, slip_too_large, no_user_row.
create or replace function public.slip_save(p_items jsonb, p_fixture_ids text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_ids text[] := coalesce(p_fixture_ids, '{}'::text[]);
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if jsonb_typeof(v_items) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_items) e where jsonb_typeof(e) <> 'object') then
    raise exception 'slip_invalid';
  end if;
  if jsonb_array_length(v_items) > 200 or pg_column_size(v_items) > 262144 or cardinality(v_ids) > 500
     or exists (select 1 from unnest(v_ids) x where char_length(x) > 100) then
    raise exception 'slip_too_large';
  end if;
  if not exists (select 1 from public.users u where u.id = v_uid) then
    raise exception 'no_user_row';
  end if;

  insert into public.user_slips as s (user_id, items, fixture_ids, updated_at)
  values (v_uid, v_items, v_ids, now())
  on conflict (user_id) do update
    set items = excluded.items, fixture_ids = excluded.fixture_ids, updated_at = now()
  returning s.updated_at into v_at;

  return jsonb_build_object('updated_at', v_at);
end;
$$;

revoke execute on function public.slip_get() from public, anon;
revoke execute on function public.slip_save(jsonb, text[]) from public, anon;
grant execute on function public.slip_get() to authenticated, service_role;
grant execute on function public.slip_save(jsonb, text[]) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. Two RPCs join the accepted
-- "Signed-In Users Can Execute SECURITY DEFINER" warnings; each only reads/writes the caller's row.

-- ROLLBACK:
--   drop function if exists public.slip_save(jsonb, text[]);
--   drop function if exists public.slip_get();
--   drop table if exists public.user_slips;
