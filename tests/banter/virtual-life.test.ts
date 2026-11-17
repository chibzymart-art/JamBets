// Virtual Life: SQL safety rules (coins can't be forged), pure helpers, and the website wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkinBonus,
  currentCity,
  defaultSlots,
  isOwned,
  nextStreak,
  toVlState,
  vlErrorMessage,
  type VlItem,
} from '../../web/src/features/virtual-life/vlifeRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('virtual-life');
const sql = readFileSync('../../supabase/migrations/20261117000001_virtual_life.sql', 'utf8');
const web = (f: string) => readFileSync(`../../web/src/features/virtual-life/${f}`, 'utf8');
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};
const TABLES = ['vl_catalog', 'vl_cities', 'vl_coin_ledger', 'vl_inventory', 'vl_avatars', 'vl_checkins', 'vl_trips'];
const MEMBER_RPCS = ['vl_get_state()', 'vl_my_balance()', 'vl_check_in()', 'vl_buy(text)', 'vl_set_avatar(text, text, text, text)', 'vl_travel(text)', 'vl_leaderboard(text, integer)'];
const INTERNAL = ['vl_require_member()', 'vl_balance_of(uuid)', 'vl_sync_earnings(uuid)', 'vl_spend(uuid, integer, text, text)'];

test('tables: RLS on, no grants to members, no policies', () => {
  for (const t of TABLES) assert.ok(sql.includes(`'${t}'`), t);
  assert.ok(sql.includes("execute format('alter table public.%I enable row level security', t)"));
  assert.ok(sql.includes("execute format('revoke all on table public.%I from public, anon, authenticated', t)"));
  assert.ok(!/create policy/i.test(sql));
  assert.ok(!/grant [a-z, ]+ on table public\.vl_\w+ to authenticated/i.test(sql));
});

test('ledger: append-only, earn/spend signs fixed, earning idempotent', () => {
  assert.ok(sql.includes('before update or delete on public.vl_coin_ledger'));
  assert.ok(fnBody('vl_ledger_append_only').includes("raise exception 'vl_ledger_append_only'"));
  assert.ok(sql.includes("(reason in ('pick_won', 'welcome', 'checkin') and amount > 0)"));
  assert.ok(sql.includes("(reason in ('shop', 'travel') and amount < 0)"));
  assert.ok(sql.includes('constraint vl_coin_ledger_once unique (user_id, reason, ref)'));
  const sync = fnBody('vl_sync_earnings');
  assert.ok(sync.includes("k.status = 'won'") && sync.includes('on conflict on constraint vl_coin_ledger_once do nothing'));
});

test('no transfers or money: no function moves coins between members, no client-supplied amounts', () => {
  assert.ok(!/transfer|gift|send_coins|cash/i.test(sql.replace(/--.*$/gm, '')));
  for (const sig of MEMBER_RPCS) assert.ok(!/amount/.test(sig), sig);
  assert.ok(!/update public\.football_user_picks|delete from public\.football_user_picks|update public\.player_profiles/.test(sql), 'read-only over Banter tables');
});

test('spend: per-member lock, balance checked in the same transaction', () => {
  const b = fnBody('vl_spend');
  assert.ok(b.includes('pg_advisory_xact_lock'));
  assert.ok(b.indexOf('pg_advisory_xact_lock') < b.indexOf('vl_balance_of'));
  assert.ok(b.includes("raise exception 'not_enough_coins'"));
  for (const f of ['vl_buy', 'vl_travel', 'vl_check_in']) assert.ok(fnBody(f).includes('pg_advisory_xact_lock'), f);
});

test('RPCs: definer + pinned search_path, paid-only; internals not callable by members', () => {
  for (const d of sql.split('create or replace function').slice(1)) {
    assert.ok(d.includes("set search_path = ''"));
  }
  for (const sig of MEMBER_RPCS) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon;`), sig);
    assert.ok(sql.includes(`grant execute on function public.${sig} to authenticated, service_role;`), sig);
    const name = sig.slice(0, sig.indexOf('('));
    const body = fnBody(name);
    assert.ok(body.includes('security definer'), sig);
    assert.ok(body.includes('public.has_banter_access()') || body.includes('public.vl_require_member()'), sig);
  }
  for (const sig of INTERNAL) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`), sig);
    assert.ok(!sql.includes(`grant execute on function public.${sig} to authenticated`), sig);
  }
  assert.ok(fnBody('vl_require_member').includes('public.has_banter_access()'));
});

test('catalogue: travel badges never for sale; leaderboard skips banned members', () => {
  assert.ok(sql.includes("'city', c.name || ' Traveller', c.flag, 0, false"));
  assert.ok(fnBody('vl_buy').includes("raise exception 'not_for_sale'"));
  assert.ok(fnBody('vl_leaderboard').includes('not pp.leaderboard_banned'));
  assert.ok(fnBody('vl_set_avatar').includes("raise exception 'item_not_owned'"));
});

test('check-in bonus: 5, +1 per day in a row, capped at 11 (matches SQL)', () => {
  assert.deepEqual([1, 2, 3, 7, 8, 30].map(checkinBonus), [5, 6, 7, 11, 11, 11]);
  assert.ok(fnBody('vl_check_in').includes('least(5 + (v_streak - 1), 11)'));
  assert.equal(nextStreak(3, false), 4);
  assert.equal(nextStreak(3, true), 3);
});

test('helpers: ownership, defaults, location, errors, state parsing fails closed', () => {
  const cat: VlItem[] = [
    { key: 'base_smile', kind: 'base', name: 'A', emoji: '🙂', price: 0, for_sale: true, colour1: null, colour2: null },
    { key: 'kit_classic', kind: 'kit', name: 'K', emoji: '👕', price: 0, for_sale: true, colour1: '#ffffff', colour2: '#000000' },
    { key: 'gear_cap', kind: 'gear', name: 'C', emoji: '🧢', price: 30, for_sale: true, colour1: null, colour2: null },
    { key: 'city_lagos', kind: 'city', name: 'L', emoji: '🇳🇬', price: 0, for_sale: false, colour1: null, colour2: null },
  ];
  assert.ok(isOwned(cat[0], []));
  assert.ok(!isOwned(cat[2], []) && isOwned(cat[2], ['gear_cap']));
  assert.ok(!isOwned(cat[3], []), 'travel badge only when earned');
  assert.deepEqual(defaultSlots(cat), { base: 'base_smile', kit: 'kit_classic', gear: null, badge: null });
  const cities = [{ key: 'lagos', name: 'Lagos', country: 'Nigeria', flag: '🇳🇬', price: 20 }, { key: 'paris', name: 'Paris', country: 'France', flag: '🇫🇷', price: 90 }];
  assert.equal(currentCity([], cities), null);
  assert.equal(currentCity([{ city: 'lagos', at: '2026-11-01T00:00:00Z' }, { city: 'paris', at: '2026-11-02T00:00:00Z' }], cities)?.name, 'Paris');
  assert.match(vlErrorMessage('not_enough_coins'), /enough Banta Coins/);
  assert.match(vlErrorMessage('weird'), /try again/);
  assert.equal(toVlState(null).status, 'error');
  assert.equal(toVlState({ signed_in: false }).status, 'visitor');
  assert.equal(toVlState({ signed_in: true, access: false }).status, 'no_access');
  assert.equal(toVlState({ signed_in: true, access: true, needs_profile: true }).status, 'needs_profile');
  assert.equal(toVlState({ signed_in: true, access: true, handle: 'x' }).status, 'error');
  assert.equal(toVlState({ signed_in: true, access: true, needs_profile: false, handle: 'x', balance: 5, catalog: cat }).status, 'ready');
});

test('website: page never sends amounts; missing functions show Coming Soon; profile card is additive', () => {
  const api = web('vlifeApi.ts');
  // Buying, flying and checking in never send an amount (only the admin gift does, admin-checked on the server).
  const memberCalls = api.split('\n').filter((l) => /vl_buy|vl_travel|vl_check_in|vl_set_avatar/.test(l)).join('\n');
  assert.ok(memberCalls && !/p_amount|amount:/.test(memberCalls));
  assert.ok(api.includes("'not_ready'") && web('VirtualLifePage.tsx').includes("state.status === 'not_ready'"));
  const profile = readFileSync('../../web/src/features/play/BanterProfile.tsx', 'utf8');
  assert.ok(profile.includes('<BanterCoinsCard />'));
});

console.log(`  ${passed} passed`);
