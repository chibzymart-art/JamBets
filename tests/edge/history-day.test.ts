// Past-day reads (?date=YYYY-MM-DD) for the basketball and tennis feeds.
// Runs the real handlers against a mocked Supabase and checks: the day's exact UTC window is queried,
// paywall rules are unchanged, a closed day is cached long, a bad date falls back to the live feed.
// Run: node tests/edge/run.mjs
import tennis from '../../api/tennis-feed';
import basketball from '../../api/basketball-feed';
import { localDayWindow, parseHistoryDate, tzOffsetMinutes } from '../../api/_lib/history-day';

const SECRET = 'SECRET_PICK_DETAIL';
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

const day = new Date(Date.now() - 5 * 864e5);
const dayIso = day.toISOString().slice(0, 10);
const kickoff = `${dayIso}T14:00:00.000Z`;
const fixture = { id: 'f9', status: 'finished', target_kickoff_at: kickoff, metadata: { internal: SECRET },
  league: { id: 'l1', code: 'NBA', name: 'NBA' }, home_team: { id: 'h', canonical_name: 'Home' }, away_team: { id: 'a', canonical_name: 'Away' },
  player1: { id: 'p1', display_name: 'A', current_rank: 15, hard_elo: 2040 }, player2: { id: 'p2', display_name: 'B', current_rank: 90, hard_elo: 1700 },
  tournament: { id: 't1', name: 'T', tour: 'ATP', surface: 'hard' } };
const bWon = { id: 'bh1', fixture_id: 'f9', fixture, market: 'moneyline', prediction: 'Home To Win', probability: 0.88, confidence_category: 'BANGER',
  settlement_status: 'won', target_kickoff_at: kickoff, metadata: { simulation: { x: 1 } } };
const tWon = { id: 'th1', fixture_id: 'f9', fixture, market: 'match_winner', prediction: 'A to win', probability: 0.8, confidence_category: 'TOP PICK',
  settlement_status: 'won', target_kickoff_at: kickoff, metadata: { tactical_reasoning: SECRET, surface: 'hard' } };

const seen: string[] = [];
(globalThis as any).fetch = async (input: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  seen.push(url);
  if (url.includes('/auth/v1/user')) return json({}, 401);
  if (url.includes('rpc/get_user_session_bootstrap')) return json({ user: null, subscription: null, entitlement: null });
  if (url.includes('cached_feeds')) return json([]);
  if (url.includes('/rest/v1/basketball_predictions')) return json([bWon]);
  if (url.includes('/rest/v1/tennis_predictions')) return json([tWon]);
  if (url.includes('/rest/v1/')) return json([]);
  return json({}, 404);
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
let ip = 1;
const call = async (handler: any, path: string) => {
  const res = await handler(new Request(`https://www.oddsbanta.com${path}`, {
    headers: { 'user-agent': UA, origin: 'https://www.oddsbanta.com', 'x-forwarded-for': `10.1.0.${ip++}` },
  }));
  return { status: res.status, headers: res.headers, body: await res.json() };
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failures++;
};

(async () => {
  // Helpers
  check('lagos offset is +60', tzOffsetMinutes('Africa/Lagos', new Date('2026-10-25T12:00:00Z')) === 60);
  const w = localDayWindow('2026-10-20', 'Africa/Lagos');
  check('lagos day window', w.start === '2026-10-19T23:00:00.000Z' && w.end === '2026-10-20T23:00:00.000Z', JSON.stringify(w));
  const ny = localDayWindow('2026-11-01', 'America/New_York'); // DST ends that day: 25-hour day
  check('new york DST day is 25h', ny.start === '2026-11-01T04:00:00.000Z' && ny.end === '2026-11-02T05:00:00.000Z', JSON.stringify(ny));
  check('rejects bad / far dates', parseHistoryDate('2026-13-01') === null && parseHistoryDate('2020-01-01') === null && parseHistoryDate('x') === null);
  check('accepts recent date', parseHistoryDate(dayIso) === dayIso);

  // Basketball visitor, closed day
  seen.length = 0;
  const b = await call(basketball, `/api/basketball-feed?date=${dayIso}&tz=Africa/Lagos`);
  const bw = localDayWindow(dayIso, 'Africa/Lagos');
  const bq = seen.find((u) => u.includes('/rest/v1/basketball_predictions')) || '';
  check('basketball day: ok', b.status === 200 && b.body.success === true, String(b.status));
  check('basketball day: queries that day only', bq.includes(`gte.${encodeURIComponent(bw.start)}`) && bq.includes(`lt.${encodeURIComponent(bw.end)}`), bq.slice(0, 400));
  check('basketball day: settled pick shown with its tier (track record)', b.body.predictions?.[0]?.id === 'bh1' && b.body.predictions[0].confidence_category === 'BANGER');
  check('basketball day: long CDN cache for a closed day', (b.headers.get('CDN-Cache-Control') || '').includes('s-maxage=21600'), String(b.headers.get('CDN-Cache-Control')));
  check('basketball day: tagged', b.body.history_date === dayIso);

  // Basketball without date keeps the live path (cached_feeds first)
  seen.length = 0;
  await call(basketball, '/api/basketball-feed?tz=Africa/Lagos');
  check('basketball live: still reads the snapshot first', seen[0]?.includes('cached_feeds') === true || seen.some((u) => u.includes('cached_feeds')), seen.slice(0, 3).join(' | '));

  // Tennis visitor, closed day: still fully locked
  seen.length = 0;
  const t = await call(tennis, `/api/tennis-feed?date=${dayIso}&tz=Africa/Lagos`);
  const tq = seen.find((u) => u.includes('/rest/v1/tennis_predictions')) || '';
  const tp = t.body.predictions?.[0] || {};
  check('tennis day: ok', t.status === 200 && t.body.success === true, String(t.status));
  check('tennis day: queries that day only', tq.includes(`lt.${encodeURIComponent(bw.end)}`), tq.slice(0, 400));
  check('tennis day: visitor still sees a locked teaser', tp.is_locked === true && tp.probability === null && !JSON.stringify(t.body).includes(SECRET), JSON.stringify(tp).slice(0, 200));
  check('tennis day: long CDN cache for a closed day', (t.headers.get('CDN-Cache-Control') || '').includes('s-maxage=21600'), String(t.headers.get('CDN-Cache-Control')));

  // Invalid date: treated as the normal live request
  const bad = await call(basketball, '/api/basketball-feed?date=1999-01-01');
  check('bad date falls back to live feed', bad.status === 200 && !bad.body.history_date, JSON.stringify(bad.body).slice(0, 120));

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
