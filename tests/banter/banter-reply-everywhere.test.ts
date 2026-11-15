// Banter Hub: reply to any message, in Discussion and league walls, with tag + in-app notification.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notificationHref, notificationLine } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-reply-everywhere');
const sql = readFileSync('../../supabase/migrations/20261115000006_banter_reply_everywhere.sql', 'utf8');
const api = readFileSync('../../web/src/features/play/banterApi.ts', 'utf8');
const wall = readFileSync('../../web/src/features/play/BanterWall.tsx', 'utf8');
const disc = readFileSync('../../web/src/features/play/BanterDiscussion.tsx', 'utf8');
const leagues = readFileSync('../../web/src/features/play/BanterLeagues.tsx', 'utf8');
const RPCS = [
  'banter_post(text, uuid, uuid)',
  'banter_wall(uuid, timestamptz, integer)',
  'banter_post_reply(uuid, text, uuid, boolean)',
  'banter_topic(uuid)',
  'banter_my_notifications(integer)',
  'banter_unread_count()',
];
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};

test('every recreated RPC is definer, pinned search_path, access-checked, closed to public/anon', () => {
  for (const sig of RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
  }
  const defs = sql.split('create or replace function').slice(1);
  assert.equal(defs.length, RPCS.length);
  for (const d of defs) {
    assert.ok(d.includes('security definer'), 'definer');
    assert.ok(d.includes("set search_path = ''"), 'search_path');
    assert.ok(d.includes('public.has_banter_access()'), 'access check');
  }
  assert.ok(!/create policy/i.test(sql));
  assert.ok(!/grant [a-z, ]+ on table/i.test(sql));
});

test('old signatures are replaced, and every new parameter has a default (old calls keep working)', () => {
  assert.ok(sql.includes('drop function if exists public.banter_post(text, uuid);'));
  assert.ok(sql.includes('drop function if exists public.banter_post_reply(uuid, text, uuid);'));
  assert.ok(sql.includes('p_reply_to uuid default null'));
  assert.ok(sql.includes('p_reply_to_topic boolean default false'));
});

test('league wall replies: same league, live post, tag + notify the author, never yourself', () => {
  const b = fnBody('banter_post');
  assert.ok(b.includes('p.league_id is not distinct from p_league_id'));
  assert.ok(b.includes('p.deleted_at is null'));
  assert.ok(b.includes("raise exception 'post_not_found'"));
  assert.ok(b.includes('if v_target <> v_uid then v_tag := v_target; end if;'));
  assert.ok(b.includes("'league_reply'"));
  assert.ok(b.includes('m.user_id = v_tag'), 'only while the tagged member is in the league');
  for (const rule of ["'not_member'", "'banned'", "'no_profile'", "interval '10 seconds'", '>= 60']) {
    assert.ok(b.includes(rule), rule);
  }
});

test('wall returns the quote and tag, hiding removed / banned quotes', () => {
  const b = fnBody('banter_wall');
  assert.ok(b.includes('tagged_handle text') && b.includes('tagged_is_me boolean') && b.includes('reply_to jsonb'));
  assert.ok(b.includes("'removed', true") && b.includes('qp.leaderboard_banned'));
  assert.ok(b.includes('m.league_id = p_league_id and m.user_id = v_uid'));
});

test('Discussion: Reply on the opening post tags the topic author', () => {
  const b = fnBody('banter_post_reply');
  assert.ok(b.includes('v_target := v_topic_author'));
  assert.ok(b.includes("'reply', p_topic_id"));
  assert.ok(b.includes('v_topic_author is distinct from v_target'), 'author not notified twice');
  assert.ok(fnBody('banter_topic').includes("'topic', true"));
});

test('notifications: exactly one target; league replies only while still in the league', () => {
  assert.ok(sql.includes("check (kind in ('reply', 'topic_reply', 'league_reply'))"));
  assert.ok(sql.includes('banter_notifications_one_target'));
  for (const fn of ['banter_my_notifications', 'banter_unread_count']) {
    const b = fnBody(fn);
    assert.ok(b.includes('public.banter_league_members m on m.league_id = n.league_id and m.user_id = v_uid'), fn);
    assert.ok(b.includes('n.user_id = v_uid'), fn);
    assert.ok(b.includes('leaderboard_banned') && b.includes('deleted_at is null'), fn);
  }
});

test('website: Reply on every message, quote, tag line; falls back before the database change', () => {
  assert.ok(wall.includes('↩ Reply') && !/\{!p\.is_me && \(\s*<button[^>]*startReply/.test(wall));
  assert.ok(wall.includes('was tagged') && wall.includes('You were tagged'));
  assert.ok(wall.includes('postToWall(body, leagueId, replyTo ? replyTo.id : null)'));
  assert.ok(disc.includes('startReplyToTopic'));
  assert.ok(disc.includes('(opening post)'));
  assert.ok(!disc.includes('{!r.is_me && ('), 'Reply shows on every reply');
  assert.ok(api.includes("p_reply_to: replyTo }") && api.includes("r.code === 'not_ready'"));
  assert.ok(api.includes('p_reply_to_topic: true'));
  assert.ok(leagues.includes('<RepliesToYou') && leagues.includes("searchParams.get('post')"));
  assert.ok(disc.includes('<RepliesToYou'));
});

test('notifications open the right place', () => {
  const base = { id: 'n', topic_title: null, preview: '', from_handle: 'Ada', from_avatar: '⚽', created_at: '', is_read: false };
  assert.equal(
    notificationHref({ ...base, kind: 'league_reply', topic_id: null, reply_id: null, league_id: 'L1', post_id: 'P1' }),
    '/play/leagues?league=L1&post=P1',
  );
  assert.equal(
    notificationHref({ ...base, kind: 'reply', topic_id: 'T1', reply_id: 'R1' }),
    '/play/discussion?topic=T1&reply=R1',
  );
  assert.equal(notificationLine('league_reply', 'Ada'), 'Ada replied to you');
  assert.equal(notificationLine('topic_reply', 'Ada'), 'Ada replied in your topic');
});

test('messages stay plain text', () => {
  for (const src of [wall, disc]) {
    assert.ok(!src.includes('dangerouslySetInnerHTML'));
    assert.ok(!/linkify|autolink|<a /i.test(src));
  }
});

console.log(`banter-reply-everywhere: ${passed} passed`);
