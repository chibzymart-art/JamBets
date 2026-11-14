// Banter Hub profile: record comes from the caller's own leaderboard row; pending count; no new
// database objects; the profile form is shared with the first-time username screen.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { myLeaderboardRow, pendingCount } from '../../web/src/features/play/banterRules';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-profile');

test('record is the caller row, or none when no settled picks', () => {
  const rows = [
    { place: 1, is_me: false, points: 9 },
    { place: 14, is_me: true, points: 3 },
  ];
  assert.deepEqual(myLeaderboardRow(rows), rows[1]);
  assert.equal(myLeaderboardRow([{ place: 1, is_me: false }]), null);
  assert.equal(myLeaderboardRow([]), null);
  assert.equal(myLeaderboardRow(null), null);
});

test('pending count only counts pending picks', () => {
  assert.equal(pendingCount([{ status: 'pending' }, { status: 'won' }, { status: 'pending' }, { status: 'void' }]), 2);
  assert.equal(pendingCount([]), 0);
  assert.equal(pendingCount(undefined), 0);
});

test('profile uses only live functions (no new migration in this step)', () => {
  const src = readFileSync('../../web/src/features/play/BanterProfile.tsx', 'utf8');
  assert.ok(src.includes('fetchLeaderboard(period, 1)'), 'reads own row with limit 1');
  assert.ok(src.includes('fetchMyFootballPicks'));
  const migrations = readdirSync('../../supabase/migrations').filter((f) => /banter.*profile|profile.*banter/i.test(f));
  assert.deepEqual(migrations, [], 'no profile migration');
});

test('the same form is used for the first-time screen and the profile', () => {
  const gate = readFileSync('../../web/src/features/play/BanterGate.tsx', 'utf8');
  const profile = readFileSync('../../web/src/features/play/BanterProfile.tsx', 'utf8');
  assert.ok(gate.includes('export function ProfileForm('));
  assert.ok(gate.includes('<ProfileForm submitLabel="Save username"'));
  assert.ok(profile.includes("import { ProfileForm } from './BanterGate'"));
  assert.ok(!/RESERVED_HANDLES|HANDLE_PATTERN/.test(profile), 'no duplicated handle rules in the profile');
});

test('a saved profile updates the hub without a reload', () => {
  const gate = readFileSync('../../web/src/features/play/BanterGate.tsx', 'utf8');
  const hub = readFileSync('../../web/src/features/play/PlayHub.tsx', 'utf8');
  assert.ok(gate.includes('leagues: state.leagues }, setState)'), 'gate passes its state setter to children');
  assert.ok(hub.includes('(me, onProfileSaved) =>'));
  assert.ok(hub.includes('<BanterProfile me={me} onProfileSaved={onProfileSaved} />'));
});

test('no placeholder badges or AI record on the profile', () => {
  const profile = readFileSync('../../web/src/features/play/BanterProfile.tsx', 'utf8');
  assert.ok(!/badge|against the AI|Coming soon/i.test(profile));
});

console.log(`banter-profile: ${passed} passed`);
