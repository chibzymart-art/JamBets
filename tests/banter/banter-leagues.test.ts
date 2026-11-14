// Banter Hub private leagues: SQL safety rules and the invite / share helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INVITE_CODE_PATTERN,
  LEAGUE_NAME_MAX,
  LEAGUE_NAME_MIN,
  MAX_LEAGUES_PER_MEMBER,
  MAX_MEMBERS_PER_LEAGUE,
  inviteLink,
  leagueErrorMessage,
  normaliseInvite,
  telegramShareUrl,
  whatsappShareUrl,
} from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-leagues');
const sql = readFileSync('../../supabase/migrations/20261115000001_banter_leagues.sql', 'utf8');
const RPCS = [
  'banter_create_league(text)',
  'banter_join_league(text)',
  'banter_leave_league(uuid)',
  'banter_my_leagues()',
  'banter_league_table(uuid, text)',
];

test('tables have RLS on and no direct access for anon or signed-in users', () => {
  assert.ok(sql.includes('alter table public.banter_leagues enable row level security;'));
  assert.ok(sql.includes('alter table public.banter_league_members enable row level security;'));
  assert.ok(sql.includes('revoke all on table public.banter_leagues from anon, authenticated;'));
  assert.ok(sql.includes('revoke all on table public.banter_league_members from anon, authenticated;'));
  assert.ok(!/grant [a-z, ]+ on table public\.banter_league(s|_members) to authenticated/.test(sql));
  assert.ok(!/create policy/i.test(sql));
});

test('every RPC is definer with pinned search_path, checks access, and is closed to public/anon', () => {
  for (const sig of RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
  }
  const defs = sql.split('create or replace function').slice(1);
  assert.equal(defs.length, RPCS.length);
  for (const d of defs) {
    assert.ok(d.includes('security definer'), 'definer');
    assert.ok(d.includes("set search_path = ''"), 'search_path');
    assert.ok(d.includes('public.has_banter_access()'), 'access check');
  }
});

test('create and join need a username; caps match the website', () => {
  for (const fn of ['banter_create_league', 'banter_join_league']) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}`));
    assert.ok(body.slice(0, 1500).includes('public.player_profiles'), `${fn} checks the profile`);
  }
  assert.ok(sql.includes(`>= ${MAX_LEAGUES_PER_MEMBER} then`));
  assert.ok(sql.includes(`>= ${MAX_MEMBERS_PER_LEAGUE} then`));
  assert.ok(sql.includes(`between ${LEAGUE_NAME_MIN} and ${LEAGUE_NAME_MAX}`));
  assert.ok(sql.includes("'^[A-Z0-9]{8}$'"));
});

test('league table is for members only and uses the leaderboard columns', () => {
  const body = sql.slice(sql.indexOf('create or replace function public.banter_league_table'));
  assert.ok(body.includes('where league_id = p_league_id and user_id = v_uid'));
  for (const col of ['place integer', 'handle text', 'points numeric', 'won integer', 'lost integer', 'voided integer', 'settled integer', 'hit_rate numeric', 'is_me boolean']) {
    assert.ok(body.includes(col), col);
  }
  assert.ok(body.includes('not pp.leaderboard_banned'));
});

test('owner leaving deletes the league; others just leave', () => {
  const body = sql.slice(sql.indexOf('create or replace function public.banter_leave_league'), sql.indexOf('create or replace function public.banter_my_leagues'));
  assert.ok(body.includes("return 'deleted'"));
  assert.ok(body.includes("return 'left'"));
});

test('invite link and code cleaning', () => {
  assert.equal(inviteLink('7F3A9C2B'), 'https://www.oddsbanta.com/play/leagues?join=7F3A9C2B');
  assert.equal(normaliseInvite(' 7f3a9c2b '), '7F3A9C2B');
  assert.equal(normaliseInvite('https://www.oddsbanta.com/play/leagues?join=7f3a9c2b'), '7F3A9C2B');
  assert.equal(normaliseInvite('7F3A-9C2B'), '7F3A9C2B');
  assert.ok(INVITE_CODE_PATTERN.test(normaliseInvite('7f3a9c2b')));
});

test('share links carry the invite link', () => {
  const wa = whatsappShareUrl('Office Gaffers', '7F3A9C2B');
  assert.ok(wa.startsWith('https://wa.me/?text='));
  assert.ok(decodeURIComponent(wa).includes('https://www.oddsbanta.com/play/leagues?join=7F3A9C2B'));
  const tg = telegramShareUrl('Office Gaffers', '7F3A9C2B');
  assert.ok(tg.startsWith('https://t.me/share/url?url='));
  assert.ok(decodeURIComponent(tg).includes('join=7F3A9C2B'));
});

test('every league error has a readable message, including not applied yet', () => {
  for (const c of ['name_invalid', 'too_many_leagues', 'league_not_found', 'league_full', 'not_member', 'no_profile', 'no_access', 'not_ready', 'not_signed_in', 'weird']) {
    assert.ok(leagueErrorMessage(c).length > 5, c);
  }
  assert.match(leagueErrorMessage('not_ready'), /switched on/);
});

console.log(`banter-leagues: ${passed} passed`);
