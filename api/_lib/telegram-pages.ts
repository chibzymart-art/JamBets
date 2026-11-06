// Telegram bot prediction lists: turns predictions into readable cards (every sub-prediction
// included), packs them into pages, and builds the tab and page buttons. Pure functions, no network.

export interface SecondaryLeanItem {
  market: string;
  prediction: string;
  probability: number;
  confidenceCategory: string;
  formattedMkt: string;
  formattedPick: string;
}

export interface TelegramFixtureCard {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  leagueCode: string;
  kickoffTimeWat: string;
  targetKickoffAt: string;
  isBankerPass: boolean;
  primaryMarket: string;
  primaryPick: string;
  primaryProbability: number;
  primaryCategory: string;
  secondaryLeans: SecondaryLeanItem[];
  maxProbability: number;
  hasBanger: boolean;
  hasTopPick: boolean;
  hasHigh: boolean;
  hasMid: boolean;
  hasLow: boolean;
  hasGoalLean: boolean;
}

// At most this many matches per page; fewer when cards are long.
export const PAGE_SIZE = 8;
// Telegram rejects messages over 4096 characters; stay well under it.
const MAX_MESSAGE_CHARS = 3900;
const RULE = '━━━━━━━━━━━━━━━━━━';

export function escapeHtml(str: any): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMarket(mkt: string): string {
  const m = (mkt || '').toLowerCase().trim();
  if (m === 'over_under_1.5') return 'Over/Under 1.5';
  if (m === 'over_under_2.5') return 'Over/Under 2.5';
  if (m === 'over_under_3.5') return 'Over/Under 3.5';
  if (m === 'over_under_4.5') return 'Over/Under 4.5';
  if (m === 'btts') return 'Both Teams to Score';
  if (m === 'double_chance') return 'Double Chance';
  if (m === 'moneyline' || m === '1x2') return 'Match Result (1X2)';
  if (m === 'home_goals_0.5') return 'Home Over 0.5';
  if (m === 'away_goals_0.5') return 'Away Over 0.5';
  if (m === 'home_goals_1.5') return 'Home Over 1.5';
  if (m === 'away_goals_1.5') return 'Away Over 1.5';
  if (m === '1h_goals_0.5' || m === 'ht_goals_0.5') return '1st Half Over 0.5';
  if (m === '1h_goals_1.5' || m === 'ht_goals_1.5') return '1st Half Over 1.5';
  if (m === '2h_goals_0.5') return '2nd Half Over 0.5';
  if (m === '2h_goals_1.5') return '2nd Half Over 1.5';
  if (m.startsWith('corners_')) return `Corners ${m.replace('corners_', '')}`;
  return (mkt || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function formatOutcome(pick: string, _market?: string): string {
  const p = (pick || '').toLowerCase().trim();
  if (p === 'over') return 'OVER';
  if (p === 'under') return 'UNDER';
  if (p === 'yes') return 'YES';
  if (p === 'no') return 'NO';
  if (p === '1') return 'Home Win (1)';
  if (p === '2') return 'Away Win (2)';
  if (p === 'x') return 'Draw (X)';
  if (p === '1x') return 'Home or Draw (1X)';
  if (p === 'x2') return 'Draw or Away (X2)';
  if (p === '12') return 'Home or Away (12)';
  return pick ? pick.toUpperCase() : '';
}

/** One short, readable label for a market + pick, e.g. "Over 2.5 Goals", "BTTS: Yes", "Home Win". */
export function pickLabel(market: string, pick: string): string {
  const m = (market || '').toLowerCase().trim();
  const p = (pick || '').toLowerCase().trim();
  const side = p === 'over' ? 'Over' : p === 'under' ? 'Under' : '';

  let mm = m.match(/^over_under_(\d+(?:\.\d+)?)$/);
  if (mm && side) return `${side} ${mm[1]} Goals`;

  mm = m.match(/^(home|away|1h|ht|2h)_goals_(\d+(?:\.\d+)?)$/);
  if (mm && side) {
    const prefix = { home: 'Home', away: 'Away', '1h': '1st Half', ht: '1st Half', '2h': '2nd Half' }[mm[1]];
    return `${prefix} ${side} ${mm[2]}`;
  }

  mm = m.match(/^corners_(\d+(?:\.\d+)?)$/);
  if (mm && side) return `Corners ${side} ${mm[1]}`;

  if (m === 'btts' && (p === 'yes' || p === 'no')) return `BTTS: ${p === 'yes' ? 'Yes' : 'No'}`;

  if (m === '1x2' || m === 'moneyline' || m === 'double_chance' || ['1', '2', 'x', '1x', 'x2', '12'].includes(p)) {
    const map: Record<string, string> = {
      '1': 'Home Win', '2': 'Away Win', x: 'Draw',
      '1x': 'Home or Draw (1X)', x2: 'Draw or Away (X2)', '12': 'Home or Away (12)',
    };
    if (map[p]) return map[p];
  }

  const outcome = formatOutcome(pick, market);
  const mkt = formatMarket(market);
  return mkt ? `${outcome} (${mkt})` : outcome;
}

/** "HIGH CONFIDENCE" / "GOAL_MACHINE" -> "High Confidence" / "Goal Machine". */
export function tierLabel(cat: string): string {
  return String(cat || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// ── Cards ────────────────────────────────────────────────────────────────────

export interface ListPick {
  label: string;
  probability: number; // 0-100
  tier?: string;
}

/** One match, ready to render. Text fields are raw (escaped at render time). */
export interface ListCard {
  title: string;
  league: string;
  kickoff: string; // HH:MM WAT
  main: ListPick | null; // null = no safe banker
  subs: ListPick[];
  note?: string;
  tiers: string[]; // normalized tiers across main + subs, used by the tier views
}

const MAX_SUBS = 6;

/** Football fixture card -> list card, with every sub-prediction. */
export function footballListCard(c: TelegramFixtureCard): ListCard {
  const subs = c.secondaryLeans.map(s => ({
    label: pickLabel(s.market, s.prediction),
    probability: s.probability,
    tier: s.confidenceCategory,
  }));
  return {
    title: `${c.homeTeam} vs ${c.awayTeam}`,
    league: c.leagueCode,
    kickoff: c.kickoffTimeWat,
    main: c.isBankerPass
      ? null
      : { label: pickLabel(c.primaryMarket, c.primaryPick), probability: c.primaryProbability, tier: c.primaryCategory },
    subs,
    tiers: [...(c.isBankerPass ? [] : [c.primaryCategory]), ...subs.map(s => s.tier || '')].filter(Boolean),
  };
}

export function renderCard(card: ListCard, number: number, maxSubs = MAX_SUBS): string {
  let s = `<b>${number}. ${escapeHtml(card.title)}</b>\n`;
  s += `🏆 ${escapeHtml(card.league)}  ·  ⏰ ${escapeHtml(card.kickoff)}\n`;

  if (card.main) {
    const tier = card.main.tier ? ` · ${escapeHtml(tierLabel(card.main.tier))}` : '';
    s += `🎯 <b>${escapeHtml(card.main.label)}</b> — <b>${card.main.probability}%</b>${tier}\n`;
  } else {
    s += `🛡️ <i>No safe banker — other picks below</i>\n`;
  }

  const subs = card.subs.slice(0, maxSubs);
  subs.forEach((p, i) => {
    const branch = i === subs.length - 1 ? '└' : '├';
    s += `   ${branch} ${escapeHtml(p.label)} · ${p.probability}%\n`;
  });
  if (card.note) s += `   <i>${escapeHtml(card.note)}</i>\n`;
  return s;
}

// ── Views (tabs) ─────────────────────────────────────────────────────────────

export interface ViewDef {
  title: string; // HTML
  tab?: string; // label on the tab bar; tier views have none
  empty: string; // used in "No <empty> found"
}

export const VIEWS: Record<string, ViewDef> = {
  football: { title: '⚽ <b>Football Predictions</b>', tab: '⚽ Football', empty: 'football predictions' },
  bangers: { title: '🔥 <b>Bangers</b> · 96%+', empty: 'Banger picks' },
  toppicks: { title: '⭐ <b>Top Picks</b> · 90–95%', empty: 'Top Picks' },
  high: { title: '🟢 <b>High Confidence</b> · 80–89%', empty: 'High Confidence picks' },
  mid: { title: '🔵 <b>Mid Confidence</b> · 70–79%', empty: 'Mid Confidence picks' },
  low: { title: '🟡 <b>Low Confidence Leans</b> · under 70%', empty: 'Low Confidence leans' },
  goals: { title: '🎯 <b>Over 2.5 Goals</b>', tab: '🎯 Over 2.5', empty: 'Over 2.5 Goals predictions' },
  ht05: { title: '⏱️ <b>1st Half Over 0.5 Goals</b>', tab: '⏱️ 1H 0.5', empty: '1st Half Over 0.5 predictions' },
  corners: { title: '🚩 <b>Corners</b>', tab: '🚩 Corners', empty: 'corners predictions' },
  basketball: { title: '🏀 <b>Basketball Predictions</b>', tab: '🏀 Basketball', empty: 'basketball predictions' },
  tennis: { title: '🎾 <b>Tennis Predictions</b>', tab: '🎾 Tennis', empty: 'tennis predictions' },
};

export const TIER_VIEWS: Record<string, string> = {
  bangers: 'BANGER',
  toppicks: 'TOP PICK',
  high: 'HIGH CONFIDENCE',
  mid: 'MID CONFIDENCE',
  low: 'LOW CONFIDENCE',
};

const TAB_ROWS: string[][] = [
  ['football', 'goals', 'ht05'],
  ['corners', 'basketball', 'tennis'],
];

export const PAGE_COMMANDS = Object.keys(VIEWS);

/** Typed command -> view and day (0 today, 1 tomorrow). null when it is not a list command. */
export function commandToView(command: string): { view: string; dayOffset: number } | null {
  const c = command.replace(/^\//, '').toLowerCase();
  if (c === 'today') return { view: 'football', dayOffset: 0 };
  if (c === 'tomorrow') return { view: 'football', dayOffset: 1 };
  if (c === 'top') return { view: 'toppicks', dayOffset: 0 };
  if (c === 'over25') return { view: 'goals', dayOffset: 0 };
  if (c === '1h' || c === 'firsthalf' || c === 'ht') return { view: 'ht05', dayOffset: 0 };
  if (c === 'football') return { view: 'football', dayOffset: 0 };
  if (VIEWS[c]) return { view: c, dayOffset: 0 };
  return null;
}

/** The bot's Telegram menu (setMyCommands). Every entry is a routed command. */
export const BOT_MENU: { command: string; description: string }[] = [
  { command: 'today', description: "Today's football predictions" },
  { command: 'tomorrow', description: "Tomorrow's football predictions" },
  { command: 'bangers', description: 'Bangers (96%+)' },
  { command: 'toppicks', description: 'Top Picks (90-95%)' },
  { command: 'high', description: 'High Confidence (80-89%)' },
  { command: 'mid', description: 'Mid Confidence (70-79%)' },
  { command: 'low', description: 'Low Confidence leans (under 70%)' },
  { command: 'goals', description: 'Over 2.5 Goals' },
  { command: 'ht05', description: '1st Half Over 0.5 Goals' },
  { command: 'corners', description: 'Corners predictions' },
  { command: 'basketball', description: 'Basketball predictions' },
  { command: 'tennis', description: 'Tennis predictions' },
  { command: 'status', description: 'Your subscription status' },
  { command: 'help', description: 'FAQs and all commands' },
];

/** The same list as HTML lines for /start and /help. */
export function commandListHtml(): string {
  return BOT_MENU.map(m => `• /${m.command} — ${escapeHtml(m.description)}`).join('\n');
}

export function filterForView(view: string, cards: ListCard[]): ListCard[] {
  const tier = TIER_VIEWS[view];
  return tier ? cards.filter(c => c.tiers.includes(tier)) : cards;
}

/** Which data set a view reads. Tier views read football. */
export function sourceForView(view: string): string {
  return TIER_VIEWS[view] ? 'football' : view;
}

// ── Pages and buttons ────────────────────────────────────────────────────────

// Callback data (max 64 bytes): "pg|<view>|<YYYY-MM-DD>|<page>"; "pg|noop" for the active tab/page.
export const NOOP_CALLBACK = 'pg|noop';

export function pageCallback(view: string, dateKey: string, page: number): string {
  return `pg|${view}|${dateKey}|${page}`;
}

export function parsePageCallback(data: string | undefined | null): { cmd: string; dateKey: string; page: number } | null {
  if (!data) return null;
  const m = String(data).match(/^pg\|([a-z0-9]+)\|(\d{4}-\d{2}-\d{2})\|(\d{1,4})$/);
  if (!m) return null;
  // Buttons sent before the tabs existed used "today"/"tomorrow".
  const cmd = m[1] === 'today' || m[1] === 'tomorrow' ? 'football' : m[1];
  if (!VIEWS[cmd]) return null;
  return { cmd, dateKey: m[2], page: Number(m[3]) };
}

/** Packs rendered cards into pages that fit one Telegram message. */
export function paginate(cardTexts: string[], budget: number, maxPerPage = PAGE_SIZE): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let size = 0;
  cardTexts.forEach((t, i) => {
    const len = t.length + 1;
    if (cur.length && (cur.length >= maxPerPage || size + len > budget)) {
      pages.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(i);
    size += len;
  });
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

function pagerRows(view: string, dateKey: string, page: number, total: number): any[][] {
  if (total <= 1) return [];

  let pages: number[];
  if (total <= 5) {
    pages = Array.from({ length: total }, (_, i) => i + 1);
  } else {
    let start = Math.max(1, page - 1);
    let end = Math.min(total, page + 1);
    if (page <= 2) end = 3;
    if (page >= total - 1) start = total - 2;
    const set = new Set<number>([1, total]);
    for (let p = start; p <= end; p++) set.add(p);
    pages = Array.from(set).sort((a, b) => a - b);
  }

  const numberRow = pages.map(p => ({
    text: p === page ? `· ${p} ·` : String(p),
    callback_data: p === page ? NOOP_CALLBACK : pageCallback(view, dateKey, p),
  }));
  const navRow: any[] = [];
  if (page > 1) navRow.push({ text: '‹ Prev', callback_data: pageCallback(view, dateKey, page - 1) });
  if (page < total) navRow.push({ text: 'Next ›', callback_data: pageCallback(view, dateKey, page + 1) });
  return navRow.length ? [numberRow, navRow] : [numberRow];
}

/** Page buttons only (no tabs). No keyboard for a single page. */
export function buildPager(view: string, dateKey: string, page: number, total: number): any | undefined {
  const rows = pagerRows(view, dateKey, page, total);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

/** Tab bar (sports/markets), day switch, then page buttons. */
export function buildKeyboard(opts: {
  view: string;
  dateKey: string;
  todayKey: string;
  tomorrowKey: string;
  page: number;
  totalPages: number;
}): any {
  const { view, dateKey, todayKey, tomorrowKey } = opts;
  const activeTab = TIER_VIEWS[view] ? 'football' : view;

  const tabRows = TAB_ROWS.map(row =>
    row.map(v => ({
      text: v === activeTab ? `• ${VIEWS[v].tab} •` : VIEWS[v].tab!,
      callback_data: v === view ? NOOP_CALLBACK : pageCallback(v, dateKey, 1),
    }))
  );

  const dayRow = [
    { key: todayKey, label: 'Today' },
    { key: tomorrowKey, label: 'Tomorrow' },
  ].map(d => ({
    text: d.key === dateKey ? `📅 ${d.label} ✓` : `📅 ${d.label}`,
    callback_data: d.key === dateKey ? NOOP_CALLBACK : pageCallback(view, d.key, 1),
  }));

  return { inline_keyboard: [...tabRows, dayRow, ...pagerRows(view, dateKey, opts.page, opts.totalPages)] };
}

export function totalPages(count: number): number {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}

export function renderListPage(opts: {
  view: string;
  displayDate: string;
  dateKey: string;
  todayKey: string;
  tomorrowKey: string;
  cards: ListCard[];
  page: number;
}): { text: string; replyMarkup: any; page: number; totalPages: number } {
  const { view, displayDate, dateKey, cards } = opts;
  const def = VIEWS[view] || VIEWS.football;
  const matchWord = cards.length === 1 ? 'match' : 'matches';

  const header = `${def.title}\n📅 ${escapeHtml(displayDate)}  ·  ${cards.length} ${matchWord}\n${RULE}\n\n`;
  const footerFor = (p: number, t: number) =>
    `\n${RULE}\n📄 Page <b>${p}</b> of <b>${t}</b>  ·  Times in WAT\nTap a tab below to switch sport or market.`;
  const budget = MAX_MESSAGE_CHARS - header.length - footerFor(9999, 9999).length;

  if (cards.length === 0) {
    const text = `${def.title}\n📅 ${escapeHtml(displayDate)}\n${RULE}\n\nNo ${escapeHtml(def.empty)} found for this day yet. Check back after the next simulation run, or tap another tab below.`;
    return {
      text,
      replyMarkup: buildKeyboard({ ...opts, page: 1, totalPages: 1 }),
      page: 1,
      totalPages: 1,
    };
  }

  // Render each card with all its sub-picks; trim sub-picks only if a single card is too long.
  const texts = cards.map((c, i) => {
    let t = renderCard(c, i + 1);
    for (let n = MAX_SUBS - 1; t.length > budget && n >= 0; n--) t = renderCard(c, i + 1, n);
    return t;
  });
  const pages = paginate(texts, budget);
  const total = pages.length;
  const page = Math.min(Math.max(1, Math.floor(Number.isFinite(opts.page) ? opts.page : 1)), total);

  const text = header + pages[page - 1].map(i => texts[i]).join('\n') + footerFor(page, total);
  return {
    text,
    replyMarkup: buildKeyboard({ ...opts, page, totalPages: total }),
    page,
    totalPages: total,
  };
}
