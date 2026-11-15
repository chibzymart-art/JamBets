// Banter Hub public / private leagues: SQL safety rules and the website wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leagueErrorMessage } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-public-leagues');
const sql = readFileSync('../../supabase/migrations/20261115000004_banter_public_leagues.sql', 'utf8');
const api = readFileSync('../../web/src/features/play/banterApi.ts', 'utf8');
const ui = readFileSync('../../web/src/features/play/BanterLeagues.tsx', 'utf8');
const RPCS = [
  'banter_create_league(text, boolean)',
  'banter_my_leagues()',
  'banter_set_league_public(uuid, boolean)',
  'banter_public_leagues(text, integer, integer, text)',
  'banter_join_public_league(uuid)',
];
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', start));
};

test('existing leagues stay private: the new column defaults to false', () => {
  assert.ok(sql.includes('add column if not exists is_public boolean not null default false'));
  assert.ok(!/update public\.banter_leagues set is_public = true/i.test(sql));
});

test('every RPC is definer with pinned search_path, checks access, and is closed to public/anon', () => {
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

test('create keeps working for the old one-argument call (private by default)', () => {
  assert.ok(sql.includes('drop function if exists public.banter_create_league(text);'));
  assert.ok(sql.includes('banter_create_league(p_name text, p_is_public boolean default false)'));
});

test('the public list never exposes invite codes and only lists public leagues', () => {
  const body = fnBody('banter_public_leagues');
  assert.ok(!body.includes('invite_code'));
  assert.ok(body.includes('where l.is_public'));
  assert.ok(/least\(greatest\(coalesce\(p_limit, 30\), 1\), 100\)/.test(body), 'limit is capped');
});

test('joining from the list refuses private leagues and keeps the caps', () => {
  const body = fnBody('banter_join_public_league');
  assert.ok(body.includes('and is_public'));
  assert.ok(body.includes('>= 20'));
  assert.ok(body.includes('>= 200'));
  assert.ok(body.includes('public.player_profiles'));
});

test('only the creator can switch public / private', () => {
  const body = fnBody('banter_set_league_public');
  assert.ok(body.includes("raise exception 'not_owner'"));
});

test('website: create sends the choice, falls back before the database change, and shows the new pieces', () => {
  assert.ok(api.includes('p_is_public: isPublic'));
  assert.ok(api.includes("r.code === 'not_ready' && !isPublic"));
  assert.ok(api.includes("'banter_public_leagues'"));
  assert.ok(api.includes("'banter_join_public_league'"));
  assert.ok(api.includes("'banter_set_league_public'"));
  assert.ok(ui.includes('🔒 Private') && ui.includes('🌍 Public'));
  assert.ok(ui.includes('Public leagues'));
  assert.ok(ui.includes('league.is_owner && ('), 'toggle is creator-only');
  assert.ok(!/PublicLeague[^\n]*invite_code/.test(ui));
});

test('friendly messages for the new error codes', () => {
  assert.match(leagueErrorMessage('public_not_ready'), /Public leagues/);
  assert.match(leagueErrorMessage('not_owner'), /created this league/);
});

console.log(`  ${passed} passed`);
