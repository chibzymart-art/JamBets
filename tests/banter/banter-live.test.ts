// Banter Hub live updates: pings carry no message text, access stays in the RPCs, polling pauses
// while hidden, and every live screen is wired (topic, topic list, league wall, bell + badge).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('banter-live');
const src = (f: string) => readFileSync(`../../web/src/features/play/${f}`, 'utf8');
const live = src('banterLive.ts');
const disc = src('BanterDiscussion.tsx');
const wall = src('BanterWall.tsx');
const bell = src('BanterRepliesToYou.tsx');
const hub = src('PlayHub.tsx');

test('pings carry no message text and no ids beyond the channel name', () => {
  const payloads = [...live.matchAll(/payload: (\{[^}]*\})/g)].map((m) => m[1]);
  const http = [...live.matchAll(/httpSend\('ping', (\{[^}]*\})/g)].map((m) => m[1]);
  assert.ok(payloads.length >= 1 && http.length >= 1);
  for (const p of [...payloads, ...http]) assert.equal(p.replace(/\s/g, ''), '{at:Date.now()}');
});

test('live code never reads tables directly; it refetches through the RPC helpers', () => {
  for (const s of [live, disc, wall, bell, hub]) {
    assert.ok(!/\.from\(['"`]/.test(s), 'no direct table reads');
  }
  assert.ok(disc.includes('fetchTopic(topicId)') && disc.includes('fetchTopics(query, TOPIC_PAGE, 0)'));
  assert.ok(wall.includes('fetchWall(leagueId, null, WALL_PAGE)'));
});

test('polling every 10 seconds while visible, paused when hidden, refresh on return', () => {
  assert.ok(live.includes('export const POLL_MS = 10_000;'));
  assert.ok(live.includes("document.visibilityState === 'visible'"));
  assert.ok(live.includes("addEventListener('visibilitychange'"));
  assert.ok(live.includes('stop();'));
  assert.ok(live.includes('if (running) { queued = true; return; }'), 'refreshes are coalesced');
});

test('own pings are not echoed back; failures never break posting', () => {
  assert.ok(live.includes('self: false'));
  assert.ok(/export function sendPing[\s\S]*?catch/.test(live));
});

test('every live screen is wired', () => {
  assert.ok(disc.includes('useLiveRefresh([liveKey.topic(topicId)]'));
  assert.ok(disc.includes('useLiveRefresh([liveKey.topicList()]'));
  assert.ok(wall.includes('useLiveRefresh([leagueId ? liveKey.league(leagueId) : null]'));
  assert.ok(hub.includes('useLiveRefresh([liveKey.member(handle)]'));
  assert.ok(bell.includes('onLocalNotify('));
});

test('senders ping the conversation and the members they notify', () => {
  assert.ok(disc.includes('liveKey.member(replyTo.handle)') && disc.includes('liveKey.member(data.topic.handle)'));
  assert.ok(wall.includes('liveKey.member(replyTo.handle)'));
  assert.ok(disc.includes('sendPing(liveKey.topicList())'));
});

test('no jumping: new replies append with a chip when scrolled up; wall holds new posts while reading', () => {
  assert.ok(disc.includes('nearBottom()') && disc.includes('new {newIds.length === 1'));
  assert.ok(wall.includes('topVisible(listRef.current)') && wall.includes('setPending(fresh)'));
  assert.ok(wall.includes('showPending'));
});

console.log(`banter-live: ${passed} passed`);
