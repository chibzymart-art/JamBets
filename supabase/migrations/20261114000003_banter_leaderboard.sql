-- Banter Hub step 4: leaderboard.
-- Additive only: one read-only function over the Banter tables (football_user_picks, player_profiles).
-- Nothing in the Predictions Hub changes. Needs 20261114000001 and 20261114000002 applied first.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Ranking (owner): settled picks only. Points come from the settle job (won 3, lost 0, void 0.5,
-- stored on each pick). Order: points, then hit rate (won / (won + lost)), then more settled picks,
-- then the earlier first pick. Members with leaderboard_banned = true are left out.
-- Periods use Lagos time (WAT): 'week' = since Monday 00:00, 'month' = since the 1st 00:00, 'all'.
-- Paid members only (has_banter_access); everyone else gets zero rows.

create or replace function public.banter_leaderboard(p_period text default 'week', p_limit integer default 50)
returns table (
  place integer,
  handle text,
  avatar_emoji text,
  points numeric,
  won integer,
  lost integer,
  voided integer,
  settled integer,
  hit_rate numeric,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_period text := lower(coalesce(p_period, 'week'));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_local timestamp := (now() at time zone 'Africa/Lagos');
  v_since timestamptz;
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;

  if v_period = 'week' then
    v_since := (date_trunc('week', v_local)) at time zone 'Africa/Lagos';
  elsif v_period = 'month' then
    v_since := (date_trunc('month', v_local)) at time zone 'Africa/Lagos';
  else
    v_since := '-infinity'::timestamptz;
  end if;

  return query
  with totals as (
    select k.user_id,
           sum(coalesce(k.points, 0))::numeric as pts,
           count(*) filter (where k.status = 'won')::integer as w,
           count(*) filter (where k.status = 'lost')::integer as l,
           count(*) filter (where k.status = 'void')::integer as v,
           count(*)::integer as s,
           min(k.created_at) as first_pick
      from public.football_user_picks k
     where k.status in ('won', 'lost', 'void')
       and k.kickoff_at >= v_since
     group by k.user_id
  ),
  ranked as (
    select t.*,
           pp.handle as h,
           pp.avatar_emoji as a,
           case when t.w + t.l > 0 then round(t.w::numeric * 100 / (t.w + t.l), 1) else 0 end as hr,
           row_number() over (
             order by t.pts desc,
                      case when t.w + t.l > 0 then t.w::numeric / (t.w + t.l) else 0 end desc,
                      t.s desc,
                      t.first_pick asc
           )::integer as rk
      from totals t
      join public.player_profiles pp on pp.user_id = t.user_id
     where not pp.leaderboard_banned
  )
  select r.rk, r.h, r.a, r.pts, r.w, r.l, r.v, r.s, r.hr, (r.user_id = v_uid)
    from ranked r
   where r.rk <= v_limit or r.user_id = v_uid
   order by r.rk;
end;
$$;

revoke execute on function public.banter_leaderboard(text, integer) from public, anon;
grant execute on function public.banter_leaderboard(text, integer) to authenticated, service_role;

-- Expected Security Advisor result: no new errors; one more of the accepted warning class
-- "Signed-In Users Can Execute SECURITY DEFINER" (the function checks has_banter_access() first).

-- ROLLBACK:
--   drop function if exists public.banter_leaderboard(text, integer);
