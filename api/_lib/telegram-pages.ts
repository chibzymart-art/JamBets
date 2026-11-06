// Telegram bot prediction listing: turns fixture cards into numbered pages with
// inline page buttons (1, 2, 3 ... Prev / Next). Pure functions, no network.

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

/** "HIGH CONFIDENCE" -> "High Confidence". */
export function tierLabel(cat: string): string {
  return String(cat || '')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

export const PAGE_COMMANDS = ['today', 'tomorrow', 'bangers', 'toppicks', 'high', 'mid', 'low', 'goals'] as const;

export function pageTitle(cmd: string): string {
  switch (cmd) {
    case 'today': return "⚽ <b>Today's Predictions</b>";
    case 'tomorrow': return "⚽ <b>Tomorrow's Predictions</b>";
    case 'bangers': return '🔥 <b>Super Bankers</b> · 85%+';
    case 'toppicks': return '⭐ <b>Top Picks</b> · 90–95%';
    case 'high': return '🟢 <b>High Confidence</b> · 80–89%';
    case 'mid': return '🔵 <b>Mid Confidence</b> · 70–79%';
    case 'low': return '🟡 <b>Low Confidence Leans</b> · under 70%';
    case 'goals': return '⚡ <b>Goals Hub</b> · Over/Under &amp; BTTS';
    default: return '⚽ <b>Predictions</b>';
  }
}

function renderCard(item: TelegramFixtureCard, number: number, maxLeans: number): string {
  let s = `<b>${number}. ${escapeHtml(item.homeTeam)} vs ${escapeHtml(item.awayTeam)}</b>\n`;
  s += `🏆 ${escapeHtml(item.leagueCode)}  ·  ⏰ ${escapeHtml(item.kickoffTimeWat)}\n`;

  if (item.isBankerPass) {
    s += `🛡️ <i>No safe banker for this match</i>\n`;
    const lean = item.secondaryLeans[0];
    if (lean && maxLeans > 0) {
      s += `   ↳ Best lean: ${escapeHtml(pickLabel(lean.market, lean.prediction))} · <b>${lean.probability}%</b>\n`;
    }
  } else {
    s += `🎯 <b>${escapeHtml(pickLabel(item.primaryMarket, item.primaryPick))}</b>\n`;
    s += `📊 <b>${item.primaryProbability}%</b> · ${escapeHtml(tierLabel(item.primaryCategory))}\n`;
    for (const lean of item.secondaryLeans.slice(0, maxLeans)) {
      s += `   ↳ ${escapeHtml(pickLabel(lean.market, lean.prediction))} · ${lean.probability}%\n`;
    }
  }
  return s;
}

export function totalPages(count: number): number {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}

export function clampPage(page: number, count: number): number {
  const total = totalPages(count);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), total);
}

// Callback data (max 64 bytes): "pg|<cmd>|<YYYY-MM-DD>|<page>"; "pg|noop" for the current page.
export const NOOP_CALLBACK = 'pg|noop';

export function pageCallback(cmd: string, dateKey: string, page: number): string {
  return `pg|${cmd}|${dateKey}|${page}`;
}

export function parsePageCallback(data: string | undefined | null): { cmd: string; dateKey: string; page: number } | null {
  if (!data) return null;
  const m = String(data).match(/^pg\|([a-z]+)\|(\d{4}-\d{2}-\d{2})\|(\d{1,4})$/);
  if (!m || !(PAGE_COMMANDS as readonly string[]).includes(m[1])) return null;
  return { cmd: m[1], dateKey: m[2], page: Number(m[3]) };
}

/** Page buttons: numbers (current one marked), then Prev / Next. No keyboard for a single page. */
export function buildPager(cmd: string, dateKey: string, page: number, total: number): any | undefined {
  if (total <= 1) return undefined;

  let pages: number[];
  if (total <= 5) {
    pages = Array.from({ length: total }, (_, i) => i + 1);
  } else {
    // First, last, and a window of three around the current page.
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
    callback_data: p === page ? NOOP_CALLBACK : pageCallback(cmd, dateKey, p),
  }));

  const navRow: any[] = [];
  if (page > 1) navRow.push({ text: '‹ Prev', callback_data: pageCallback(cmd, dateKey, page - 1) });
  if (page < total) navRow.push({ text: 'Next ›', callback_data: pageCallback(cmd, dateKey, page + 1) });

  return { inline_keyboard: navRow.length ? [numberRow, navRow] : [numberRow] };
}

export function renderPredictionPage(opts: {
  cmd: string;
  displayDate: string;
  dateKey: string;
  cards: TelegramFixtureCard[];
  page: number;
}): { text: string; replyMarkup?: any; page: number; totalPages: number } {
  const { cmd, displayDate, dateKey, cards } = opts;
  const total = totalPages(cards.length);
  const page = clampPage(opts.page, cards.length);
  const startIdx = (page - 1) * PAGE_SIZE;
  const slice = cards.slice(startIdx, startIdx + PAGE_SIZE);
  const matchWord = cards.length === 1 ? 'match' : 'matches';

  const build = (maxLeans: number) => {
    let text = `${pageTitle(cmd)}\n`;
    text += `📅 ${escapeHtml(displayDate)}  ·  ${cards.length} ${matchWord}\n`;
    text += `${RULE}\n\n`;
    text += slice.map((c, i) => renderCard(c, startIdx + i + 1, maxLeans)).join('\n');
    text += `\n${RULE}\n`;
    text += `📄 Page <b>${page}</b> of <b>${total}</b>  ·  Times in WAT\n`;
    text += `/today · /tomorrow · /bangers · /toppicks · /goals`;
    return text;
  };

  // Long team names can push a page over Telegram's limit; drop extra leans if they do.
  let text = build(2);
  if (text.length > MAX_MESSAGE_CHARS) text = build(1);
  if (text.length > MAX_MESSAGE_CHARS) text = build(0);

  return { text, replyMarkup: buildPager(cmd, dateKey, page, total), page, totalPages: total };
}
