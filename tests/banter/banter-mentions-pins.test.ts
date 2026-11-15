// Banter Hub @mentions and pinned topics: SQL rules and the website helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mentionQueryAt, notificationLine, splitMentions } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-mentions-pins');
const sql = readFileSync('../../supabase/migrations/20261115000009_banter_mentions_pins.sql', 'utf8');
const play = (f: string) => readFileSync(`../../web/src/features/play/${f}`, 'utf8');
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};
const MEMBER_RPCS = [
  'banter_search_handles(text, uuid)',
  'banter_create_topic(text, text)',
  'banter_post_reply(uuid, text, uuid, boolean)',
  'banter_post(text, uuid, uuid)',
  'banter_pin_topic(uuid, boolean)',
  'banter_topics(text, integer, integer)',
  'banter_my_notifications(integer)',
  'banter_unread_count()',
];

test('mentions table: RLS on, no direct access, one row per member per message', () => {
  assert.ok(sql.includes('alter table public.banter_mentions enable row level security;'));
  assert.ok(sql.includes('revoke all on table public.banter_mentions from anon, authenticated;'));
  assert.ok(sql.includes('unique (source_kind, source_id, mentioned_user_id)'));
  assert.ok(!/create policy/i.test(sql));
});

test('RPCs: definer, pinned search_path, paid-only, closed to public/anon; helpers internal', () => {
  for (const sig of MEMBER_RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
  }
  for (const d of sql.split('create or replace function').slice(1)) {
    assert.ok(d.includes('security definer') && d.includes("set search_path = ''"));
  }
  assert.ok(sql.includes('revoke execute on function public.banter_apply_mentions(text, uuid, text, uuid, uuid, uuid, uuid[]) from public, anon, authenticated;'));
  assert.ok(!sql.includes('grant execute on function public.banter_apply_mentions'));
});

test('suggestions: prefix only, at most 8, paid, never banned or yourself, league members on a league wall', () => {
  const b = fnBody('banter_search_handles');
  assert.ok(b.includes('public.has_banter_access()') && b.includes('limit 8'));
  assert.ok(b.includes("like v_prefix || '%'") && b.includes("regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9_]', '', 'g')"));
  assert.ok(b.includes('not pp.leaderboard_banned') && b.includes('pp.user_id <> v_uid'));
  assert.ok(b.includes('m.league_id = p_league_id and m.user_id = pp.user_id'));
});

test('resolution: at most 5, existing paid members, not banned, not yourself, league members, no duplicates', () => {
  const b = fnBody('banter_apply_mentions');
  assert.ok(b.includes('limit 5'));
  assert.ok(b.includes('pp.user_id <> p_author') && b.includes('not pp.leaderboard_banned'));
  assert.ok(b.includes('public.banter_user_has_access(pp.user_id)'));
  assert.ok(b.includes('lm.league_id = p_league_id and lm.user_id = pp.user_id'));
  assert.ok(b.includes("v_rec.user_id = any (coalesce(p_skip, '{}'))"));
  assert.ok(fnBody('banter_create_topic').includes("banter_apply_mentions('topic'"));
  assert.ok(fnBody('banter_post_reply').includes('array_remove(array[v_target, v_topic_author], null)'));
  assert.ok(fnBody('banter_post').includes("banter_apply_mentions('post'") && fnBody('banter_post').includes('array_remove(array[v_tag], null)'));
});

test('post functions keep every earlier rule', () => {
  assert.ok(fnBody('banter_create_topic').includes('public.banter_discussion_guard()'));
  assert.ok(fnBody('banter_post_reply').includes('public.banter_discussion_guard()'));
  const p = fnBody('banter_post');
  for (const r of ["'not_member'", "'banned'", "'no_profile'", "interval '10 seconds'", '>= 60', "'post_not_found'", "'league_reply'"]) {
    assert.ok(p.includes(r), r);
  }
});

test('pins: admins only, at most 5, pinned first', () => {
  const b = fnBody('banter_pin_topic');
  assert.ok(b.includes('public.is_admin()') && b.includes("raise exception 'not_allowed'"));
  assert.ok(b.includes('>= 5') && b.includes("raise exception 'too_many_pinned'"));
  const t = fnBody('banter_topics');
  assert.ok(t.includes('order by (t.pinned_at is not null) desc'));
  assert.ok(t.includes('is_pinned boolean') && t.includes('can_pin boolean'));
});

test('notifications and push include mentions', () => {
  assert.ok(sql.includes("'reaction', 'mention'"));
  assert.ok(fnBody('banter_my_notifications').includes("n.kind in ('reaction', 'mention')"));
  assert.ok(fnBody('banter_unread_count').includes("n.kind in ('reaction', 'mention')"));
  const push = fnBody('banter_push_targets');
  assert.ok(push.includes("' mentioned you'") && push.includes("p_kind = 'topic'"));
  assert.ok(readFileSync('../../api/banter-push.ts', 'utf8').includes("'topic'"));
  assert.equal(notificationLine('mention', 'Ada'), 'Ada mentioned you');
});

test('highlighting and suggestions helpers', () => {
  assert.deepEqual(splitMentions('hi @Ada_9 and @bo!'), [
    { text: 'hi ', mention: false },
    { text: '@Ada_9', mention: true },
    { text: ' and @bo!', mention: false },
  ]);
  assert.deepEqual(splitMentions('mail a@bcd.com'), [{ text: 'mail a@bcd.com', mention: false }]);
  assert.deepEqual(mentionQueryAt('hello @ad', 9), { prefix: 'ad', start: 6 });
  assert.deepEqual(mentionQueryAt('@', 1), { prefix: '', start: 0 });
  assert.equal(mentionQueryAt('mail a@b', 8), null);
  assert.equal(mentionQueryAt('hello @ad ', 10), null);
});

test('every Banter message box suggests names; messages render through MessageText', () => {
  const disc = play('BanterDiscussion.tsx');
  const wall = play('BanterWall.tsx');
  assert.equal((disc.match(/<MentionTextarea/g) || []).length, 2);
  assert.ok(wall.includes('<MentionTextarea') && wall.includes('leagueId={leagueId}'));
  assert.ok(!/<textarea/.test(disc) && !/<textarea/.test(wall));
  const m = play('BanterMentions.tsx');
  assert.ok(!m.includes('dangerouslySetInnerHTML') && !/<a /.test(m));
  assert.ok(disc.includes("notifyPush('topic'") && disc.includes('📌'));
});

console.log(`banter-mentions-pins: ${passed} passed`);
