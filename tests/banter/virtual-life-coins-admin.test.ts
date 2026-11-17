// Virtual Life: 1000 starting coins, unlimited admin coins, admin gifts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAfford, reasonLabel, toVlState, vlErrorMessage } from '../../web/src/features/virtual-life/vlifeRules';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };
console.log('virtual-life-coins-admin');
const sql = readFileSync('../../supabase/migrations/20261118000001_virtual_life_coins_admin.sql', 'utf8');
const fnBody = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2));
};

test('welcome is 1000; old 50 topped up once to 1000', () => {
  const b = fnBody('vl_sync_earnings');
  assert.ok(b.includes("values (p_uid, 1000, 'welcome', 'welcome')"));
  assert.ok(b.includes("1000 - l.amount, 'welcome_topup', 'welcome_1000'") && b.includes('l.amount < 1000'));
  assert.ok(b.includes('on conflict on constraint vl_coin_ledger_once do nothing'));
});

test('admins never refused, only for their own spends', () => {
  const b = fnBody('vl_spend');
  assert.ok(b.includes("p_uid = (select auth.uid()) and coalesce(public.is_admin(), false)"));
  assert.ok(b.includes('pg_advisory_xact_lock'));
});

test('admin gift: admin-only, capped, by username or email, positive only, recorded', () => {
  const b = fnBody('vl_admin_grant');
  assert.ok(b.indexOf("raise exception 'not_admin'") < b.indexOf('insert into public.vl_coin_ledger'));
  assert.ok(b.includes('p_amount < 1 or p_amount > 100000'));
  assert.ok(b.includes('from auth.users u where lower(u.email) = v_who') && b.includes('lower(p.handle) = v_who'));
  assert.ok(b.includes("'admin_grant'"));
  assert.ok(sql.includes("(reason in ('pick_won', 'welcome', 'welcome_topup', 'checkin', 'admin_grant') and amount > 0)"));
  assert.ok(sql.includes('revoke execute on function public.vl_admin_grant(text, integer) from public, anon;'));
});

test('internals stay private; richest ranking skips admins', () => {
  for (const sig of ['vl_sync_earnings(uuid)', 'vl_spend(uuid, integer, text, text)', 'vl_is_admin_user(uuid)']) {
    assert.ok(sql.includes(`revoke execute on function public.${sig} from public, anon, authenticated;`), sig);
  }
  assert.ok(fnBody('vl_leaderboard').includes("v_kind = 'travel' or not public.vl_is_admin_user(pp.user_id)"));
  for (const d of sql.split('create or replace function').slice(1)) assert.ok(d.includes("set search_path = ''"));
  assert.ok(!/transfer|cash/i.test(sql.replace(/--.*$/gm, '')));
});

test('website: unlimited for admins, labels and errors', () => {
  assert.ok(canAfford(5000, 0, true) && !canAfford(50, 10, false) && canAfford(10, 10, false));
  assert.equal(reasonLabel('admin_grant'), 'Gift from admin');
  assert.equal(reasonLabel('welcome_topup'), 'Welcome top-up');
  assert.match(vlErrorMessage('member_not_found'), /No member/);
  const s = toVlState({ signed_in: true, access: true, needs_profile: false, handle: 'x', balance: 1, is_admin: true });
  assert.ok(s.status === 'ready' && s.isAdmin);
  const w = readFileSync('../../web/src/features/virtual-life/VlWorld.tsx', 'utf8');
  assert.ok(w.includes("state.isAdmin ? 'Unlimited'") && w.includes('{state.isAdmin && <AdminGiveCoins'));
  assert.ok(readFileSync('../../web/src/features/virtual-life/vlifeApi.ts', 'utf8').includes("supabase.rpc('vl_get_state_admin')"));
});
console.log(`  ${passed} passed`);
