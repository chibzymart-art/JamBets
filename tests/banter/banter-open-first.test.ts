// Banter Today: open matches first, locked/live/finished below, original order kept in each group.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openFixturesFirst } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };
console.log('banter-open-first');
const now = Date.parse('2026-11-18T15:00:00Z');
const f = (id: string, status: string, kickoff: string) => ({ id, status, kickoff_at: kickoff });

test('locked, live and finished matches go below open ones; kickoff order kept', () => {
  const list = [
    f('done', 'finished', '2026-11-18T12:00:00Z'),
    f('live', 'live', '2026-11-18T14:00:00Z'),
    f('lockedSoon', 'scheduled', '2026-11-18T15:00:30Z'), // inside the 60s lock window
    f('open1', 'scheduled', '2026-11-18T16:00:00Z'),
    f('open2', 'scheduled', '2026-11-18T19:00:00Z'),
  ];
  assert.deepEqual(openFixturesFirst(list, now).map((x) => x.id), ['open1', 'open2', 'done', 'live', 'lockedSoon']);
});

test('nothing dropped, input not changed', () => {
  const list = [f('a', 'finished', '2026-11-18T10:00:00Z'), f('b', 'scheduled', '2026-11-18T20:00:00Z')];
  const copy = JSON.stringify(list);
  assert.equal(openFixturesFirst(list, now).length, 2);
  assert.equal(JSON.stringify(list), copy);
});

test('Today list uses it and re-sorts as time passes', () => {
  const src = readFileSync('../../web/src/features/play/BanterToday.tsx', 'utf8');
  assert.ok(src.includes('openFixturesFirst((fixtures || []).filter((f) => ticks.includes(f.league_code)), now)'));
  assert.ok(src.includes('[fixtures, ticks, now]'));
});
console.log(`  ${passed} passed`);
