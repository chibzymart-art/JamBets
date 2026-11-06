// Behaviour test for the Telegram bot's paged prediction lists.
// Runs the real webhook handler against a mocked Supabase and Telegram API and checks that every
// match is listed across pages, the page buttons work, and the premium gate still applies.
// Run: node tests/edge/run.mjs
import './telegram-env';
import webhook from '../../api/telegram-webhook';
import { PAGE_SIZE, buildPager, parsePageCallback, pickLabel, renderPredictionPage } from '../../api/_lib/telegram-pages';

const future = new Date(Date.now() + 10 * 864e5).toISOString();
const PAID = 2;
const FREE = 1;
const accounts: Record<number, { user: any; subs: any[] }> = {
  [FREE]: { user: { id: 'u-free', email: 'free@example.com', role: 'free' }, subs: [] },
  [PAID]: { user: { id: 'u-std', email: 'std@example.com', role: 'standard' }, subs: [{ tier: 'standard', status: 'active', current_period_end: future }] },
};

const MATCHES = 21; // 3 pages of 8
const kickoff = new Date(Date.now() + 2 * 3600e3).toISOString();
const predictions = Array.from({ length: MATCHES }, (_, i) => ({
  id: `p${i + 1}`,
  fixture_id: `f${i + 1}`,
  prediction: i % 3 === 0 ? 'over' : i % 3 === 1 ? '1' : 'yes',
  market: i % 3 === 0 ? 'over_under_2.5' : i % 3 === 1 ? '1x2' : 'btts',
  probability: i === 0 ? 0.97 : 0.75,
  confidence_category: null,
  secondary_predictions: [{ market: 'over_under_1.5', prediction: 'over', probability: 0.82 }],
  target_kickoff_at: kickoff,
  fixture: {
    id: `f${i + 1}`,
    target_kickoff_at: kickoff,
    status: 'scheduled',
    home_team: { name: `Home-${i + 1}` },
    away_team: { name: `Away ${i + 1}` },
    league: { code: 'EPL', name: 'Premier League', country: 'England' },
  },
}));

type Call = { method: string; body: any };
let calls: Call[] = [];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const param = (url: URL, key: string) => (url.searchParams.get(key) || '').replace(/^eq\./, '');

(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = new URL(String(typeof input === 'string' ? input : input.url));
  if (url.hostname === 'api.telegram.org') {
    calls.push({ method: url.pathname.split('/').pop() || '', body: JSON.parse(init?.body || '{}') });
    return json({ ok: true, result: {} });
  }
  if (url.pathname.endsWith('/rest/v1/users')) {
    const chat = Number(param(url, 'telegram_chat_id'));
    return json(accounts[chat] ? [accounts[chat].user] : []);
  }
  const owner = Object.values(accounts).find((a) => a.user.id === param(url, 'user_id'));
  if (url.pathname.endsWith('/rest/v1/subscriptions')) return json(owner ? owner.subs : []);
  if (url.pathname.endsWith('/rest/v1/entitlements')) return json([]);
  if (url.pathname.endsWith('/rest/v1/football_predictions')) return json(predictions);
  return json([]);
};

const post = (update: any) =>
  webhook(new Request('https://www.oddsbanta.com/api/telegram-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-webhook-secret' },
    body: JSON.stringify(update),
  }));
const command = (chatId: number, text: string) =>
  post({ update_id: 1, message: { message_id: 1, chat: { id: chatId, type: 'private' }, from: { id: chatId }, text } });
const press = (chatId: number, data: string) =>
  post({ update_id: 2, callback_query: { id: 'cq1', from: { id: chatId }, message: { message_id: 55, chat: { id: chatId, type: 'private' } }, data } });

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`); if (!ok) failed++; };
const buttons = (markup: any): any[] => (markup?.inline_keyboard || []).flat();

// Pure helpers
check('pick label: over 2.5', pickLabel('over_under_2.5', 'over') === 'Over 2.5 Goals');
check('pick label: btts yes', pickLabel('btts', 'yes') === 'BTTS: Yes');
check('pick label: home win', pickLabel('1x2', '1') === 'Home Win');
check('pick label: double chance', pickLabel('double_chance', '1x') === 'Home or Draw (1X)');
check('callback parse round trip', JSON.stringify(parsePageCallback('pg|today|2026-11-06|3')) === JSON.stringify({ cmd: 'today', dateKey: '2026-11-06', page: 3 }));
check('callback parse rejects junk', parsePageCallback('pg|drop|2026-11-06|3') === null && parsePageCallback('x') === null);
check('single page has no buttons', buildPager('today', '2026-11-06', 1, 1) === undefined);
const big = buttons(buildPager('today', '2026-11-06', 6, 12)).map((b) => b.text);
check('many pages: first, window, last, prev/next', JSON.stringify(big) === JSON.stringify(['1', '5', '· 6 ·', '7', '12', '‹ Prev', 'Next ›']), JSON.stringify(big));
for (const cmd of ['today', 'tomorrow', 'bangers', 'toppicks', 'high', 'mid', 'low', 'goals']) {
  const data = buttons(buildPager(cmd, '2026-11-06', 500, 999)).map((b) => b.callback_data);
  check(`callback data fits 64 bytes (${cmd})`, data.every((d) => new TextEncoder().encode(d).length <= 64));
}
const longCards = Array.from({ length: PAGE_SIZE }, (_, i) => ({
  ...({} as any), fixtureId: `f${i}`, homeTeam: 'X'.repeat(200), awayTeam: 'Y'.repeat(200), leagueCode: 'L', kickoffTimeWat: '12:00', targetKickoffAt: kickoff,
  isBankerPass: false, primaryMarket: 'btts', primaryPick: 'yes', primaryProbability: 80, primaryCategory: 'HIGH CONFIDENCE',
  secondaryLeans: [{ market: 'over_under_1.5', prediction: 'over', probability: 81, confidenceCategory: 'HIGH CONFIDENCE', formattedMkt: '', formattedPick: '' }],
}));
check('page stays under Telegram limit with long names', renderPredictionPage({ cmd: 'today', displayDate: 'Fri 6 Nov', dateKey: '2026-11-06', cards: longCards, page: 1 }).text.length <= 4096);

// /today for a paid account: page 1 with buttons, no "visit the dashboard" cut-off
calls = [];
await command(PAID, '/today');
const first = calls.find((c) => c.method === 'sendMessage');
check('/today sends one message', calls.filter((c) => c.method === 'sendMessage').length === 1);
check('page 1 lists matches 1-8', !!first && /<b>1\. Home 1 vs Away 1<\/b>/.test(first.body.text) && /<b>8\. /.test(first.body.text) && !/<b>9\. /.test(first.body.text), first?.body.text);
check('page 1 says page 1 of 3 and the total', !!first && /Page <b>1<\/b> of <b>3<\/b>/.test(first.body.text) && /21 matches/.test(first.body.text));
check('no "more fixtures on dashboard" cut-off', !!first && !/more fixtures/i.test(first.body.text));
check('clean pick labels', !!first && /Over 2\.5 Goals/.test(first.body.text) && /Home Win/.test(first.body.text) && /BTTS: Yes/.test(first.body.text));
const kb = buttons(first?.body.reply_markup);
check('page buttons 1, 2, 3 and Next', JSON.stringify(kb.map((b) => b.text)) === JSON.stringify(['· 1 ·', '2', '3', 'Next ›']), JSON.stringify(kb.map((b) => b.text)));

// Press page 3: same message is edited to show matches 17-21
const page3 = kb.find((b) => b.text === '3')?.callback_data;
calls = [];
await press(PAID, page3);
const edit = calls.find((c) => c.method === 'editMessageText');
check('page button answers the callback', calls.some((c) => c.method === 'answerCallbackQuery'));
check('page button edits the same message', !!edit && edit.body.message_id === 55 && edit.body.chat_id === PAID);
check('page 3 lists matches 17-21', !!edit && /<b>17\. /.test(edit.body.text) && /<b>21\. /.test(edit.body.text) && !/<b>16\. /.test(edit.body.text), edit?.body.text);
check('page 3 has Prev, no Next', !!edit && buttons(edit.body.reply_markup).some((b) => b.text === '‹ Prev') && !buttons(edit.body.reply_markup).some((b) => b.text === 'Next ›'));

// Every match is reachable across the pages
const seen = new Set<number>();
for (let p = 1; p <= 3; p++) {
  calls = [];
  await press(PAID, page3.replace(/\|3$/, `|${p}`));
  const t = calls.find((c) => c.method === 'editMessageText')?.body.text || '';
  for (const m of t.matchAll(/<b>(\d+)\. Home /g)) seen.add(Number(m[1]));
}
check('all 21 matches appear across pages', seen.size === MATCHES, String(seen.size));

// Premium gate still applies to page buttons
calls = [];
await press(FREE, page3);
check('free account pressing a page button gets the upgrade message, no picks',
  calls.some((c) => c.method === 'sendMessage' && /VIP Access Required/.test(c.body.text)) && !calls.some((c) => c.method === 'editMessageText'));
calls = [];
await press(99, page3);
check('unlinked chat pressing a page button is asked to link',
  calls.some((c) => c.method === 'sendMessage' && /Authentication Required/.test(c.body.text)) && !calls.some((c) => c.method === 'editMessageText'));
calls = [];
await command(FREE, '/today');
check('free account /today still gets the upgrade message', calls.some((c) => /VIP Access Required/.test(c.body.text || '')) && !calls.some((c) => /Home 1 vs/.test(c.body.text || '')));

// Filtered command keeps its own filter on page turns
calls = [];
await command(PAID, '/bangers');
const bang = calls.find((c) => c.method === 'sendMessage');
check('/bangers lists only the 97% match, single page, no buttons', !!bang && /Super Bankers/.test(bang.body.text) && /1 match\b/.test(bang.body.text) && !bang.body.reply_markup, bang?.body.text);

// Current-page button just closes the spinner
calls = [];
await press(PAID, 'pg|noop');
check('current page button only answers the callback', calls.length === 1 && calls[0].method === 'answerCallbackQuery');

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nTELEGRAM PAGES: ALL PASSED');
