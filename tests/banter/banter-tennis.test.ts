// Banter Hub tennis picks: SQL safety, pickable set, leaderboards counting football + tennis,
// and the My Picks rows across sports.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { footballRow, mergePickRows, tennisRow } from '../../web/src/features/play/banterPickRows';
import { tennisPickLabel } from '../../web/src/features/play/banterTennisRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-tennis');
const sql = readFileSync('../../supabase/migrations/20261115000003_banter_tennis_picks.sql', 'utf8');

test('tennis picks table: RLS on, members read, no direct writes, no football FKs', () => {
  assert.ok(sql.includes('alter table public.tennis_user_picks enable row level security;'));
  assert.ok(sql.includes('revoke all on table public.tennis_user_picks from anon, authenticated;'));
  assert.ok(sql.includes('grant select on table public.tennis_user_picks to authenticated;'));
  assert.ok(!/grant (insert|update|delete)[^;]*tennis_user_picks to authenticated/.test(sql));
  assert.ok(!/references public\.football_/.test(sql), 'no cross-sport foreign keys');
  assert.ok(sql.includes("check (selection in ('p1', 'p2'))"));
});

test('RPCs are definer, pinned search_path, access-checked, closed to public/anon', () => {
  for (const sig of ['banter_tennis_fixtures(date, text)', 'banter_submit_tennis_pick(uuid, text)', 'banter_cancel_tennis_pick(uuid)', 'banter_my_tennis_picks(date, text)', 'banter_leaderboard(text, integer)', 'banter_league_table(uuid, text)']) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
  }
  const defs = sql.split('create or replace function').slice(1);
  assert.equal(defs.length, 6);
  for (const d of defs) {
    assert.ok(d.includes('security definer'));
    assert.ok(d.includes("set search_path = ''"));
    assert.ok(d.includes('public.has_banter_access()'));
  }
});

test('only published predictions are pickable and no AI fields are exposed', () => {
  assert.ok(sql.includes("p.publication_status = 'published'"));
  for (const leak of ['p.prediction', 'p.probability', 'confidence_category', 'p.metadata', 'secondary_predictions']) {
    assert.ok(!sql.includes(leak), leak);
  }
});

test('submit needs a username, a scheduled match and the 60-second lock; no pick cap', () => {
  const submit = sql.slice(sql.indexOf('create or replace function public.banter_submit_tennis_pick'), sql.indexOf('create or replace function public.banter_cancel_tennis_pick'));
  assert.ok(submit.includes("raise exception 'no_profile'"));
  assert.ok(submit.includes("v_status <> 'scheduled'"));
  assert.ok(submit.includes("interval '60 seconds'"));
  assert.ok(!/count\(\*\)/.test(submit));
});

test('leaderboard and league tables now count football + tennis, same columns', () => {
  for (const fn of ['banter_leaderboard', 'banter_league_table']) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}`));
    const end = body.indexOf('$$;');
    const def = body.slice(0, end);
    assert.ok(def.includes('from public.football_user_picks fp'), `${fn} football`);
    assert.ok(def.includes('from public.tennis_user_picks tp'), `${fn} tennis`);
    assert.ok(def.includes('union all'));
    for (const col of ['place integer', 'points numeric', 'voided integer', 'hit_rate numeric', 'is_me boolean']) assert.ok(def.includes(col), `${fn} ${col}`);
    assert.ok(def.includes('not pp.leaderboard_banned'));
  }
});

test('tennis pick labels', () => {
  assert.equal(tennisPickLabel('p1', 'Jannik Sinner', 'Alex de Minaur'), 'Jannik Sinner to win');
  assert.equal(tennisPickLabel('p2', null, null), 'Player 2 to win');
});

test('My Picks rows merge sports newest first', () => {
  const f = footballRow({
    id: 'a', fixture_id: 'x', market: '1X2', selection: 'home', kickoff_at: '2026-11-14T15:00:00Z', status: 'won', points: 3,
    settled_at: null, fixture_status: 'finished', league_name: 'Premier League', league_country: 'England',
    home_team: 'Arsenal', away_team: 'Chelsea', home_score: 2, away_score: 1,
  });
  const t = tennisRow({
    id: 'b', fixture_id: 'y', selection: 'p2', kickoff_at: '2026-11-15T10:00:00Z', status: 'pending', points: null,
    settled_at: null, fixture_status: 'scheduled', tournament_name: 'ATP Finals', player1: 'Sinner', player2: 'Alcaraz',
    p1_sets: null, p2_sets: null,
  });
  assert.equal(f.pick, 'Arsenal win');
  assert.equal(f.score, '2 – 1');
  assert.equal(t.pick, 'Alcaraz to win');
  assert.equal(t.market, 'Match winner');
  assert.deepEqual(mergePickRows([f, t]).map((r) => r.sport), ['tennis', 'football']);
});

console.log(`banter-tennis: ${passed} passed`);
