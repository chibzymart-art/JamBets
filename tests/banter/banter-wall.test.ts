// Banter Hub wall: SQL safety rules (access, membership, rate limits, soft delete, no direct access)
// and the website helpers (counter, time labels, messages, plain-text rendering).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WALL_MAX, timeAgo, wallCharsLeft, wallErrorMessage } from '../../web/src/features/play/banterRules';
import { PLAY_TABS, playTabFromPath } from '../../web/src/features/play/playTabs';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-wall');
const sql = readFileSync('../../supabase/migrations/20261115000002_banter_wall.sql', 'utf8');
const RPCS = ['banter_post(text, uuid)', 'banter_delete_post(uuid)', 'banter_wall(uuid, timestamptz, integer)'];

test('table has RLS on and no direct access', () => {
  assert.ok(sql.includes('alter table public.banter_posts enable row level security;'));
  assert.ok(sql.includes('revoke all on table public.banter_posts from anon, authenticated;'));
  assert.ok(!/create policy/i.test(sql));
  assert.ok(!/grant [a-z, ]+ on table public\.banter_posts to authenticated/.test(sql));
});

test('RPCs are definer, pinned search_path, access-checked, closed to public/anon', () => {
  for (const sig of RPCS) assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
  const defs = sql.split('create or replace function').slice(1);
  assert.equal(defs.length, 3);
  for (const d of defs) {
    assert.ok(d.includes('security definer'));
    assert.ok(d.includes("set search_path = ''"));
    assert.ok(d.includes('public.has_banter_access()'));
  }
});

test('posting rules: username, banned, length, membership, rate limits', () => {
  const post = sql.slice(sql.indexOf('create or replace function public.banter_post('), sql.indexOf('create or replace function public.banter_delete_post'));
  assert.ok(post.includes("raise exception 'no_profile'"));
  assert.ok(post.includes("raise exception 'banned'"));
  assert.ok(post.includes('char_length(v_body) > 280'));
  assert.ok(post.includes("raise exception 'not_member'"));
  assert.ok(post.includes("interval '10 seconds'"));
  assert.ok(post.includes("interval '24 hours') >= 60"));
  assert.ok(sql.includes(`between 1 and ${WALL_MAX}`));
});

test('delete is soft, by the author or an admin', () => {
  const del = sql.slice(sql.indexOf('create or replace function public.banter_delete_post'), sql.indexOf('create or replace function public.banter_wall'));
  assert.ok(del.includes('public.is_admin()'));
  assert.ok(del.includes('set deleted_at = now(), deleted_by = v_uid'));
  assert.ok(!/delete from public\.banter_posts/.test(del));
});

test('wall hides deleted and banned posts, limits to 50, league walls are members only', () => {
  const wall = sql.slice(sql.indexOf('create or replace function public.banter_wall'));
  assert.ok(wall.includes('p.deleted_at is null'));
  assert.ok(wall.includes('not pp.leaderboard_banned'));
  assert.ok(wall.includes('least(greatest(coalesce(p_limit, 30), 1), 50)'));
  assert.ok(wall.includes('m.league_id = p_league_id and m.user_id = v_uid'));
  assert.ok(wall.includes('order by p.created_at desc'));
  const ret = wall.slice(wall.indexOf('returns table ('), wall.indexOf('language plpgsql'));
  assert.ok(!/user_id|email/.test(ret), 'no ids or emails returned');
});

test('character counter counts after trimming, emoji as one', () => {
  assert.equal(wallCharsLeft(''), WALL_MAX);
  assert.equal(wallCharsLeft('  hi  '), WALL_MAX - 2);
  assert.equal(wallCharsLeft('🔥🔥'), WALL_MAX - 2);
  assert.equal(wallCharsLeft('x'.repeat(WALL_MAX + 5)), -5);
});

test('time labels', () => {
  const now = Date.UTC(2026, 10, 15, 12, 0, 0);
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  assert.equal(timeAgo(ago(10), now), 'just now');
  assert.equal(timeAgo(ago(5 * 60), now), '5m');
  assert.equal(timeAgo(ago(3 * 3600), now), '3h');
  assert.equal(timeAgo(ago(2 * 86400), now), '2d');
  assert.equal(timeAgo('bad', now), '');
});

test('every wall error has a message, including not switched on yet', () => {
  for (const c of ['body_invalid', 'too_fast', 'daily_limit', 'banned', 'not_member', 'not_allowed', 'post_not_found', 'no_profile', 'no_access', 'not_ready', 'not_signed_in', 'weird']) {
    assert.ok(wallErrorMessage(c).length > 5, c);
  }
});

test('Wall tab exists at /play/wall', () => {
  assert.ok(PLAY_TABS.some((t) => t.id === 'wall' && t.path === '/play/wall'));
  assert.equal(playTabFromPath('/play/wall'), 'wall');
});

test('posts render as plain text (no innerHTML, no linkify)', () => {
  const src = readFileSync('../../web/src/features/play/BanterWall.tsx', 'utf8');
  assert.ok(!src.includes('dangerouslySetInnerHTML'));
  assert.ok(!/linkify|autolink|<a /i.test(src));
  assert.ok(src.includes('{p.body}'));
});

console.log(`banter-wall: ${passed} passed`);
