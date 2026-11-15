// Banter Hub: thread-wide notifications, @ suggestions from the current thread, and follows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { followErrorMessage, notificationLine, opensMemberCard } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-follows-notify');
const sql = readFileSync('../../supabase/migrations/20261115000012_banter_follows_notify.sql', 'utf8');
const play = (f: string) => readFileSync(`../../web/src/features/play/${f}`, 'utf8');
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};
const MEMBER_RPCS = [
  'banter_create_topic(text, text)',
  'banter_post_reply(uuid, text, uuid, boolean)',
  'banter_post(text, uuid, uuid)',
  'banter_search_handles(text, uuid, uuid)',
  'banter_follow(text, boolean)',
  'banter_member(text)',
  'banter_my_follows()',
  'banter_push_settings()',
  'banter_set_push_settings(boolean, boolean, boolean, boolean, boolean)',
  'banter_my_notifications(integer)',
  'banter_unread_count()',
];
const INTERNAL = [
  'banter_fanout_reply(uuid, uuid, uuid)',
  'banter_fanout_post(uuid, uuid, uuid)',
  'banter_fanout_topic(uuid, uuid)',
  'banter_fanout_pick()',
  'banter_push_targets(uuid, text, uuid)',
];

test('follows table: RLS on, no direct access, never yourself', () => {
  assert.ok(sql.includes('alter table public.banter_follows enable row level security;'));
  assert.ok(sql.includes('revoke all on table public.banter_follows from anon, authenticated;'));
  assert.ok(sql.includes('check (follower_id <> followee_id)'));
  assert.ok(!/create policy/i.test(sql));
});

test('RPCs: definer, pinned search_path, closed to public/anon; helpers internal', () => {
  for (const sig of MEMBER_RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
  }
  for (const sig of INTERNAL) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`), sig);
    assert.ok(!sql.includes(`grant execute on function public.${sig} to authenticated`), sig);
  }
  for (const d of sql.split('create or replace function').slice(1)) {
    assert.ok(d.includes('security definer') && d.includes("set search_path = ''"));
  }
  for (const fn of ['banter_follow', 'banter_member', 'banter_my_follows', 'banter_search_handles']) {
    assert.ok(fnBody(fn).includes('public.has_banter_access()'), fn);
  }
});

test('thread: starter + repliers (topic) or every member (league), once per message, never the sender', () => {
  const r = fnBody('banter_fanout_reply');
  assert.ok(r.includes('from public.banter_topics t where t.id = p_topic_id') && r.includes('r.topic_id = p_topic_id'));
  assert.ok((r.match(/not exists \(select 1 from public\.banter_notifications n where n\.reply_id = p_reply_id and n\.user_id/g) || []).length === 2);
  assert.ok(r.includes('u.uid <> p_author') && r.includes("'thread_message'") && r.includes("'follow_post'"));
  const p = fnBody('banter_fanout_post');
  assert.ok(p.includes('m.league_id = p_league_id') && p.includes('m.user_id <> p_author'));
  assert.ok(p.includes('n.post_id = p_post_id and n.user_id = m.user_id'));
  // Specific notifications first, then the fan-out.
  const reply = fnBody('banter_post_reply');
  assert.ok(reply.indexOf('banter_apply_mentions') < reply.indexOf('banter_fanout_reply'));
  const post = fnBody('banter_post');
  assert.ok(post.indexOf('banter_apply_mentions') < post.indexOf('banter_fanout_post'));
  assert.ok(fnBody('banter_create_topic').includes('banter_fanout_topic(v_id, v_uid)'));
});

test('follows: picks (collapsed), topics and Discussion posts; league posts only reach league members', () => {
  const pick = fnBody('banter_fanout_pick');
  assert.ok(pick.includes("interval '6 hours'") && pick.includes('item_count = n.item_count + 1'));
  assert.ok(sql.includes('after insert on public.football_user_picks'));
  assert.ok(!fnBody('banter_fanout_post').includes('banter_follows'), 'no follower fan-out on league chats');
  const f = fnBody('banter_follow');
  assert.ok(f.includes("raise exception 'member_not_found'") && f.includes('v_target = v_uid'));
  assert.ok(f.includes('>= 500') && f.includes("interval '1 hour'") && f.includes("interval '1 day'"));
  assert.ok(f.includes("'notification_id', v_note"));
});

test('@ suggestions: people in this topic first, and only them before a letter is typed', () => {
  const b = fnBody('banter_search_handles');
  assert.ok(b.includes('p_topic_id uuid default null'));
  assert.ok(b.includes("v_prefix <> '' or p_league_id is not null or exists (select 1 from thread th"));
  assert.ok(b.includes('order by exists (select 1 from thread th where th.uid = pp.user_id) desc'));
  assert.ok(b.includes('limit 8') && b.includes('not pp.leaderboard_banned') && b.includes('pp.user_id <> v_uid'));
});

test('notifications list, badge and push cover the new kinds, with settings', () => {
  for (const k of ['thread_message', 'follow_pick', 'follow_topic', 'follow_post', 'follower']) {
    assert.ok(sql.includes(`'${k}'`), k);
  }
  assert.ok(fnBody('banter_unread_count').includes("n.kind in ('follow_pick', 'follower')"));
  const push = fnBody('banter_push_targets');
  assert.ok(push.includes("when 'thread_message' then coalesce(st.thread_messages, true)"));
  assert.ok(push.includes("when 'follow_post' then coalesce(st.follows, true)"));
  assert.ok(push.includes('n.item_count = 1'), 'only the first pick of a run pushes');
  assert.ok(push.includes('banter_league_mutes'));
  assert.ok(fnBody('banter_set_push_settings').includes('coalesce(p_thread_messages, public.banter_push_settings.thread_messages)'));
  assert.ok(readFileSync('../../api/banter-push.ts', 'utf8').includes("'pick', 'follow'"));
});

test('website: tappable names, member card with follow, Profile follows, topic-aware @, pick push', () => {
  assert.ok(play('BanterWall.tsx').includes('<MemberName handle={p.handle}'));
  assert.ok(play('BanterDiscussion.tsx').includes('<MemberName handle={r.handle}') && play('BanterDiscussion.tsx').includes('topicId={topicId}'));
  assert.ok(play('PlayHub.tsx').includes('<MemberSheetHost'));
  assert.ok(play('BanterProfile.tsx').includes('<FollowsCard'));
  const m = play('BanterMembers.tsx');
  assert.ok(m.includes("notifyPush('follow'") && !m.includes('dangerouslySetInnerHTML'));
  assert.ok(play('BanterToday.tsx').includes("notifyPush('pick'"));
  assert.ok(play('banterApi.ts').includes('p_topic_id: topicId') && play('banterApi.ts').includes("r.code === 'not_ready'"));
});

test('wording', () => {
  assert.equal(notificationLine('thread_message', 'Ada'), 'Ada sent a new message');
  assert.equal(notificationLine('follow_pick', 'Ada', null, 3), 'Ada made 3 picks');
  assert.equal(notificationLine('follow_pick', 'Ada'), 'Ada made a pick');
  assert.equal(notificationLine('follower', 'Ada'), 'Ada started following you');
  assert.equal(notificationLine('follow_topic', 'Ada'), 'Ada started a topic');
  assert.ok(opensMemberCard('follower') && opensMemberCard('follow_pick') && !opensMemberCard('reply'));
  assert.match(followErrorMessage('not_ready'), /switched on/);
});

console.log(`banter-follows-notify: ${passed} passed`);
