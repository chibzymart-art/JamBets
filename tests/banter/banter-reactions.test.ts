// Banter Hub reactions: five reactions, one per member, toggle/change, writer notified once per
// reaction (updated on change, gone on removal), counts and own reaction in every read, push hook.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REACTIONS, applyReaction, notificationHref, notificationLine, reactionEmoji } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-reactions');
const sql = readFileSync('../../supabase/migrations/20261115000008_banter_reactions.sql', 'utf8');
const play = (f: string) => readFileSync(`../../web/src/features/play/${f}`, 'utf8');
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};
const MEMBER_RPCS = [
  'banter_react(text, uuid, text)',
  'banter_wall(uuid, timestamptz, integer)',
  'banter_topic(uuid)',
  'banter_my_notifications(integer)',
  'banter_unread_count()',
];

test('table: RLS on, no direct access, exactly five reactions, one per member per message', () => {
  assert.ok(sql.includes('alter table public.banter_reactions enable row level security;'));
  assert.ok(sql.includes('revoke all on table public.banter_reactions from anon, authenticated;'));
  assert.ok(sql.includes("check (reaction in ('up', 'down', 'angry', 'laugh', 'cry'))"));
  assert.ok(sql.includes('unique (user_id, target_kind, target_id)'));
  assert.ok(!/create policy/i.test(sql));
});

test('RPCs: definer, pinned search_path, paid-only, closed to public/anon; helpers internal', () => {
  for (const sig of MEMBER_RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
    const b = fnBody(sig.split('(')[0]);
    assert.ok(b.includes('security definer') && b.includes("set search_path = ''") && b.includes('public.has_banter_access()'), sig);
  }
  assert.ok(sql.includes('revoke execute on function public.banter_reaction_summary(text, uuid, uuid) from public, anon, authenticated;'));
  assert.ok(sql.includes('revoke execute on function public.banter_push_targets(uuid, text, uuid) from public, anon, authenticated;'));
  assert.ok(!sql.includes('grant execute on function public.banter_reaction_summary'));
});

test('react: same again removes, another changes, writer notified (never yourself), league members only', () => {
  const b = fnBody('banter_react');
  assert.ok(b.includes("v_existing.reaction = p_reaction") && b.includes("v_state := 'removed'"));
  assert.ok(b.includes("v_state := 'changed'") && b.includes("v_state := 'added'"));
  assert.ok(b.includes('v_author <> v_uid'));
  assert.ok(b.includes("on conflict (reaction_id) where kind = 'reaction'") && b.includes('read_at = null'));
  assert.ok(b.includes("raise exception 'not_member'") && b.includes("raise exception 'banned'"));
  assert.ok(b.includes('deleted_at is null') && b.includes('leaderboard_banned'));
  assert.ok(sql.includes('reaction_id uuid references public.banter_reactions(id) on delete cascade'), 'removing deletes its notification');
});

test('reads carry counts (banned not counted) and the caller own reaction', () => {
  const s = fnBody('banter_reaction_summary');
  assert.ok(s.includes('not pp.leaderboard_banned') && s.includes("'mine'"));
  assert.ok(fnBody('banter_wall').includes("banter_reaction_summary('post', p.id, v_uid)"));
  const t = fnBody('banter_topic');
  assert.ok(t.includes("banter_reaction_summary('topic', p_topic_id, v_uid)") && t.includes("banter_reaction_summary('reply', r.id, v_uid)"));
});

test('notifications list and badge include reactions, only while the message is live (and league membership)', () => {
  for (const fn of ['banter_my_notifications', 'banter_unread_count']) {
    const b = fnBody(fn);
    assert.ok(b.includes("n.kind = 'reaction'"), fn);
    assert.ok(b.includes('n.user_id = v_uid'), fn);
  }
  assert.ok(sql.includes("kind in ('reply', 'topic_reply', 'league_reply', 'reaction')"));
});

test('push: the writer, once per reaction, honouring settings and mutes', () => {
  const b = fnBody('banter_push_targets');
  assert.ok(b.includes("p_kind not in ('reply', 'post', 'join', 'reaction')"));
  assert.ok(b.includes('x.user_id = p_sender') && b.includes('x.uid <> p_sender'));
  assert.ok(b.includes('reacted ') && b.includes('banter_league_mutes'));
  assert.ok(readFileSync('../../api/banter-push.ts', 'utf8').includes("'reaction'"));
});

test('local tap logic: add, change, remove', () => {
  assert.deepEqual(applyReaction({ counts: {}, mine: null }, 'laugh'), { counts: { laugh: 1 }, mine: 'laugh' });
  assert.deepEqual(applyReaction({ counts: { laugh: 2 }, mine: 'laugh' }, 'cry'), { counts: { laugh: 1, cry: 1 }, mine: 'cry' });
  assert.deepEqual(applyReaction({ counts: { cry: 1 }, mine: 'cry' }, 'cry'), { counts: {}, mine: null });
  assert.deepEqual(REACTIONS.map((r) => r.emoji), ['👍', '👎', '😡', '😂', '😢']);
  assert.equal(reactionEmoji('laugh'), '😂');
});

test('wording and links', () => {
  assert.equal(notificationLine('reaction', 'Ada', 'laugh'), 'Ada reacted 😂 to your message');
  assert.equal(notificationHref({ kind: 'reaction', topic_id: 'T', reply_id: null }), '/play/discussion?topic=T');
  assert.equal(notificationHref({ kind: 'reaction', league_id: 'L', post_id: 'P' }), '/play/leagues?league=L&post=P');
});

test('reactions on the opening post, every reply and every league wall message; live counts', () => {
  const disc = play('BanterDiscussion.tsx');
  const wall = play('BanterWall.tsx');
  assert.ok(disc.includes('kind="topic"') && disc.includes('kind="reply"'));
  assert.ok(wall.includes('kind="post"'));
  assert.ok(disc.includes('JSON.stringify(x.reactions') && wall.includes('JSON.stringify(p.reactions'));
  const ui = play('BanterReactions.tsx');
  assert.ok(ui.includes('if (counts === undefined) return null;'), 'hidden before the database change');
  assert.ok(ui.includes("notifyPush('reaction'") && ui.includes('sendPing('));
});

console.log(`banter-reactions: ${passed} passed`);
