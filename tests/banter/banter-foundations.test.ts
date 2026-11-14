// Banter Hub foundations: username rules and the server-state → screen mapping (fails closed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkHandle, handleMessage, HANDLE_PATTERN, RESERVED_HANDLES } from '../../web/src/features/play/banterHandle';
import { toBanterState } from '../../web/src/features/play/banterState';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-foundations');

test('accepts valid handles', () => {
  for (const h of ['abc', 'LagosOracle', 'xG_Queen', 'a1_', 'A'.repeat(20), '  Spaced_Trim  ']) {
    assert.equal(checkHandle(h), null, h);
  }
});

test('rejects short, long and bad-character handles', () => {
  assert.equal(checkHandle(''), 'too_short');
  assert.equal(checkHandle('ab'), 'too_short');
  assert.equal(checkHandle('A'.repeat(21)), 'too_long');
  for (const h of ['has space', 'dash-name', 'dot.name', 'émile', 'emoji🔥x', 'semi;colon']) {
    assert.equal(checkHandle(h), 'bad_chars', h);
  }
});

test('rejects reserved handles in any case', () => {
  assert.equal(checkHandle('Admin'), 'reserved');
  assert.equal(checkHandle('ODDSBANTA'), 'reserved');
  assert.equal(checkHandle('support'), 'reserved');
});

test('every check and server code has a readable message', () => {
  for (const c of ['too_short', 'too_long', 'bad_chars', 'reserved', 'handle_invalid', 'handle_reserved', 'handle_taken', 'no_access', 'not_signed_in', 'avatar_invalid', 'no_user_row', 'something_new']) {
    assert.ok(handleMessage(c).length > 5, c);
  }
  assert.equal(handleMessage(null), '');
});

test('client rules match the migration (pattern and reserved list)', () => {
  const sql = readFileSync('../../supabase/migrations/20261114000001_banter_foundations.sql', 'utf8');
  assert.ok(sql.includes(`'${HANDLE_PATTERN.source}'`), 'handle regex differs from the SQL check');
  for (const r of RESERVED_HANDLES) assert.ok(sql.includes(`'${r}'`), `reserved word ${r} missing in SQL`);
});

test('server state maps to the right screen and fails closed', () => {
  assert.deepEqual(toBanterState(null), { status: 'error' });
  assert.deepEqual(toBanterState(undefined), { status: 'error' });
  assert.deepEqual(toBanterState({ signed_in: false, access: false }), { status: 'visitor' });
  assert.deepEqual(toBanterState({ signed_in: true, access: false }), { status: 'no_access' });
  // Anything other than access === true is no access.
  assert.deepEqual(toBanterState({ signed_in: true } as never), { status: 'no_access' });
  assert.deepEqual(toBanterState({ signed_in: true, access: 'true' } as never), { status: 'no_access' });
  assert.deepEqual(toBanterState({ signed_in: true, access: true, handle: null }), { status: 'needs_profile' });
  assert.deepEqual(toBanterState({ signed_in: true, access: true, handle: 'LagosOracle', avatar_emoji: '🦁', followed_leagues: ['PL'] }), {
    status: 'ready', handle: 'LagosOracle', avatar: '🦁', leagues: ['PL'],
  });
  assert.deepEqual(toBanterState({ signed_in: true, access: true, handle: 'x_y_z' }), {
    status: 'ready', handle: 'x_y_z', avatar: '⚽', leagues: null,
  });
});

console.log(`banter-foundations: ${passed} passed`);
