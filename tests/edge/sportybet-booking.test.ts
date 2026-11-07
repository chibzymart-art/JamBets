// Behaviour test for SportyBet booking codes: market mapping, team matching, the booking flow
// against a mocked SportyBet, the website endpoint, and the Telegram button with its premium gate.
// Run: node tests/edge/run.mjs
import './telegram-env';
process.env.SPORTYBET_BOOKING_ENABLED = 'true';
import webhook from '../../api/telegram-webhook';
import bookEndpoint, { itemToLeg } from '../../api/sportybet-book';
import {
  toSportyMarket,
  canonicalOutcome,
  teamSimilarity,
  bookLegs,
  legsFromCards,
  parseBookCallback,
  bookCallback,
  renderBookingMessage,
  resetBookingCaches,
} from '../../api/_lib/sportybet-booking';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`); if (!ok) failed++; };
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

// ── Market mapping ───────────────────────────────────────────────────────────
const M = (marketId: string, specifier: string, outcome: string) => ({ marketId, specifier, outcome });
const cases: [string, string, any][] = [
  ['over_under_2.5', 'over', M('18', 'total=2.5', 'over')],
  ['over_under_1.5', 'under', M('18', 'total=1.5', 'under')],
  ['over_2.5_goals', 'OVER_2.5', M('18', 'total=2.5', 'over')],
  ['ht_over_0.5_goals', 'HT_OVER_0.5', M('68', 'total=0.5', 'over')],
  ['1h_goals_0.5', 'over', M('68', 'total=0.5', 'over')],
  ['Over 2.5 Goals', '', M('18', 'total=2.5', 'over')],
  ['1st Half Over 0.5 Goals', '', M('68', 'total=0.5', 'over')],
  ['btts', 'yes', M('29', '', 'yes')],
  ['BTTS: No', '', M('29', '', 'no')],
  ['Both Teams to Score (GG Yes)', '', M('29', '', 'yes')],
  ['double_chance', '1X', M('10', '', '1x')],
  ['Draw or Away (X2)', '', M('10', '', 'x2')],
  ['Home or Away (12)', '', M('10', '', '12')],
  ['1x2', '1', M('1', '', 'home')],
  ['1x2', 'X', M('1', '', 'draw')],
  ['Away Win', '', M('1', '', 'away')],
];
for (const [market, pick, want] of cases) {
  const got = toSportyMarket(market, pick);
  check(`maps "${market}" / "${pick}"`, eq(got, want), JSON.stringify(got));
}
const more: [string, string, any][] = [
  ['corners_10.5', 'under', M('166', 'total=10.5', 'under')],
  ['Over 8.5 Corners', '', M('166', 'total=8.5', 'over')],
  ['over_8.5_corners', 'Over 8.5 Corners', M('166', 'total=8.5', 'over')],
  ['away_goals_0.5', 'over', M('20', 'total=0.5', 'over')],
  ['Home Under 1.5', '', M('19', 'total=1.5', 'under')],
  ['2h_goals_0.5', 'over', M('90', 'total=0.5', 'over')],
  ['ht_goals_1.5', 'under', M('68', 'total=1.5', 'under')],
  ['Over/Under 2.5', 'Over', M('18', 'total=2.5', 'over')],
];
for (const [market, pick, want] of more) {
  const got = toSportyMarket(market, pick);
  check(`maps "${market}" / "${pick}"`, eq(got, want), JSON.stringify(got));
}
for (const [market, pick] of [['Anytime Scorer', 'Haaland'], ['NO_SAFE_BANKER', ''], ['Under 164.0 Total Points', ''], ['Over 25.5 Games', ''], ['Lucio Ratti +1.5 Sets', '']]) {
  check(`does not book "${market}"`, toSportyMarket(market, pick) === null, JSON.stringify(toSportyMarket(market, pick)));
}
check('outcome descs', ['Home', 'Draw', 'Away', 'Over 2.5', 'Under', 'Home or Draw', 'Draw or Away', 'Home or Away', 'Yes', 'No'].map(canonicalOutcome).join(',') === 'home,draw,away,over,under,1x,x2,12,yes,no');

// ── Team matching ────────────────────────────────────────────────────────────
check('Man Utd ~ Manchester United', teamSimilarity('Man Utd', 'Manchester United') >= 0.6);
check('Wolves ~ Wolverhampton', teamSimilarity('Wolves', 'Wolverhampton Wanderers') >= 0.6);
check('Bayern Munchen ~ Bayern Munich (accents)', teamSimilarity('Bayern München', 'FC Bayern Munich') >= 0.6);
check('Arsenal !~ Chelsea', teamSimilarity('Arsenal', 'Chelsea') < 0.6);
check('paris-saint-germain ~ PSG', teamSimilarity('paris saint germain', 'PSG') >= 0.8);
check('west-ham-united ~ West Ham', teamSimilarity('west ham united', 'West Ham') >= 0.6);
check('koebenhavn ~ Copenhagen', teamSimilarity('koebenhavn', 'FC Copenhagen') >= 0.8);
check('Manchester City !~ Manchester United', teamSimilarity('Manchester City', 'Manchester United') < 0.6);
check('Leicester ~ Leicester City', teamSimilarity('Leicester', 'Leicester City') >= 0.6);
check('Real Madrid !~ Real Sociedad', teamSimilarity('Real Madrid', 'Real Sociedad') < 0.6);

// ── Mock SportyBet ───────────────────────────────────────────────────────────
const now = Date.now();
const ko = (h: number) => now + h * 3600e3;
const market = (id: string, specifier: string, outcomes: [string, string, string][], status = 0) => ({
  id, desc: id, specifier, status, outcomes: outcomes.map(([oid, desc, odds]) => ({ id: oid, desc, odds, isActive: 1 })),
});
const sbEvents = [
  {
    eventId: 'sr:match:1001', homeTeamName: 'Arsenal', awayTeamName: 'Chelsea', estimateStartTime: ko(3),
    markets: [
      market('1', '', [['1', 'Home', '1.80'], ['2', 'Draw', '3.60'], ['3', 'Away', '4.20']]),
      market('18', 'total=2.5', [['12', 'Over 2.5', '1.75'], ['13', 'Under 2.5', '2.05']]),
      market('68', 'total=0.5', [['12', 'Over 0.5', '1.30'], ['13', 'Under 0.5', '3.40']]),
    ],
  },
  {
    eventId: 'sr:match:1002', homeTeamName: 'Manchester United', awayTeamName: 'Wolverhampton Wanderers', estimateStartTime: ko(5),
    markets: [
      market('29', '', [['74', 'Yes', '1.70'], ['76', 'No', '2.10']]),
      market('10', '', [['9', 'Home or Draw', '1.25'], ['10', 'Home or Away', '1.30'], ['11', 'Draw or Away', '1.90']]),
      market('18', 'total=2.5', [['12', 'Over 2.5', '1.60'], ['13', 'Under 2.5', '2.30']], 2), // closed
    ],
  },
];

let shareBodies: any[] = [];
let feedCalls = 0;
let refuseShare = false;
let unavailable: any[] = [];
const feedUrls: string[] = [];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const sportyFetch = async (input: any, init?: any) => {
  const url = new URL(String(typeof input === 'string' ? input : input.url));
  if (url.pathname.endsWith('/factsCenter/pcUpcomingEvents')) {
    feedCalls++;
    feedUrls.push(url.search);
    return json({ bizCode: 10000, data: { totalNum: sbEvents.length, tournaments: [{ id: 'sr:tournament:17', events: sbEvents }] } });
  }
  if (url.pathname.endsWith('/orders/share')) {
    const body = JSON.parse(init?.body || '{}');
    shareBodies.push(body);
    if (refuseShare) return json({ bizCode: 4000, message: 'invalid selection' });
    return json({ bizCode: 10000, isAvailable: true, data: { shareCode: 'AB12CD', shareURL: 'http://www.sportybet.com/ng/?shareCode=AB12CD', deadline: ko(3), unavailableOutcomes: unavailable } });
  }
  return null as any;
};

const iso = (ms: number) => new Date(ms).toISOString();
const legs = [
  { home: 'Arsenal FC', away: 'Chelsea', kickoffIso: iso(ko(3)), market: 'over_under_2.5', pick: 'over' },
  { home: 'Arsenal', away: 'Chelsea', kickoffIso: iso(ko(3)), market: 'Home Win', pick: '' }, // same match twice
  { home: 'Man Utd', away: 'Wolves', kickoffIso: iso(ko(5)), market: 'btts', pick: 'yes' },
  { home: 'Man Utd', away: 'Wolves', kickoffIso: iso(ko(5)), market: 'over_2.5_goals', pick: 'OVER_2.5' }, // closed market
  { home: 'Liverpool', away: 'Everton', kickoffIso: iso(ko(4)), market: 'btts', pick: 'yes' }, // not on SportyBet
  { home: 'Leeds', away: 'Hull', kickoffIso: iso(now - 3600e3), market: 'btts', pick: 'yes' }, // started
  { home: 'Arsenal', away: 'Chelsea', kickoffIso: iso(ko(3)), market: 'Anytime Scorer', pick: 'Saka' }, // not bookable
];

const run = async () => {
  resetBookingCaches();
  const r = await bookLegs(legs, sportyFetch as any, now);
  check('booking succeeds', r.ok && r.code === 'AB12CD', JSON.stringify(r));
  check('books matched open picks only', eq(shareBodies[0]?.selections, [
    { eventId: 'sr:match:1001', marketId: '18', specifier: 'total=2.5', outcomeId: '12' },
    { eventId: 'sr:match:1002', marketId: '29', specifier: '', outcomeId: '74' },
  ]), JSON.stringify(shareBodies[0]));
  check('total odds = product', r.totalOdds === Math.round(1.75 * 1.7 * 100) / 100, String(r.totalOdds));
  const reasons = r.skipped.map(s => `${s.leg.home}:${s.reason}`);
  check('reports every skipped pick', reasons.includes('Arsenal:second pick on the same match')
    && reasons.includes('Man Utd:market closed on SportyBet')
    && reasons.includes('Liverpool:match not found on SportyBet')
    && reasons.includes('Leeds:already kicked off')
    && reasons.includes('Arsenal:market not offered for booking'), reasons.join(' | '));

  check('share link is https', r.url === 'https://www.sportybet.com/ng/?shareCode=AB12CD', String(r.url));
  check('feed asks for a 24h window for today', /timeline=24/.test(feedUrls[0] || '') && /marketId=1,10,18,19,20,29,68,90,166/.test(feedUrls[0] || ''), feedUrls[0]);

  // One team named differently ("Stade Rennais" vs "Rennes") still matches on kickoff + the other team.
  const rennes = { eventId: 'sr:match:2001', homeTeamName: 'Rennes', awayTeamName: 'Lille OSC', estimateStartTime: ko(6), markets: [market('29', '', [['74', 'Yes', '1.80'], ['76', 'No', '1.95']])] };
  sbEvents.push(rennes as any);
  resetBookingCaches();
  shareBodies = [];
  const rr = await bookLegs([{ home: 'stade rennais', away: 'lille', kickoffIso: iso(ko(6)), market: 'btts', pick: 'yes' }], sportyFetch as any, now);
  check('matches when one team name differs', rr.ok && shareBodies[0]?.selections?.[0]?.eventId === 'sr:match:2001', JSON.stringify(rr.skipped));
  const wrongTime = await bookLegs([{ home: 'stade rennais', away: 'lille', kickoffIso: iso(ko(9)), market: 'btts', pick: 'yes' }], sportyFetch as any, now);
  check('no match at a different kickoff', !wrongTime.ok, JSON.stringify(wrongTime));

  // Legs SportyBet reports as unavailable are not counted as booked.
  resetBookingCaches();
  unavailable = [{ eventId: 'sr:match:1002' }];
  const partial = await bookLegs(legs, sportyFetch as any, now);
  check('suspended legs reported, not booked', partial.ok && partial.booked.length === 1 && partial.skipped.some(x => x.reason === 'suspended on SportyBet'), JSON.stringify(partial.skipped.map(x => x.reason)));
  unavailable = [];

  // Refused slip: retried once, then a clear error and never a made-up code.
  resetBookingCaches();
  shareBodies = [];
  refuseShare = true;
  const bad = await bookLegs(legs, sportyFetch as any, now);
  check('refused slip gives no code', !bad.ok && !bad.code && /refused/i.test(bad.error || ''), JSON.stringify(bad));
  check('refused slip retried once', shareBodies.length === 2, String(shareBodies.length));
  refuseShare = false;

  resetBookingCaches();
  const none = await bookLegs([legs[4]], sportyFetch as any, now);
  check('nothing matched -> no code', !none.ok && !none.code && /on SportyBet/.test(none.error || ''), JSON.stringify(none));

  // Bot cards -> legs
  const cardLegs = legsFromCards([
    { title: 'Arsenal vs Chelsea', kickoff: '16:00', main: { label: 'Over 2.5 Goals', result: 'pending' } },
    { title: 'Leeds vs Hull', kickoff: '13:00', main: { label: 'BTTS: Yes', result: 'won' } },
    { title: 'A vs B', kickoff: '18:30', main: null },
  ], '2026-11-08');
  check('cards -> legs (pending main picks only)', eq(cardLegs.map(l => [l.home, l.away, l.kickoffIso, l.market]), [['Arsenal', 'Chelsea', '2026-11-08T16:00:00+01:00', 'Over 2.5 Goals']]), JSON.stringify(cardLegs));

  check('callback round trip', eq(parseBookCallback(bookCallback('goals', '2026-11-08')), { view: 'goals', dateKey: '2026-11-08' }));
  check('callback rejects other sports', parseBookCallback('bk|tennis|2026-11-08') === null && parseBookCallback('pg|football|2026-11-08|1') === null);
  check('callback fits 64 bytes', bookCallback('toppicks', '2026-11-08').length <= 64);

  const msg = renderBookingMessage(r, 'Football Predictions', 'Sat, 8 Nov 2026');
  check('message shows code, link and skipped picks', msg.includes('<code>AB12CD</code>') && msg.includes('shareCode=AB12CD') && msg.includes('Liverpool vs Everton') && msg.includes('18+'), msg);
  const failMsg = renderBookingMessage({ ok: false, booked: [], skipped: [], error: 'SportyBet is not responding right now.' }, 'Bangers', 'Sat');
  check('failure message has no code', !failMsg.includes('<code>') && failMsg.includes('not responding'));

  // ── Website endpoint ─────────────────────────────────────────────────────
  check('slip item id keys win over labels', eq(itemToLeg({ id: 'f1::over_2.5_goals::OVER_2.5', homeTeam: 'A', awayTeam: 'B', targetKickoffAt: iso(ko(3)), market: 'Over 2.5 Goals', prediction: 'Over 2.5' }), {
    home: 'A', away: 'B', kickoffIso: iso(ko(3)), market: 'over_2.5_goals', pick: 'OVER_2.5', label: 'Over 2.5',
  }));
  check('bad slip items dropped', itemToLeg({ homeTeam: 'A' }) === null && itemToLeg(null) === null);

  (globalThis as any).fetch = sportyFetch;
  resetBookingCaches();
  const res = await bookEndpoint(new Request('https://www.oddsbanta.com/api/sportybet-book', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ items: [
      { id: 'f1::over_under_2.5::over', homeTeam: 'Arsenal', awayTeam: 'Chelsea', targetKickoffAt: iso(ko(3)), market: 'Over/Under 2.5', prediction: 'Over' },
      { id: 'f2::Anytime Scorer::Saka', homeTeam: 'Arsenal', awayTeam: 'Chelsea', targetKickoffAt: iso(ko(3)), market: 'Anytime Scorer', prediction: 'Saka' },
    ] }),
  }));
  const body = await res.json();
  check('endpoint returns the code', res.status === 200 && body.ok && body.code === 'AB12CD' && body.booked === 1, JSON.stringify(body));
  check('endpoint lists skipped picks', body.skipped?.length === 1 && /not offered/.test(body.skipped[0].reason), JSON.stringify(body.skipped));
  const getRes = await bookEndpoint(new Request('https://www.oddsbanta.com/api/sportybet-book'));
  check('endpoint is POST only', getRes.status === 405);
  const empty = await bookEndpoint(new Request('https://www.oddsbanta.com/api/sportybet-book', { method: 'POST', headers: { 'x-forwarded-for': '1.2.3.5' }, body: JSON.stringify({ items: [] }) }));
  check('empty slip -> 400', empty.status === 400);
  let limited = 0;
  for (let i = 0; i < 8; i++) {
    const rr = await bookEndpoint(new Request('https://www.oddsbanta.com/api/sportybet-book', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ items: [] }) }));
    if (rr.status === 429) limited++;
  }
  check('endpoint is rate limited per IP', limited >= 2, String(limited));

  // ── Telegram button ──────────────────────────────────────────────────────
  const future = new Date(Date.now() + 10 * 864e5).toISOString();
  const accounts: Record<number, { user: any; subs: any[] }> = {
    1: { user: { id: 'u-free', email: 'free@example.com', role: 'free' }, subs: [] },
    2: { user: { id: 'u-std', email: 'std@example.com', role: 'standard' }, subs: [{ tier: 'standard', status: 'active', current_period_end: future }] },
  };
  const kickoffIso = iso(ko(3));
  const football = [{
    id: 'p1', fixture_id: 'f1', prediction: 'over', market: 'over_under_2.5', probability: 0.8, confidence_category: 'HIGH CONFIDENCE',
    secondary_predictions: [], target_kickoff_at: kickoffIso,
    fixture: { id: 'f1', target_kickoff_at: kickoffIso, status: 'scheduled', home_team: { name: 'Arsenal' }, away_team: { name: 'Chelsea' }, league: { code: 'EPL', name: 'Premier League' } },
  }];
  const tg: { method: string; body: any }[] = [];
  const param = (url: URL, key: string) => (url.searchParams.get(key) || '').replace(/^eq\./, '');
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = new URL(String(typeof input === 'string' ? input : input.url));
    if (url.hostname === 'www.sportybet.com') return sportyFetch(input, init);
    if (url.hostname === 'api.telegram.org') {
      tg.push({ method: url.pathname.split('/').pop() || '', body: JSON.parse(init?.body || '{}') });
      return json({ ok: true, result: {} });
    }
    if (url.pathname.endsWith('/rest/v1/users')) {
      const chat = Number(param(url, 'telegram_chat_id'));
      return json(accounts[chat] ? [accounts[chat].user] : []);
    }
    const owner = Object.values(accounts).find(a => a.user.id === param(url, 'user_id'));
    if (url.pathname.endsWith('/rest/v1/subscriptions')) return json(owner ? owner.subs : []);
    if (url.pathname.endsWith('/rest/v1/entitlements')) return json([]);
    if (url.pathname.endsWith('/football_predictions')) return json(football);
    return json([]);
  };
  const post = (update: any) => webhook(new Request('https://www.oddsbanta.com/api/telegram-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-webhook-secret' },
    body: JSON.stringify(update),
  }));
  const press = (chatId: number, data: string) =>
    post({ update_id: 2, callback_query: { id: 'cq1', from: { id: chatId }, message: { message_id: 55, chat: { id: chatId, type: 'private' } }, data } });

  await post({ update_id: 1, message: { message_id: 1, chat: { id: 2, type: 'private' }, from: { id: 2 }, text: '/today' } });
  const list = tg.find(c => c.method === 'sendMessage');
  const btn = (list?.body?.reply_markup?.inline_keyboard || []).flat().find((b: any) => String(b.callback_data).startsWith('bk|'));
  check('today list has a SportyBet button', !!btn && /SportyBet/.test(btn.text), JSON.stringify(list?.body?.reply_markup));

  tg.length = 0;
  await post({ update_id: 1, message: { message_id: 1, chat: { id: 2, type: 'private' }, from: { id: 2 }, text: '/yesterday' } });
  const past = tg.find(c => c.method === 'sendMessage');
  check('past days have no SportyBet button', !(past?.body?.reply_markup?.inline_keyboard || []).flat().some((b: any) => String(b.callback_data).startsWith('bk|')));

  tg.length = 0;
  resetBookingCaches();
  await press(2, btn.callback_data);
  const sent = tg.filter(c => c.method === 'sendMessage');
  check('paid user gets a booking code', sent.length === 1 && sent[0].body.text.includes('<code>AB12CD</code>'), JSON.stringify(sent));
  check('button press is answered', tg.some(c => c.method === 'answerCallbackQuery'));

  tg.length = 0;
  shareBodies = [];
  await press(1, btn.callback_data);
  const freeMsg = tg.filter(c => c.method === 'sendMessage');
  check('free user is gated, no booking made', freeMsg.length === 1 && !freeMsg[0].body.text.includes('<code>') && shareBodies.length === 0, JSON.stringify(freeMsg));

  tg.length = 0;
  await press(2, 'bk|football|2020-01-01');
  check('old day refused', tg.some(c => c.method === 'answerCallbackQuery' && /today and upcoming/.test(c.body.text || '')) && !tg.some(c => c.method === 'sendMessage'));

  // Switched off (the default): no button, button presses refused, endpoint closed, no SportyBet calls.
  process.env.SPORTYBET_BOOKING_ENABLED = '';
  tg.length = 0;
  shareBodies = [];
  feedCalls = 0;
  await post({ update_id: 1, message: { message_id: 1, chat: { id: 2, type: 'private' }, from: { id: 2 }, text: '/today' } });
  const offList = tg.find(c => c.method === 'sendMessage');
  check('switched off: no SportyBet button', !!offList && !(offList.body.reply_markup?.inline_keyboard || []).flat().some((b: any) => String(b.callback_data).startsWith('bk|')));
  tg.length = 0;
  await press(2, btn.callback_data);
  check('switched off: old button says coming soon', tg.some(c => c.method === 'answerCallbackQuery' && /coming soon/.test(c.body.text || '')) && !tg.some(c => c.method === 'sendMessage'));
  const offRes = await bookEndpoint(new Request('https://www.oddsbanta.com/api/sportybet-book', { method: 'POST', headers: { 'x-forwarded-for': '7.7.7.7' }, body: JSON.stringify({ items: [{ homeTeam: 'Arsenal', awayTeam: 'Chelsea', targetKickoffAt: iso(ko(3)), market: 'btts', prediction: 'yes' }] }) }));
  check('switched off: endpoint closed', offRes.status === 503);
  check('switched off: SportyBet never called', feedCalls === 0 && shareBodies.length === 0);

  if (failed) {
    console.error(`${failed} SportyBet booking check(s) failed`);
    process.exit(1);
  }
  console.log('All SportyBet booking checks passed');
};

run().catch(e => {
  console.error(e);
  process.exit(1);
});
