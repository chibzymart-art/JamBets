// Banter Hub Discussion: SQL safety rules (access, rate limits, bans, soft delete, notifications,
// no direct access, wall copy) and the website wiring (tab, helpers, plain-text rendering).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPLY_MAX,
  TOPIC_BODY_MAX,
  TOPIC_TITLE_MAX,
  charsLeft,
  cleanTitle,
  discussionErrorMessage,
  notificationLine,
  snippet,
  topicTitleValid,
} from '../../web/src/features/play/banterRules';
import { PLAY_TABS, playTabFromPath } from '../../web/src/features/play/playTabs';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-discussion');
const sql = readFileSync('../../supabase/migrations/20261115000005_banter_discussion.sql', 'utf8');
const ui = readFileSync('../../web/src/features/play/BanterDiscussion.tsx', 'utf8');
const hub = readFileSync('../../web/src/features/play/PlayHub.tsx', 'utf8');
const leagues = readFileSync('../../web/src/features/play/BanterLeagues.tsx', 'utf8');
const RPCS = [
  'banter_create_topic(text, text)',
  'banter_topics(text, integer, integer)',
  'banter_topic(uuid)',
  'banter_post_reply(uuid, text, uuid)',
  'banter_delete_topic(uuid)',
  'banter_delete_reply(uuid)',
  'banter_my_notifications(integer)',
  'banter_unread_count()',
  'banter_mark_notifications_read(uuid[])',
];
const TABLES = ['banter_topics', 'banter_replies', 'banter_notifications'];
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', start));
};

test('tables have RLS on and no direct access for anon or signed-in users', () => {
  for (const t of TABLES) {
    assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
    assert.ok(sql.includes(`revoke all on table public.${t} from anon, authenticated;`), t);
  }
  assert.ok(!/grant [a-z, ]+ on table public\.banter_\w+ to (anon|authenticated)/.test(sql));
  assert.ok(!/create policy/i.test(sql));
});

test('every RPC is definer, pinned search_path, access-checked, closed to public/anon', () => {
  for (const sig of RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
  }
  const defs = sql.split('create or replace function').slice(1);
  assert.equal(defs.length, RPCS.length + 1); // + the internal guard
  for (const d of defs) {
    assert.ok(d.includes('security definer'), 'definer');
    assert.ok(d.includes("set search_path = ''"), 'search_path');
    assert.ok(d.includes('public.has_banter_access()'), 'access check');
  }
  assert.ok(sql.includes('revoke execute on function public.banter_discussion_guard() from public, anon, authenticated;'));
  assert.ok(!sql.includes('grant execute on function public.banter_discussion_guard'));
});

test('posting rules: username, banned, lengths, 10 seconds and 60 a day across topics and replies', () => {
  const g = fnBody('banter_discussion_guard');
  assert.ok(g.includes('public.player_profiles') && g.includes("raise exception 'no_profile'"));
  assert.ok(g.includes("raise exception 'banned'"));
  assert.ok(g.includes("interval '10 seconds'") && g.includes('public.banter_replies r') && g.includes('public.banter_topics t'));
  assert.ok(g.includes('>= 60'));
  assert.ok(fnBody('banter_create_topic').includes('public.banter_discussion_guard()'));
  assert.ok(fnBody('banter_post_reply').includes('public.banter_discussion_guard()'));
  assert.ok(sql.includes('between 3 and 120') && sql.includes('between 1 and 1000') && sql.includes('between 1 and 500'));
});

test('replies: reply-to must be in the same topic; tag + notify, never yourself', () => {
  const b = fnBody('banter_post_reply');
  assert.ok(b.includes('r.topic_id = p_topic_id'));
  assert.ok(b.includes("'reply', p_topic_id"));
  assert.ok(b.includes("'topic_reply', p_topic_id"));
  assert.ok(b.includes('v_target <> v_uid'));
  assert.ok(b.includes('v_topic_author <> v_uid and v_topic_author is distinct from v_target'));
  assert.ok(sql.includes('banter_notifications_not_self check (from_user_id is null or from_user_id <> user_id)'));
});

test('banned members and deleted content are hidden everywhere they are read', () => {
  for (const fn of ['banter_topics', 'banter_topic', 'banter_my_notifications', 'banter_unread_count']) {
    const b = fnBody(fn);
    assert.ok(b.includes('leaderboard_banned'), `${fn} hides banned`);
    assert.ok(b.includes('deleted_at is null'), `${fn} hides deleted`);
  }
});

test('notifications are read and marked only for yourself', () => {
  assert.ok(fnBody('banter_my_notifications').includes('n.user_id = v_uid'));
  assert.ok(fnBody('banter_unread_count').includes('n.user_id = v_uid'));
  assert.ok(fnBody('banter_mark_notifications_read').includes('n.user_id = v_uid'));
});

test('delete is soft, by the author or an admin', () => {
  for (const fn of ['banter_delete_topic', 'banter_delete_reply']) {
    const b = fnBody(fn);
    assert.ok(b.includes('public.is_admin()') && b.includes("raise exception 'not_allowed'"), fn);
    assert.ok(b.includes('set deleted_at = now()'), fn);
    assert.ok(!/delete from/i.test(b), fn);
  }
});

test('public wall posts are copied once as topics; league walls are untouched', () => {
  assert.ok(sql.includes('where p.league_id is null'));
  assert.ok(sql.includes('and p.deleted_at is null'));
  assert.ok(sql.includes('on conflict (migrated_from_post_id) do nothing'));
  assert.ok(sql.includes('left(t.flat, 60)'));
  assert.ok(!/(drop|alter|delete from|update)\s+(table\s+)?public\.banter_posts/i.test(sql));
  assert.ok(leagues.includes('<BanterWall leagueId={league.league_id}'));
});

test('Discussion tab at /play/discussion; /play/wall still works; unread badge', () => {
  assert.ok(PLAY_TABS.some((t) => t.id === 'discussion' && t.path === '/play/discussion' && t.label === 'Discussion'));
  assert.equal(playTabFromPath('/play/discussion'), 'discussion');
  assert.equal(playTabFromPath('/play/wall/'), 'discussion');
  assert.ok(hub.includes('<BanterDiscussion'));
  assert.ok(hub.includes('play-tab-badge'));
  assert.ok(!hub.includes('<BanterWall'));
});

test('helpers: counters, titles, snippets, notification lines', () => {
  assert.equal(charsLeft('  hi  ', REPLY_MAX), REPLY_MAX - 2);
  assert.equal(charsLeft('🔥', TOPIC_BODY_MAX), TOPIC_BODY_MAX - 1);
  assert.equal(cleanTitle('  Who   wins\n it? '), 'Who wins it?');
  assert.ok(!topicTitleValid('ab'));
  assert.ok(topicTitleValid('abc'));
  assert.ok(!topicTitleValid('x'.repeat(TOPIC_TITLE_MAX + 1)));
  assert.equal(snippet('a'.repeat(100), 10).length, 10);
  assert.equal(snippet('short'), 'short');
  assert.equal(notificationLine('reply', 'Ada'), 'Ada replied to you');
  assert.equal(notificationLine('topic_reply', 'Ada'), 'Ada replied in your topic');
});

test('every Discussion error has a message, including not switched on yet', () => {
  for (const c of ['title_invalid', 'body_invalid', 'too_fast', 'daily_limit', 'banned', 'topic_not_found',
    'reply_not_found', 'not_allowed', 'no_profile', 'no_access', 'not_ready', 'not_signed_in', 'other']) {
    assert.ok(discussionErrorMessage(c).length > 5, c);
  }
  assert.match(discussionErrorMessage('not_ready'), /switched on/);
});

test('messages render as plain text (no innerHTML, no linkify)', () => {
  assert.ok(!ui.includes('dangerouslySetInnerHTML'));
  assert.ok(!/linkify|autolink|<a /i.test(ui));
  assert.ok(ui.includes('{r.body}') && ui.includes('{data.topic.body}'));
});

console.log(`banter-discussion: ${passed} passed`);
