// Banter Hub football picks: rules that must match the database, lock countdown, labels.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BANTER_POINTS,
  DEFAULT_LEAGUE_CODES,
  FOOTBALL_MARKETS,
  PICK_LOCK_SECONDS,
  initialLeagueTicks,
  lockLabel,
  pickErrorMessage,
  selectionLabel,
} from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-football-picks');
const sql = readFileSync('../../supabase/migrations/20261114000002_banter_football_picks.sql', 'utf8');

test('scoring constants are 3 / 0 / 0.5 (owner, pending 3 vs 10)', () => {
  assert.deepEqual({ ...BANTER_POINTS }, { won: 3, lost: 0, void: 0.5 });
});

test('markets and selections match the SQL checks', () => {
  for (const m of FOOTBALL_MARKETS) {
    assert.ok(sql.includes(`market = '${m.id}' and selection in (${m.options.map((o) => `'${o.value}'`).join(', ')})`), `selection check for ${m.id}`);
  }
  assert.ok(sql.includes(`market in ('1X2', 'OU25', 'BTTS')`));
});

test('lock window matches the SQL (60 seconds)', () => {
  assert.equal(PICK_LOCK_SECONDS, 60);
  assert.ok(sql.includes(`interval '60 seconds'`));
});

test('lock countdown', () => {
  const kick = Date.UTC(2026, 10, 14, 15, 0, 0);
  const iso = new Date(kick).toISOString();
  assert.equal(lockLabel(iso, kick - 61_000 - 2 * 3600_000 - 5 * 60_000), 'Locks in 2h 05m');
  assert.equal(lockLabel(iso, kick - 60_000 - 4 * 60_000 - 30_000), 'Locks in 4m');
  assert.equal(lockLabel(iso, kick - 90_000), 'Locks in under a minute');
  assert.equal(lockLabel(iso, kick - 59_000), null);
  assert.equal(lockLabel(iso, kick + 1), null);
  assert.equal(lockLabel('not a date', kick), null);
  assert.equal(lockLabel(iso, kick - 60_000 - 50 * 3600_000), 'Locks in 2d 2h');
});

test('default league ticks are the five big leagues, saved ticks win', () => {
  assert.deepEqual(DEFAULT_LEAGUE_CODES, ['ENG_PL', 'ESP_LL', 'ITA_SA', 'FRA_L1', 'GER_BL']);
  assert.deepEqual(initialLeagueTicks(null), DEFAULT_LEAGUE_CODES);
  assert.deepEqual(initialLeagueTicks([]), DEFAULT_LEAGUE_CODES);
  assert.deepEqual(initialLeagueTicks(['NGA_NPFL']), ['NGA_NPFL']);
});

test('selection labels', () => {
  assert.equal(selectionLabel('1X2', 'home', 'Arsenal', 'Chelsea'), 'Arsenal win');
  assert.equal(selectionLabel('1X2', 'away', 'Arsenal', 'Chelsea'), 'Chelsea win');
  assert.equal(selectionLabel('1X2', 'draw'), 'Draw');
  assert.equal(selectionLabel('OU25', 'over'), 'Over 2.5 goals');
  assert.equal(selectionLabel('BTTS', 'no'), 'Both teams score: No');
});

test('every pick error code has a message', () => {
  for (const c of ['pick_locked', 'fixture_not_pickable', 'no_profile', 'no_access', 'not_signed_in', 'weird']) {
    assert.ok(pickErrorMessage(c).length > 5, c);
  }
});

test('pickable set requires a published prediction and exposes no AI fields', () => {
  assert.ok(sql.includes(`p.publication_status in ('published', 'settled')`));
  for (const leak of ['p.prediction', 'p.probability', 'confidence_category', 'p.metadata', 'secondary_predictions']) {
    assert.ok(!sql.includes(leak), `migration must not expose ${leak}`);
  }
});

console.log(`banter-football-picks: ${passed} passed`);
