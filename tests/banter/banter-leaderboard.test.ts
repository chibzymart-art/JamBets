// Banter Hub leaderboard: SQL rules (access, settled only, banned left out, tie-breaks, WAT periods)
// and the display helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatPoints, splitLeaderboard } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-leaderboard');
const sql = readFileSync('../../supabase/migrations/20261114000003_banter_leaderboard.sql', 'utf8');

test('paid members only, execute revoked from public and anon', () => {
  assert.ok(sql.includes('not public.has_banter_access()'));
  assert.ok(sql.includes('revoke execute on function public.banter_leaderboard(text, integer) from public, anon;'));
  assert.ok(sql.includes("set search_path = ''"));
});

test('counts settled picks only and leaves banned members out', () => {
  assert.ok(sql.includes("k.status in ('won', 'lost', 'void')"));
  assert.ok(sql.includes('not pp.leaderboard_banned'));
});

test('ranks by points, then hit rate, then settled picks, then first pick', () => {
  const order = sql.slice(sql.indexOf('row_number() over ('), sql.indexOf(')::integer as rk'));
  const iPts = order.indexOf('t.pts desc');
  const iHit = order.indexOf('t.w::numeric / (t.w + t.l)');
  const iSettled = order.indexOf('t.s desc');
  const iFirst = order.indexOf('t.first_pick asc');
  assert.ok(iPts >= 0 && iPts < iHit && iHit < iSettled && iSettled < iFirst);
});

test('periods use Lagos time and the caller row is always returned', () => {
  assert.ok(sql.includes("date_trunc('week', v_local)"));
  assert.ok(sql.includes("date_trunc('month', v_local)"));
  assert.ok(sql.includes("now() at time zone 'Africa/Lagos'"));
  assert.ok(sql.includes('r.rk <= v_limit or r.user_id = v_uid'));
});

test('never exposes user ids or emails', () => {
  const ret = sql.slice(sql.indexOf('returns table ('), sql.indexOf('language plpgsql'));
  assert.ok(!/user_id|email/.test(ret));
});

test('points formatting', () => {
  assert.equal(formatPoints(3), '3 pts');
  assert.equal(formatPoints('12.5'), '12.5 pts');
  assert.equal(formatPoints(0), '0 pts');
  assert.equal(formatPoints(null), '0 pts');
  assert.equal(formatPoints('x'), '0 pts');
});

test('own row shown separately only when outside the top list', () => {
  const rows = [
    { place: 1, is_me: false }, { place: 2, is_me: true }, { place: 3, is_me: false },
  ];
  assert.deepEqual(splitLeaderboard(rows, 50), { top: rows, me: null });
  const far = [{ place: 1, is_me: false }, { place: 77, is_me: true }];
  assert.deepEqual(splitLeaderboard(far, 50), { top: [far[0]], me: far[1] });
});

console.log(`banter-leaderboard: ${passed} passed`);
