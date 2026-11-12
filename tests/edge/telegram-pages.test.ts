// Behaviour test for the Telegram bot's prediction lists: every match listed across pages, every
// sub-prediction inside its card, sport/market tabs, day switch, page buttons, the menu, and the
// premium gate on every button. Runs the real webhook handler against mocked Supabase and Telegram.
// Run: node tests/edge/run.mjs
import './telegram-env';
import webhook from '../../api/telegram-webhook';
import {
  BOT_MENU,
  PAGE_SIZE,
  buildPager,
  commandToView,
  paginate,
  parsePageCallback,
  pickLabel,
  renderListPage,
  tierLabel,
  parseDateArg,
  shiftDateKey,
  normalizeResult,
  buildKeyboard,
  lagosTodayKey,
  lagosDayLabel,
  shortDay,
  refreshCallback,
  parseRefreshCallback,
  NOOP_CALLBACK,
} from '../../api/_lib/telegram-pages';

const future = new Date(Date.now() + 10 * 864e5).toISOString();
const PAID = 2;
const FREE = 1;
const accounts: Record<number, { user: any; subs: any[] }> = {
  [FREE]: { user: { id: 'u-free', email: 'free@example.com', role: 'free' }, subs: [] },
  [PAID]: { user: { id: 'u-std', email: 'std@example.com', role: 'standard' }, subs: [{ tier: 'standard', status: 'active', current_period_end: future }] },
};

const kickoff = new Date(Date.now() + 2 * 3600e3).toISOString();
const fbFixture = (i: number) => ({
  id: `f${i}`,
  target_kickoff_at: kickoff,
  status: 'scheduled',
  home_team: { name: `Home-${i}` },
  away_team: { name: `Away ${i}` },
  league: { code: 'EPL', name: 'Premier League', country: 'England' },
});

const MATCHES = 21;
const football = Array.from({ length: MATCHES }, (_, i) => ({
  id: `p${i + 1}`,
  fixture_id: `f${i + 1}`,
  prediction: i % 3 === 0 ? 'over' : i % 3 === 1 ? '1x' : 'yes',
  market: i % 3 === 0 ? 'over_under_1.5' : i % 3 === 1 ? 'double_chance' : 'btts',
  probability: i === 0 ? 0.97 : 0.75,
  confidence_category: i === 0 ? 'BANGER' : 'MID CONFIDENCE',
  secondary_predictions: [
    { market: 'away_goals_0.5', prediction: 'over', probability: 0.9035, prob: 90.35, confidence_tier: 'TOP PICK' },
    { market: 'double_chance', prediction: '12', probability: 0.8002, prob: 80.02, confidence_tier: 'HIGH CONFIDENCE' },
    { market: 'btts', prediction: 'yes', probability: 0.6752, prob: 67.52, confidence_tier: 'LOW CONFIDENCE' },
    { market: 'corners_10.5', prediction: 'under', probability: 0.6066, prob: 60.66, confidence_tier: 'RISKY' },
  ],
  target_kickoff_at: kickoff,
  fixture: fbFixture(i + 1),
}));

// Settled examples: match 2 won (2-1, one sub-pick lost), match 3 lost.
Object.assign(football[1], { settlement_status: 'won', actual_score: '2-1' });
football[1].fixture = { ...football[1].fixture, status: 'finished', home_score: 2, away_score: 1 } as any;
football[1].secondary_predictions = football[1].secondary_predictions.map((x: any, i: number) => ({ ...x, settlement_status: i === 0 ? 'lost' : 'won' }));
Object.assign(football[2], { settlement_status: 'lost', actual_score: '0-0' });

const goals = [
  { id: 'g1', fixture_id: 'f1', market: 'over_2.5_goals', probability: 0.81, confidence_tier: 'GOAL_MACHINE', xg_combined: 3.12, settlement_status: 'won', actual_score: '3-1', ht_score: '1-0', target_kickoff_at: kickoff, fixture: fbFixture(1) },
  { id: 'g2', fixture_id: 'f1', market: 'ht_over_0.5_goals', probability: 0.78, confidence_tier: 'TEMPO_HIGH', xg_combined: null, target_kickoff_at: kickoff, fixture: fbFixture(1) },
  { id: 'g3', fixture_id: 'f2', market: 'ht_over_0.5_goals', probability: 0.72, confidence_tier: 'EARLY_STRIKE', xg_combined: null, target_kickoff_at: kickoff, fixture: fbFixture(2) },
];
const corners = [
  { id: 'c1', fixture_id: 'f3', market: 'over_8.5_corners', prediction: 'Over 8.5 Corners', probability: 0.6059, confidence_category: 'MID_CONFIDENCE', predicted_total_corners: 10.2, settlement_status: 'lost', actual_corners: '6 corners (4H - 2A)', over_8_5_prob: 0.6059, over_9_5_prob: 0.48, over_10_5_prob: null, target_kickoff_at: kickoff, fixture: fbFixture(3) },
];
const basketball = [
  {
    id: 'b1', market: 'moneyline', prediction: 'Mogi Das Cruzes To Win', probability: 0.897, confidence_category: 'BANGER', settlement_status: 'won', actual_result: 'Mogi Das Cruzes 88 - 71 Basquete Cearense',
    secondary_predictions: [
      { pick: 'Under 164.0 Total Points', market: 'game_total_over_under', prediction: 'Under 164.0 Total Points', probability: 0.6813, confidence_category: 'HIGH CONFIDENCE' },
      { pick: 'Basquete Cearense +27.5 Points', market: 'point_spread', prediction: 'Basquete Cearense +27.5 Points', probability: 0.6783, confidence_category: 'HIGH CONFIDENCE' },
    ],
    target_kickoff_at: kickoff,
    fixture: { target_kickoff_at: kickoff, league: { code: 'BRA_NBB', name: 'Novo Basquete Brasil (NBB)' }, home_team: { canonical_name: 'Mogi Das Cruzes', short_name: 'MOD' }, away_team: { canonical_name: 'Basquete Cearense', short_name: 'BAC' } },
  },
];
const tennis = [
  {
    id: 't1', market: 'NO_SAFE_BANKER', prediction: 'NO SAFE BANKER (High Volatility)', probability: 0.5, confidence_category: 'NO_SAFE_BANKER', actual_result: 'Lucio Ratti won 2-0 (6-4, 6-1)',
    secondary_predictions: [
      { market: 'game_handicap', prediction: 'Lucio Ratti +1.5 Games', probability: 0.6094 },
      { market: 'first_set_winner', prediction: 'Lucio Ratti 1st Set', probability: 0.5007 },
      { market: 'set_handicap', prediction: 'Lucio Ratti +1.5 Sets', probability: 0.7496, settlement_status: 'won' },
      { market: 'total_games_over_under', prediction: 'Over 25.5 Games', probability: 0.5083 },
    ],
    target_kickoff_at: kickoff,
    fixture: { target_kickoff_at: kickoff, round: 'R32', tournament: { name: 'Villa Maria, Argentina', tour: 'ATP', surface: 'hard_outdoor' }, player1: { display_name: 'Lucio Ratti' }, player2: { display_name: 'Carlos Maria Zarate' } },
  },
];

type Call = { method: string; body: any };
let calls: Call[] = [];
let editError = ''; // when set, editMessageText fails with this Telegram error description
const queried: string[] = [];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const param = (url: URL, key: string) => (url.searchParams.get(key) || '').replace(/^eq\./, '');

(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = new URL(String(typeof input === 'string' ? input : input.url));
  if (url.hostname === 'api.telegram.org') {
    const method = url.pathname.split('/').pop() || '';
    calls.push({ method, body: JSON.parse(init?.body || '{}') });
    if (method === 'editMessageText' && editError) return json({ ok: false, error_code: 400, description: editError }, 400);
    return json({ ok: true, result: {} });
  }
  if (url.pathname.endsWith('/rest/v1/users')) {
    const chat = Number(param(url, 'telegram_chat_id'));
    return json(accounts[chat] ? [accounts[chat].user] : []);
  }
  const owner = Object.values(accounts).find((a) => a.user.id === param(url, 'user_id'));
  if (url.pathname.endsWith('/rest/v1/subscriptions')) return json(owner ? owner.subs : []);
  if (url.pathname.endsWith('/rest/v1/entitlements')) return json([]);
  const table = url.pathname.split('/').pop() || '';
  queried.push(`${table}?${url.search}`);
  if (url.searchParams.get('publication_status') !== 'eq.published') return json([]); // must filter published
  if (table === 'football_predictions') return json(football);
  if (table === 'goals_predictions') return json(goals);
  if (table === 'corner_predictions') return json(corners);
  if (table === 'basketball_predictions') return json(basketball);
  if (table === 'tennis_predictions') return json(tennis);
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
const sentText = () => calls.find((c) => c.method === 'sendMessage')?.body;
const editBody = () => calls.find((c) => c.method === 'editMessageText')?.body;

// ── Pure helpers
check('pick label: over 1.5', pickLabel('over_under_1.5', 'over') === 'Over 1.5 Goals');
check('pick label: btts yes', pickLabel('btts', 'yes') === 'BTTS: Yes');
check('pick label: away over 0.5', pickLabel('away_goals_0.5', 'over') === 'Away Over 0.5');
check('pick label: corners under', pickLabel('corners_10.5', 'under') === 'Corners Under 10.5');
check('pick label: double chance', pickLabel('double_chance', '1x') === 'Home or Draw (1X)');
check('tier label: underscores', tierLabel('GOAL_MACHINE') === 'Goal Machine' && tierLabel('MID_CONFIDENCE') === 'Mid Confidence');
check('callback parse round trip', JSON.stringify(parsePageCallback('pg|basketball|2026-11-06|3')) === JSON.stringify({ cmd: 'basketball', dateKey: '2026-11-06', page: 3 }));
check('callback parse: old "today" buttons still work', parsePageCallback('pg|today|2026-11-06|2')?.cmd === 'football');
check('callback parse rejects junk', parsePageCallback('pg|drop|2026-11-06|3') === null && parsePageCallback('x') === null);
check('single page has no page buttons', buildPager('football', '2026-11-06', 1, 1) === undefined);
const big = buttons(buildPager('football', '2026-11-06', 6, 12)).map((b) => b.text);
check('many pages: first, window, last, prev/next', JSON.stringify(big) === JSON.stringify(['1', '5', '· 6 ·', '7', '12', '‹ Prev', 'Next ›']), JSON.stringify(big));
check('paginate respects size budget', JSON.stringify(paginate(['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)], 130)) === JSON.stringify([[0, 1], [2]]));
check('paginate respects max per page', paginate(Array(PAGE_SIZE + 1).fill('x'), 10000).length === 2);
for (const view of ['football', 'bangers', 'toppicks', 'high', 'mid', 'low', 'goals', 'ht05', 'corners', 'basketball', 'tennis']) {
  const kb = renderListPage({ view, displayDate: 'Fri 6 Nov', dateKey: '2026-11-06', todayKey: '2026-11-06', tomorrowKey: '2026-11-07', cards: [], page: 999 }).replyMarkup;
  check(`callback data fits 64 bytes (${view})`, buttons(kb).every((b) => new TextEncoder().encode(b.callback_data).length <= 64));
}
const longCard = { title: 'X'.repeat(300) + ' vs ' + 'Y'.repeat(300), league: 'L', kickoff: '12:00', main: { label: 'Over 1.5 Goals', probability: 80, tier: 'HIGH CONFIDENCE' }, subs: Array(6).fill({ label: 'Z'.repeat(150), probability: 70 }), tiers: [] };
const longPage = renderListPage({ view: 'football', displayDate: 'Fri 6 Nov', dateKey: '2026-11-06', todayKey: '2026-11-06', tomorrowKey: '2026-11-07', cards: Array(12).fill(longCard), page: 1 });
check('pages stay under Telegram limit with long cards', longPage.text.length <= 4096 && longPage.totalPages > 1, `${longPage.text.length} chars, ${longPage.totalPages} pages`);

// Menu: every entry is answered by the bot
for (const m of BOT_MENU) {
  if (m.command === 'status' || m.command === 'help' || m.command === 'date') continue;
  check(`menu /${m.command} is a list command`, !!commandToView('/' + m.command));
}
check('menu has no admin-only /settled', !BOT_MENU.some((m) => m.command === 'settled'));
check('menu covers 1H 0.5, corners, basketball, tennis, tomorrow', ['ht05', 'corners', 'basketball', 'tennis', 'tomorrow'].every((c) => BOT_MENU.some((m) => m.command === c)));

// ── /today: page 1, every sub-prediction inside each card, tabs + pages underneath
calls = [];
await command(PAID, '/today');
let body = sentText();
check('/today sends one message', calls.filter((c) => c.method === 'sendMessage').length === 1);
check('page 1 starts at match 1 and lists all its sub-picks', !!body && /<b>1\. Home 1 vs Away 1<\/b>/.test(body.text) && /Away Over 0\.5 · 90%/.test(body.text) && /Home or Away \(12\) · 80%/.test(body.text) && /BTTS: Yes · 68%/.test(body.text) && /Corners Under 10\.5 · 61%/.test(body.text), body?.text.slice(0, 600));
check('main pick shows % and tier', !!body && /🎯 <b>Over 1\.5 Goals<\/b> — <b>97%<\/b> · Banger/.test(body.text));
check('no "more fixtures on dashboard" cut-off', !!body && !/more fixtures/i.test(body.text));
const kb = buttons(body?.reply_markup).map((b) => b.text);
check('tabs: football active, then Over 2.5, 1H 0.5, Corners, Basketball, Tennis', ['• ⚽ Football •', '🎯 Over 2.5', '⏱️ 1H 0.5', '🚩 Corners', '🏀 Basketball', '🎾 Tennis'].every((t) => kb.includes(t)), JSON.stringify(kb));
const TODAY = lagosTodayKey();
check('day switch: dated prev, today marked, dated next', kb.includes(`‹ ${shortDay(shiftDateKey(TODAY, -1))}`) && kb.includes(`• ${shortDay(TODAY)}`) && kb.includes(`${shortDay(shiftDateKey(TODAY, 1))} ›`) && !kb.some((t) => /Today|Tomorrow/.test(t)), JSON.stringify(kb));
check('refresh button on the list', buttons(body?.reply_markup).some((b) => b.text === '🔄 Refresh' && b.callback_data === 'rf|football'));
check('page buttons present', kb.includes('· 1 ·') && kb.includes('Next ›'));
check('message under Telegram limit', !!body && body.text.length <= 4096);

// Every football match is reachable across the pages
const total = Number(body?.text.match(/of <b>(\d+)<\/b>/)?.[1] || 0);
const seen = new Set<number>();
const pageBtn = buttons(body?.reply_markup).find((b) => b.text === 'Next ›')?.callback_data as string;
for (let p = 1; p <= total; p++) {
  calls = [];
  await press(PAID, pageBtn.replace(/\|\d+$/, `|${p}`));
  for (const m of (editBody()?.text || '').matchAll(/<b>(\d+)\. Home /g)) seen.add(Number(m[1]));
}
check(`all ${MATCHES} matches appear across ${total} pages`, seen.size === MATCHES, String(seen.size));

// ── Tabs switch sport/market in the same message
const tab = (label: string) => buttons(body?.reply_markup).find((b) => b.text === label)?.callback_data as string;
calls = [];
await press(PAID, tab('🏀 Basketball'));
let ed = editBody();
check('Basketball tab: edits the same message', !!ed && ed.message_id === 55);
check('Basketball tab: card with all sub-picks', !!ed && /Mogi Das Cruzes vs Basquete Cearense/.test(ed.text) && /Mogi Das Cruzes To Win<\/b> — <b>90%<\/b> · Banger/.test(ed.text) && /Under 164\.0 Total Points · 68%/.test(ed.text) && /Basquete Cearense \+27\.5 Points · 68%/.test(ed.text), ed?.text);
check('Basketball tab is marked active', buttons(ed?.reply_markup).some((b) => b.text === '• 🏀 Basketball •'));

calls = [];
await press(PAID, tab('🎾 Tennis'));
ed = editBody();
check('Tennis tab: no safe banker, but every other pick listed', !!ed && /Lucio Ratti vs Carlos Maria Zarate/.test(ed.text) && /ATP Villa Maria, Argentina · R32/.test(ed.text) && /No safe banker/.test(ed.text) && /Lucio Ratti \+1\.5 Sets · 75%/.test(ed.text) && /Over 25\.5 Games · 51%/.test(ed.text), ed?.text);

calls = [];
await press(PAID, tab('🎯 Over 2.5'));
ed = editBody();
check('Over 2.5 tab: only over 2.5 rows, with 1H 0.5 as a sub-pick and xG', !!ed && /Over 2\.5 Goals<\/b> — <b>81%<\/b> · Goal Machine/.test(ed.text) && /1st Half Over 0\.5 Goals · 78%/.test(ed.text) && /xG\): 3\.12/.test(ed.text) && /1 match\b/.test(ed.text), ed?.text);

calls = [];
await press(PAID, tab('⏱️ 1H 0.5'));
ed = editBody();
check('1H 0.5 tab: both 1st-half rows', !!ed && /2 matches/.test(ed.text) && /1st Half Over 0\.5 Goals<\/b> — <b>78%<\/b> · Tempo High/.test(ed.text) && /Early Strike/.test(ed.text), ed?.text);

calls = [];
await press(PAID, tab('🚩 Corners'));
ed = editBody();
check('Corners tab: main line, other lines and expected corners', !!ed && /Over 8\.5 Corners<\/b> — <b>61%<\/b> · Mid Confidence/.test(ed.text) && /Over 9\.5 Corners · 48%/.test(ed.text) && /Expected corners: 10\.2/.test(ed.text) && !/Over 8\.5 Corners · 61%/.test(ed.text), ed?.text);

// Day switch
const TOMORROW = shiftDateKey(TODAY, 1);
const tomorrowBtn = buttons(body?.reply_markup).find((b) => b.text === `${shortDay(TOMORROW)} ›`)?.callback_data as string;
check('next-day button carries an explicit date', tomorrowBtn === `pg|football|${TOMORROW}|1`, tomorrowBtn);
calls = [];
await press(PAID, tomorrowBtn);
ed = editBody();
const tmKb = buttons(ed?.reply_markup).map((b) => b.text);
check('next-day button moves the labels: prev = today, current = tomorrow (not marked today), next = day after',
  tmKb.includes(`‹ ${shortDay(TODAY)}`) && tmKb.includes(`📅 ${shortDay(TOMORROW)}`) && tmKb.includes(`${shortDay(shiftDateKey(TODAY, 2))} ›`) && !tmKb.some((t) => t.startsWith('• ') && /\d/.test(t)), JSON.stringify(tmKb));

// Refresh: edits in place with today's list, page 1, same tab, and answers "Refreshed"
calls = [];
await press(PAID, 'rf|basketball');
ed = editBody();
const rfAnswer = calls.find((c) => c.method === 'answerCallbackQuery');
check('refresh edits the same message with today on the same tab', !!ed && ed.message_id === 55 && /Basketball Predictions/.test(ed.text) && buttons(ed.reply_markup).some((b) => b.text === `• ${shortDay(TODAY)}`) && buttons(ed.reply_markup).some((b) => b.text === '• 🏀 Basketball •'), ed?.text?.slice(0, 200));
check('refresh answers the callback with "Refreshed"', rfAnswer?.body.text === 'Refreshed');
editError = 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same';
calls = [];
await press(PAID, 'rf|football');
editError = '';
check('refresh with unchanged content: no fallback retry, callback still answered',
  calls.filter((c) => c.method === 'editMessageText').length === 1 && calls.some((c) => c.method === 'answerCallbackQuery' && c.body.text === 'Refreshed'), JSON.stringify(calls.map((c) => c.method)));
calls = [];
await press(FREE, 'rf|football');
check('free account pressing Refresh gets the upgrade message, no picks',
  calls.some((c) => c.method === 'sendMessage' && /VIP Access Required/.test(c.body.text)) && !calls.some((c) => c.method === 'editMessageText'));

// Empty tab still shows the tabs so the user can move on
const savedTennis = tennis.splice(0);
calls = [];
await press(PAID, tab('🎾 Tennis'));
ed = editBody();
check('empty tab: friendly message and tabs kept', !!ed && /No tennis predictions found/.test(ed.text) && buttons(ed.reply_markup).some((b) => b.text === '⚽ Football'));
tennis.push(...savedTennis);

// ── Commands for each menu item
for (const [cmd, expect] of [
  ['/goals', /Over 2\.5 Goals<\/b>/],
  ['/ht05', /1st Half Over 0\.5 Goals<\/b>/],
  ['/corners', /Corners<\/b>/],
  ['/basketball', /Basketball Predictions/],
  ['/tennis', /Tennis Predictions/],
  ['/tomorrow', /Football Predictions/],
] as [string, RegExp][]) {
  calls = [];
  await command(PAID, cmd);
  check(`${cmd} shows its list`, expect.test(sentText()?.text || ''), (sentText()?.text || '').slice(0, 200));
}

// Tier views use the tiers shown on the cards (site thresholds: Banger 96%+)
calls = [];
await command(PAID, '/bangers');
body = sentText();
check('/bangers lists only the Banger match', !!body && /Bangers<\/b> · 96%\+/.test(body.text) && /1 match\b/.test(body.text) && /Home 1 vs Away 1/.test(body.text), body?.text.slice(0, 300));
calls = [];
await command(PAID, '/toppicks');
check('/toppicks lists matches with a Top Pick inside', /21 matches/.test(sentText()?.text || ''));

// Every table query filters to published rows
check('every prediction query filters publication_status=published', queried.length > 0 && queried.every((q) => q.includes('publication_status=eq.published')));

// ── Premium gate still applies to every button
calls = [];
await press(FREE, tab('🏀 Basketball'));
check('free account pressing a tab gets the upgrade message, no picks',
  calls.some((c) => c.method === 'sendMessage' && /VIP Access Required/.test(c.body.text)) && !calls.some((c) => c.method === 'editMessageText'));
calls = [];
await press(99, pageBtn);
check('unlinked chat pressing a page button is asked to link',
  calls.some((c) => c.method === 'sendMessage' && /Authentication Required/.test(c.body.text)) && !calls.some((c) => c.method === 'editMessageText'));
for (const cmd of ['/today', '/basketball', '/tennis', '/corners', '/ht05']) {
  calls = [];
  await command(FREE, cmd);
  check(`free account ${cmd} still gets the upgrade message`, calls.some((c) => /VIP Access Required/.test(c.body.text || '')) && !calls.some((c) => /%/.test(c.body.text || '') && /vs/.test(c.body.text || '')));
}

// Active tab / page button just closes the spinner
calls = [];
await press(PAID, 'pg|noop');
check('active button only answers the callback', calls.length === 1 && calls[0].method === 'answerCallbackQuery');

// /help and /start list the same commands as the menu
calls = [];
await command(PAID, '/help');
check('/help lists every menu command', BOT_MENU.every((m) => (sentText()?.text || '').includes('/' + m.command)));


// ── Results and day history
check('normalizeResult', normalizeResult('won') === 'won' && normalizeResult('LOST') === 'lost' && normalizeResult('void') === 'void' && normalizeResult(null) === 'pending');
check('parseDateArg: ISO', parseDateArg('2026-11-05', '2026-11-07') === '2026-11-05');
check('parseDateArg: 5/11 and 5 Nov and Nov 5', parseDateArg('5/11', '2026-11-07') === '2026-11-05' && parseDateArg('5 Nov', '2026-11-07') === '2026-11-05' && parseDateArg('nov 5', '2026-11-07') === '2026-11-05');
check('parseDateArg: nearest year across new year', parseDateArg('30/12', '2027-01-02') === '2026-12-30');
check('parseDateArg: rejects junk', parseDateArg('hello', '2026-11-07') === null && parseDateArg('31/02', '2026-11-07') === null);
check('shiftDateKey across month end', shiftDateKey('2026-10-31', 1) === '2026-11-01' && shiftDateKey('2026-11-01', -1) === '2026-10-31');

calls = [];
await command(PAID, '/today');
body = sentText();
check('settled main pick shows ✅ WON and the final score', !!body && /<b>2\. Home 2 vs Away 2<\/b>\n🏆 EPL  ·  ⏰ \d\d:\d\d\n📋 <b>FT 2-1<\/b>\n🎯 <b>Home or Draw \(1X\)<\/b> — <b>75%<\/b> · Mid Confidence  <b>✅ WON<\/b>/.test(body.text), body?.text.slice(0, 900));
check('settled sub-picks show ✅/❌', !!body && /Away Over 0\.5 · 90% ❌/.test(body.text) && /Home or Away \(12\) · 80% ✅/.test(body.text));
check('lost main pick shows ❌ LOST', !!body && /❌ LOST/.test(body.text));
check('unsettled picks show no badge', !!body && /<b>1\. Home 1 vs Away 1<\/b>\n🏆 EPL  ·  ⏰ \d\d:\d\d\n🎯 <b>Over 1\.5 Goals<\/b> — <b>97%<\/b> · Banger\n/.test(body.text));
check('day results line with hit rate', !!body && /📊 Results: ✅ 1 won · ❌ 1 lost · ⏳ 19 to play  \(50% hit rate\)/.test(body.text), body?.text.slice(0, 200));

calls = [];
await press(PAID, (buttons(body?.reply_markup).find((b) => b.text === '🎯 Over 2.5')?.callback_data) as string);
check('goals card shows FT and HT score and result', /📋 <b>FT 3-1 · HT 1-0<\/b>/.test(editBody()?.text || '') && /✅ WON/.test(editBody()?.text || ''), editBody()?.text);


calls = [];
await press(PAID, (buttons(body?.reply_markup).find((b) => b.text === '🚩 Corners')?.callback_data) as string);
check('corners card shows the corner count and result', /📋 <b>Corners: 6 \(4H - 2A\)<\/b>/.test(editBody()?.text || '') && /❌ LOST/.test(editBody()?.text || ''), editBody()?.text);
calls = [];
await press(PAID, (buttons(body?.reply_markup).find((b) => b.text === '🏀 Basketball')?.callback_data) as string);
check('basketball card shows the final score and result', /📋 <b>Mogi Das Cruzes 88 - 71 Basquete Cearense<\/b>/.test(editBody()?.text || '') && /✅ WON/.test(editBody()?.text || ''));
calls = [];
await press(PAID, (buttons(body?.reply_markup).find((b) => b.text === '🎾 Tennis')?.callback_data) as string);
check('tennis card shows the result and settled sub-pick', /📋 <b>Lucio Ratti won 2-0 \(6-4, 6-1\)<\/b>/.test(editBody()?.text || '') && /Lucio Ratti \+1\.5 Sets · 75% ✅/.test(editBody()?.text || ''), editBody()?.text);

const prevBtn = buttons(body?.reply_markup).find((b) => /^‹ /.test(b.text))?.callback_data as string;
calls = [];
await press(PAID, prevBtn);
ed = editBody();
check("previous-day button opens yesterday; next button shows today's date to come back", !!ed && buttons(ed.reply_markup).some((b) => b.text === `📅 ${shortDay(shiftDateKey(TODAY, -1))}`) && buttons(ed.reply_markup).some((b) => b.text === `${shortDay(TODAY)} ›` && b.callback_data === `pg|football|${TODAY}|1`) && /past|Results|matches/.test(ed.text));

calls = [];
await command(PAID, '/yesterday');
check('/yesterday shows a list', /Football Predictions/.test(sentText()?.text || ''));
calls = [];
await command(PAID, '/results');
check('/results now shows the day list (not admin-only)', /Football Predictions/.test(sentText()?.text || '') && !/not available/.test(sentText()?.text || ''));
calls = [];
await command(PAID, '/date 5 Nov');
check('/date with a day shows that day', /Football Predictions/.test(sentText()?.text || ''));
calls = [];
await command(PAID, '/date');
check('/date without a day explains how', /Pick a day/.test(sentText()?.text || ''));
calls = [];
await command(PAID, '/date 2020-01-01');
check('/date out of range explains the limits', /go back 60 days/.test(sentText()?.text || ''));
calls = [];
await press(PAID, 'pg|football|2020-01-01|1');
check('out-of-range day button is refused', calls.some((c) => c.method === 'answerCallbackQuery' && /out of range/.test(c.body.text || '')) && !calls.some((c) => c.method === 'editMessageText'));
calls = [];
await command(FREE, '/date 5 Nov');
check('free account /date still gets the upgrade message', calls.some((c) => /VIP Access Required/.test(c.body.text || '')));
calls = [];
await command(FREE, '/results');
check('free account /results still gets the upgrade message', calls.some((c) => /VIP Access Required/.test(c.body.text || '')));

// ── Dated day labels (Lagos time, UTC+1) and Refresh
check('label: Lagos weekday + date', lagosDayLabel(new Date('2026-11-12T12:00:00Z')) === 'Thu 12 Nov', lagosDayLabel(new Date('2026-11-12T12:00:00Z')));
check('label: 22:59 UTC is still the same Lagos day', lagosDayLabel(new Date('2026-11-11T22:59:00Z')) === 'Wed 11 Nov');
check('label: 23:00 UTC is already the next Lagos day', lagosDayLabel(new Date('2026-11-11T23:00:00Z')) === 'Thu 12 Nov');
check('today from injected now: just before Lagos midnight', lagosTodayKey(new Date('2026-11-11T22:59:59Z')) === '2026-11-11');
check('today from injected now: just after Lagos midnight', lagosTodayKey(new Date('2026-11-11T23:00:01Z')) === '2026-11-12');
check('today from injected now: across month end', lagosTodayKey(new Date('2026-11-30T23:30:00Z')) === '2026-12-01');
check('shortDay for a date key', shortDay('2026-11-13') === 'Fri 13 Nov' && shortDay('2026-11-01') === 'Sun 1 Nov');

const dayRow = (k: any): any[] => k.inline_keyboard.find((r: any[]) => r.some((b) => /^(•|📅) \w{3} \d{1,2} \w{3,4}$/.test(b.text)));
const k1 = buildKeyboard({ view: 'football', dateKey: '2026-11-12', todayKey: '2026-11-12', page: 1, totalPages: 1 });
check('viewing today: "‹ Wed 11 Nov" · "• Thu 12 Nov" · "Fri 13 Nov ›"', JSON.stringify(dayRow(k1).map((b) => b.text)) === JSON.stringify(['‹ Wed 11 Nov', '• Thu 12 Nov', 'Fri 13 Nov ›']), JSON.stringify(dayRow(k1)));
check('day buttons carry explicit dates', JSON.stringify(dayRow(k1).map((b) => b.callback_data)) === JSON.stringify(['pg|football|2026-11-11|1', NOOP_CALLBACK, 'pg|football|2026-11-13|1']));
const k2 = buildKeyboard({ view: 'goals', dateKey: '2026-11-13', todayKey: '2026-11-12', page: 1, totalPages: 1 });
check('labels shift with the viewed day (D+1)', JSON.stringify(dayRow(k2).map((b) => b.text)) === JSON.stringify(['‹ Thu 12 Nov', '📅 Fri 13 Nov', 'Sat 14 Nov ›']), JSON.stringify(dayRow(k2)));
const k3 = buildKeyboard({ view: 'football', dateKey: '2026-11-11', todayKey: '2026-11-11', page: 1, totalPages: 1 });
const k3b = buildKeyboard({ view: 'football', dateKey: '2026-11-11', todayKey: '2026-11-12', page: 1, totalPages: 1 });
check('same day re-rendered after midnight is no longer marked today', dayRow(k3)[1].text === '• Wed 11 Nov' && dayRow(k3b)[1].text === '📅 Wed 11 Nov');
const kMax = buildKeyboard({ view: 'football', dateKey: shiftDateKey('2026-11-12', 7), todayKey: '2026-11-12', page: 1, totalPages: 1 });
const kMin = buildKeyboard({ view: 'football', dateKey: shiftDateKey('2026-11-12', -60), todayKey: '2026-11-12', page: 1, totalPages: 1 });
check('no next button at +7 days, no prev button at -60 days', !dayRow(kMax).some((b) => b.text.endsWith(' ›')) && !dayRow(kMin).some((b) => b.text.startsWith('‹ ')) && dayRow(kMax).length === 2 && dayRow(kMin).length === 2);
const kPaged = buildKeyboard({ view: 'tennis', dateKey: '2026-11-12', todayKey: '2026-11-12', page: 2, totalPages: 3 });
const lastRow = kPaged.inline_keyboard[kPaged.inline_keyboard.length - 1];
check('refresh is the last row, after the page buttons', lastRow.length === 1 && lastRow[0].text === '🔄 Refresh' && lastRow[0].callback_data === 'rf|tennis');
check('refresh callback round trip', refreshCallback('ht05') === 'rf|ht05' && parseRefreshCallback('rf|ht05')?.cmd === 'ht05' && parseRefreshCallback('rf|bangers')?.cmd === 'bangers');
check('refresh callback rejects junk', parseRefreshCallback('rf|drop') === null && parseRefreshCallback('rf|football|x') === null && parseRefreshCallback('pg|football|2026-11-12|1') === null && parseRefreshCallback(null) === null);
check('refresh callback is not a page callback', parsePageCallback('rf|football') === null);
check('every callback fits 64 bytes incl. refresh', [k1, k2, kPaged].every((k) => buttons(k).every((b) => new TextEncoder().encode(b.callback_data).length <= 64)));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nTELEGRAM PAGES: ALL PASSED');
