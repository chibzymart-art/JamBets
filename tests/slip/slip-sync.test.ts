// Acca slip account sync: SQL lock-down, merge rules, and the App wiring stays additive.
// Run: node tests/slip/run.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeSlips } from '../../web/src/hooks/slipMerge';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };
console.log('slip-sync');
const sql = readFileSync('../../supabase/migrations/20261118000002_user_slips.sql', 'utf8');
const app = readFileSync('../../web/src/App.tsx', 'utf8');
const hook = readFileSync('../../web/src/hooks/useSlipSync.ts', 'utf8');

test('table private: RLS on, no grants or policies for members', () => {
  assert.ok(sql.includes('alter table public.user_slips enable row level security;'));
  assert.ok(sql.includes('revoke all on table public.user_slips from public, anon, authenticated;'));
  assert.ok(!/create policy/i.test(sql));
});

test('functions only touch the caller\'s own row, signed-in only, size-limited', () => {
  for (const d of sql.split('create or replace function').slice(1)) {
    assert.ok(d.includes('security definer') && d.includes("set search_path = ''") && d.includes("raise exception 'not_signed_in'"));
  }
  assert.ok(sql.includes('where s.user_id = v_uid'));
  assert.ok(sql.includes('values (v_uid, v_items, v_ids, now())'));
  assert.ok(sql.includes("raise exception 'slip_too_large'") && sql.includes("raise exception 'slip_invalid'"));
  assert.ok(sql.includes('revoke execute on function public.slip_get() from public, anon;'));
  assert.ok(sql.includes('revoke execute on function public.slip_save(jsonb, text[]) from public, anon;'));
});

test('merge keeps every pick once and every fixture id once', () => {
  const it = (id: string) => ({ id, fixtureId: id, homeTeam: '', awayTeam: '', league: '', targetKickoffAt: '', market: '', prediction: '', probability: 0 });
  const m = mergeSlips({ items: [it('a'), it('b')], ids: ['1'] }, { items: [it('b'), it('c')], ids: ['1', '2'] });
  assert.deepEqual(m.items.map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(m.ids, ['1', '2']);
});

test('App change is one hook call; existing slip code untouched', () => {
  assert.equal((app.match(/useSlipSync\(/g) || []).length, 1);
  assert.ok(app.includes("localStorage.getItem('oddsbanta_favorites_v2')") && app.includes("localStorage.setItem('jambets_favorites'"));
  assert.ok(hook.includes("supabase.rpc('slip_get')") && hook.includes("supabase.rpc('slip_save'"));
  assert.ok(hook.includes('if (!userId) return;'), 'signed out: nothing happens');
});
console.log(`  ${passed} passed`);
