// Banter Hub weekly winners and streaks: SQL rules and the website wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasCrown } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-weekly-winner');
const sql = readFileSync('../../supabase/migrations/20261115000011_banter_weekly_winner.sql', 'utf8');
const play = (f: string) => readFileSync(`../../web/src/features/play/${f}`, 'utf8');
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};

test('tables: RLS on, no direct access, one winner per week per scope', () => {
  for (const t of ['banter_weekly_winners', 'banter_weeks_computed']) {
    assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
    assert.ok(sql.includes(`revoke all on table public.${t} from anon, authenticated;`), t);
  }
  assert.ok(sql.includes('banter_weekly_winners_one_per_scope'));
  assert.ok(!/create policy/i.test(sql));
});

test('compute: Monday-Sunday Lagos week, frozen 12 hours after it ends, once, banned never win, 3+ settled', () => {
  const b = fnBody('banter_compute_weekly_winners');
  assert.ok(b.includes("date_trunc('week', v_local) - interval '7 days'") && b.includes("'Africa/Lagos'"));
  assert.ok(b.includes("now() < v_to + interval '12 hours'"));
  assert.ok(b.includes('banter_weeks_computed') && b.includes('pg_try_advisory_xact_lock'));
  assert.ok((b.match(/not pp\.leaderboard_banned/g) || []).length >= 2);
  assert.ok((b.match(/having count\(\*\) >= 3/g) || []).length === 2);
  assert.ok(b.includes('partition by m.league_id') && b.includes('z.rk = 1'));
  assert.ok(b.includes("k.status in ('won', 'lost', 'void') and k.kickoff_at >= v_from and k.kickoff_at < v_to"));
  assert.ok(!/update public\.football_user_picks|delete from public\.football_user_picks/.test(sql), 'read-only over picks');
});

test('RPCs: definer, pinned search_path, paid-only; compute is internal', () => {
  for (const sig of ['banter_crowns()', 'banter_my_streaks()']) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
    assert.ok(fnBody(sig.replace('()', '')).includes('public.has_banter_access()'), sig);
  }
  assert.ok(sql.includes('revoke execute on function public.banter_compute_weekly_winners() from public, anon, authenticated;'));
  assert.ok(!sql.includes('grant execute on function public.banter_compute_weekly_winners() to authenticated'));
  for (const d of sql.split('create or replace function').slice(1)) {
    assert.ok(d.includes('security definer') && d.includes("set search_path = ''"));
  }
});

test('crowns show last week winners; league crowns only for leagues you are in', () => {
  const b = fnBody('banter_crowns');
  assert.ok(b.includes('perform public.banter_compute_weekly_winners()'));
  assert.ok(b.includes('me.league_id = w.league_id and me.user_id = v_uid'));
});

test('streaks: lost starts a new run, voids skipped, current = the latest run', () => {
  const b = fnBody('banter_my_streaks');
  assert.ok(b.includes("k.status in ('won', 'lost')"));
  assert.ok(b.includes("sum(case when k.status = 'lost' then 1 else 0 end) over (order by k.kickoff_at"));
  assert.ok(b.includes('order by r.grp desc limit 1'));
  assert.ok(b.includes("'weeks_won'") && b.includes("'league_weeks_won'"));
});

test('website: crown on the leaderboard, in each league table, and on the profile', () => {
  assert.ok(play('BanterLeaderboard.tsx').includes('hasCrown(crown, r.handle)'));
  assert.ok(play('BanterLeagues.tsx').includes('hasCrown(crown, r.handle)') && play('BanterLeagues.tsx').includes('crowns[l.league_id]'));
  const p = play('BanterProfile.tsx');
  assert.ok(p.includes('<StreaksCard />') && p.includes('Current streak') && p.includes('Weeks won'));
  assert.ok(hasCrown('Ada', 'ada') && !hasCrown(null, 'ada') && !hasCrown('Ada', 'Bo'));
});

console.log(`banter-weekly-winner: ${passed} passed`);
