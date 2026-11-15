// Banter Hub: share your own football pick into a topic or league chat as a live card.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PICK_STATUS_TEXT, shareErrorMessage } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-share-pick');
const sql = readFileSync('../../supabase/migrations/20261115000010_banter_share_pick.sql', 'utf8');
const play = (f: string) => readFileSync(`../../web/src/features/play/${f}`, 'utf8');
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};

test('stores a reference to the pick, never a copy', () => {
  assert.ok(sql.includes('add column if not exists shared_pick_id uuid references public.football_user_picks(id) on delete set null'));
  assert.ok(!/create table/i.test(sql));
  assert.ok(!/insert into public\.banter_(posts|replies)/.test(sql), 'messages are created by the existing post functions');
});

test('only your own pick, exactly one destination, normal posting rules', () => {
  const b = fnBody('banter_share_pick');
  assert.ok(b.includes('public.has_banter_access()'));
  assert.ok(b.includes('k.id = p_pick_id and k.user_id = v_uid') && b.includes("raise exception 'pick_not_found'"));
  assert.ok(b.includes('(p_topic_id is null) = (p_league_id is null)') && b.includes("'destination_invalid'"));
  assert.ok(b.includes('public.banter_post_reply(p_topic_id, v_body, null, false)'));
  assert.ok(b.includes('public.banter_post(v_body, p_league_id, null)'));
  assert.ok(b.includes('where id = v_id and user_id = v_uid'));
});

test('cards are read live, only through the wall and topic functions', () => {
  const card = fnBody('banter_pick_card');
  for (const f of ["'status', k.status", "'home_team', hmt.name", "'kickoff_at', k.kickoff_at", "'selection', k.selection"]) {
    assert.ok(card.includes(f), f);
  }
  assert.ok(sql.includes('revoke execute on function public.banter_pick_card(uuid) from public, anon, authenticated;'));
  assert.ok(!sql.includes('grant execute on function public.banter_pick_card'));
  assert.ok(fnBody('banter_wall').includes('public.banter_pick_card(p.shared_pick_id)'));
  assert.ok(fnBody('banter_topic').includes('public.banter_pick_card(r.shared_pick_id)'));
});

test('recreated reads keep every earlier rule', () => {
  const w = fnBody('banter_wall');
  assert.ok(w.includes('m.league_id = p_league_id and m.user_id = v_uid') && w.includes('not pp.leaderboard_banned'));
  assert.ok(w.includes("banter_reaction_summary('post', p.id, v_uid)") && w.includes('tagged_is_me'));
  const t = fnBody('banter_topic');
  assert.ok(t.includes("banter_reaction_summary('reply', r.id, v_uid)") && t.includes('r.reply_to_topic'));
  for (const sig of ['banter_share_pick(uuid, uuid, uuid, text)', 'banter_wall(uuid, timestamptz, integer)', 'banter_topic(uuid)']) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
  }
  for (const d of sql.split('create or replace function').slice(1)) {
    assert.ok(d.includes('security definer') && d.includes("set search_path = ''"));
  }
});

test('website: Share from My Picks and right after picking; cards in topics and league walls; live colour', () => {
  assert.ok(play('BanterMyPicks.tsx').includes('<SharePickPanel'));
  assert.ok(play('BanterToday.tsx').includes('📣 Share it'));
  assert.ok(play('BanterDiscussion.tsx').includes('<PickCard pick={r.pick}'));
  assert.ok(play('BanterWall.tsx').includes('<PickCard pick={p.pick}'));
  assert.ok(play('BanterDiscussion.tsx').includes('x.pick?.status') && play('BanterWall.tsx').includes('p.pick?.status'));
  const ui = play('BanterSharePick.tsx');
  assert.ok(ui.includes("notifyPush('reply'") && ui.includes("notifyPush('post'") && ui.includes('sendPing('));
  assert.ok(!/\.from\(['"`]/.test(ui), 'no direct table reads');
});

test('labels and messages', () => {
  assert.equal(PICK_STATUS_TEXT.won, '✓ Won');
  assert.match(shareErrorMessage('pick_not_found'), /own picks/);
  assert.match(shareErrorMessage('not_ready'), /switched on/);
  assert.ok(shareErrorMessage('too_fast').length > 5);
});

console.log(`banter-share-pick: ${passed} passed`);
