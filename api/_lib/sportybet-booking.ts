// SportyBet booking codes for Oddsbanta picks.
//
// A booking code is SportyBet's shareable betslip: it reserves the selections so a user can
// load them in the SportyBet app with one code. It stakes nothing and needs no account.
// SportyBet has no official API; this uses the same public endpoints its own website calls:
//   GET  /api/ng/factsCenter/pcUpcomingEvents   fixtures with markets and outcome ids
//   POST /api/ng/orders/share                    {selections:[{eventId,marketId,specifier,outcomeId}]}
// Never fabricate: a leg that can't be matched to an open SportyBet outcome is left out and
// reported, and if nothing books, no code is shown.

export const SPORTYBET_API = 'https://www.sportybet.com/api/ng';
export const MAX_LEGS = 50; // SportyBet rejects bigger slips

const HEADERS: Record<string, string> = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-GB,en;q=0.9',
  clientid: 'wap',
  platform: 'wap',
  'current-country': 'ng',
  origin: 'https://www.sportybet.com',
  referer: 'https://www.sportybet.com/ng/m/sport/football/today/',
  'user-agent':
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
};

// ── Our picks -> SportyBet markets ───────────────────────────────────────────

export interface MarketRef {
  marketId: string; // SportyBet / Sportradar market id
  specifier: string; // e.g. "total=2.5", "" when none
  outcome: string; // canonical outcome: home|draw|away|1x|x2|12|over|under|yes|no
}

// Standard Betradar ids, checked live on SportyBet NG (7 Nov 2026). Outcome descs: "Over 2.5", "Home or Draw", "Yes"...
const SB_MARKET = {
  result: '1',
  doubleChance: '10',
  total: '18',
  homeTotal: '19',
  awayTotal: '20',
  btts: '29',
  firstHalfTotal: '68',
  secondHalfTotal: '90',
  corners: '166',
};

/**
 * Turns one of our picks into a SportyBet market. Accepts raw database keys
 * (market "over_under_2.5" + pick "over", "over_2.5_goals", "1x2" + "1", "btts" + "yes",
 * "double_chance" + "1X", "ht_over_0.5_goals", "1h_goals_0.5" + "over") and display labels
 * ("Over 2.5 Goals", "1st Half Over 0.5 Goals", "Home Win", "BTTS: Yes", "Home or Draw (1X)").
 * Also team totals ("home_goals_0.5"), 2nd-half totals and corners totals. Returns null for anything
 * we don't book (scorers, cards, handicaps, other sports).
 */
export function toSportyMarket(market: string, pick: string): MarketRef | null {
  const m = String(market || '').toLowerCase().trim();
  const p = String(pick || '').toLowerCase().trim();
  const text = `${m} ${p}`.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  if (/card|scorer|booking|handicap|player|set |game|point|quarter|rebound|assist/.test(text)) return null;

  // "over_under_2.5" / "Over/Under 2.5" name the market, not the side: the side comes from the pick.
  const pickText = p.replace(/_/g, ' ');
  const sideText = /\b(over|under)\b/.test(pickText) ? pickText : text.replace(/over[\s/_-]*under/g, ' ');
  const side = /\bunder\b/.test(sideText) ? 'under' : /\bover\b/.test(sideText) ? 'over' : '';
  const line = text.match(/\b(\d+\.5)\b/);
  const firstHalf = /\b(1st half|first half|1h|ht)\b/.test(text);
  const secondHalf = /\b(2nd half|second half|2h)\b/.test(text);
  if (side && line) {
    const specifier = `total=${line[1]}`;
    if (/\bcorners?\b/.test(text)) return { marketId: SB_MARKET.corners, specifier, outcome: side };
    if (/\b(home goals|home team|home)\b/.test(text) && !firstHalf && !secondHalf) return { marketId: SB_MARKET.homeTotal, specifier, outcome: side };
    if (/\b(away goals|away team|away)\b/.test(text) && !firstHalf && !secondHalf) return { marketId: SB_MARKET.awayTotal, specifier, outcome: side };
    if (/\b(home|away)\b/.test(text)) return null; // half-time team totals aren't booked
    if (firstHalf) return { marketId: SB_MARKET.firstHalfTotal, specifier, outcome: side };
    if (secondHalf) return { marketId: SB_MARKET.secondHalfTotal, specifier, outcome: side };
    return { marketId: SB_MARKET.total, specifier, outcome: side };
  }
  if (/\bcorners?\b/.test(text)) return null;
  if (firstHalf || secondHalf) return null; // other half markets aren't booked

  if (/\b(btts|both teams|gg|ng)\b/.test(text)) {
    if (/\byes\b/.test(text)) return { marketId: SB_MARKET.btts, specifier: '', outcome: 'yes' };
    if (/\b(no|ng)\b/.test(text)) return { marketId: SB_MARKET.btts, specifier: '', outcome: 'no' };
    if (/\bgg\b/.test(text)) return { marketId: SB_MARKET.btts, specifier: '', outcome: 'yes' };
    return null;
  }

  const dc =
    /\b1x\b|home or draw|home\/draw/.test(text) ? '1x'
    : /\bx2\b|draw or away|away or draw|draw\/away/.test(text) ? 'x2'
    : /\b12\b|home or away/.test(text) ? '12'
    : '';
  if (dc) return { marketId: SB_MARKET.doubleChance, specifier: '', outcome: dc };

  if (/\b(1x2|moneyline|match result|full time result|win)\b/.test(text) || ['1', '2', 'x', 'home', 'away', 'draw'].includes(p)) {
    if (p === '1' || /\bhome( win)?\b/.test(text)) return { marketId: SB_MARKET.result, specifier: '', outcome: 'home' };
    if (p === '2' || /\baway( win)?\b/.test(text)) return { marketId: SB_MARKET.result, specifier: '', outcome: 'away' };
    if (p === 'x' || /\bdraw\b/.test(text)) return { marketId: SB_MARKET.result, specifier: '', outcome: 'draw' };
  }
  return null;
}

/** SportyBet outcome desc ("Home", "Over 2.5", "Home or Draw", "Yes") -> canonical outcome. */
export function canonicalOutcome(desc: string): string {
  const d = String(desc || '').toLowerCase().trim();
  if (d.startsWith('over')) return 'over';
  if (d.startsWith('under')) return 'under';
  if (d === 'home or draw' || d === '1x' || d === 'home/draw') return '1x';
  if (d === 'draw or away' || d === 'x2' || d === 'draw/away') return 'x2';
  if (d === 'home or away' || d === '12' || d === 'home/away') return '12';
  if (d === 'home' || d === '1') return 'home';
  if (d === 'draw' || d === 'x') return 'draw';
  if (d === 'away' || d === '2') return 'away';
  if (d === 'yes' || d === 'gg') return 'yes';
  if (d === 'no' || d === 'ng') return 'no';
  return d;
}

// ── Team matching ────────────────────────────────────────────────────────────

const NOISE = new Set([
  'fc', 'cf', 'sc', 'ac', 'afc', 'cd', 'ud', 'sd', 'sv', 'fk', 'sk', 'if', 'bk', 'ss', 'as', 'us', 'club',
  'de', 'del', 'la', 'le', 'the', 'and', 'town', 'calcio',
]);
const ALIASES: Record<string, string> = {
  man: 'manchester', manchester: 'manchester', utd: 'united', spurs: 'tottenham', wolves: 'wolverhampton',
  inter: 'internazionale', internazionale: 'internazionale', psg: 'paris', saint: 'st', st: 'st',
  munchen: 'munich', muenchen: 'munich', bayern: 'bayern', atletico: 'atletico', atl: 'atletico',
  gladbach: 'monchengladbach', monchengladbach: 'monchengladbach', nottm: 'nottingham', forest: 'forest',
  koebenhavn: 'copenhagen', kobenhavn: 'copenhagen', rennais: 'rennes', hamkam: 'hamarkameratene',
  lafc: 'losangelesfc', athletico: 'atletico',
};
// Whole-name aliases (after accents and punctuation are stripped), for clubs known by another name.
const NAME_ALIASES: Record<string, string> = {
  'paris saint germain': 'psg', 'paris sg': 'psg', 'paris st germain': 'psg',
  'los angeles fc': 'losangelesfc', 'los angeles football club': 'losangelesfc',
  'stade rennais': 'rennes', 'stade rennais fc': 'rennes',
  'internazionale milano': 'internazionale', 'inter milan': 'internazionale',
};

export function teamTokens(name: string): string[] {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const aliased = NAME_ALIASES[base] || base;
  const all = aliased.split(/\s+/).filter(Boolean).map(t => ALIASES[t] || t);
  const core = all.filter(t => !NOISE.has(t) && !/^\d+$/.test(t) && t.length > 1);
  return core.length ? core : all;
}

/** 0..1 similarity between two team names (token overlap, prefix-tolerant: "wolves" ~ "wolverhampton"). */
export function teamSimilarity(a: string, b: string): number {
  const ta = teamTokens(a);
  const tb = teamTokens(b);
  if (!ta.length || !tb.length) return 0;
  const joinedA = ta.join('');
  const joinedB = tb.join('');
  if (joinedA === joinedB) return 1;
  const same = (x: string, y: string) => x === y || (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y));
  const hits = ta.filter(x => tb.some(y => same(x, y))).length;
  const extraA = ta.some(x => !tb.some(y => same(x, y)));
  const extraB = tb.some(y => !ta.some(x => same(x, y)));
  // "Leicester" vs "Leicester City" is the same club; "Manchester City" vs "Manchester United"
  // (a different word on each side) is not.
  const score = hits / (extraA && extraB ? Math.max(ta.length, tb.length) : Math.min(ta.length, tb.length));
  if (score === 0 && (joinedA.includes(joinedB) || joinedB.includes(joinedA)) && Math.min(joinedA.length, joinedB.length) >= 4) return 0.8;
  return score;
}

// ── SportyBet feed ───────────────────────────────────────────────────────────

export interface SportyOutcome { id: string; desc: string; odds?: string; isActive?: number }
export interface SportyMarket { id: string; desc?: string; specifier?: string; status?: number; outcomes: SportyOutcome[] }
export interface SportyEvent {
  eventId: string;
  homeTeamName: string;
  awayTeamName: string;
  estimateStartTime: number; // epoch ms
  markets: SportyMarket[];
}

const FEED_MARKETS = Object.values(SB_MARKET);
const FEED_TTL_MS = 10 * 60 * 1000;
const TIMELINES = [24, 48, 72, 96, 120, 144, 168]; // hours; the only window pcUpcomingEvents honours
const feedCache = new Map<number, { at: number; events: SportyEvent[] }>();

function eventsFromPage(data: any): SportyEvent[] {
  const out: SportyEvent[] = [];
  for (const t of data?.tournaments || []) {
    for (const ev of t?.events || []) {
      if (!ev?.eventId) continue;
      out.push({
        eventId: String(ev.eventId),
        homeTeamName: String(ev.homeTeamName || ''),
        awayTeamName: String(ev.awayTeamName || ''),
        estimateStartTime: Number(ev.estimateStartTime) || 0,
        markets: (Array.isArray(ev.markets) ? ev.markets : []).map((m: any) => ({
          ...m,
          id: String(m?.id ?? ''),
          specifier: String(m?.specifier ?? m?.spec ?? ''),
          outcomes: Array.isArray(m?.outcomes) ? m.outcomes : [],
        })),
      });
    }
  }
  return out;
}

async function fetchJson(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<any> {
  const res = await fetchImpl(url, { ...init, headers: { ...HEADERS, ...(init.headers as any) } });
  if (!res.ok) throw new Error(`SportyBet HTTP ${res.status}`);
  return res.json();
}

/** Smallest SportyBet time window (hours from now) that reaches the latest kickoff. */
export function timelineFor(latestKickoffMs: number, now = Date.now()): number {
  const hours = Math.ceil((latestKickoffMs - now) / 3600e3) + 1;
  return TIMELINES.find(t => t >= hours) || TIMELINES[TIMELINES.length - 1];
}

/** Upcoming SportyBet football events (with the markets we book) within `timeline` hours. Cached 10 minutes. */
export async function loadSportyEvents(fetchImpl: typeof fetch = fetch, now = Date.now(), timeline = 24): Promise<SportyEvent[]> {
  const hit = feedCache.get(timeline);
  if (hit && now - hit.at < FEED_TTL_MS) return hit.events;
  const pageUrl = (n: number) =>
    `${SPORTYBET_API}/factsCenter/pcUpcomingEvents?sportId=sr:sport:1&marketId=${FEED_MARKETS.join(',')}&pageSize=100&pageNum=${n}&option=1&timeline=${timeline}`;
  const first = await fetchJson(pageUrl(1), {}, fetchImpl);
  if (first?.bizCode !== undefined && first.bizCode !== 10000) throw new Error(`SportyBet bizCode ${first.bizCode}`);
  const data = first?.data || {};
  const events = eventsFromPage(data);
  const total = Number(data.totalNum) || events.length;
  const pages = Math.min(20, Math.ceil(total / 100));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      fetchJson(pageUrl(i + 2), {}, fetchImpl).then(j => eventsFromPage(j?.data), () => [] as SportyEvent[])
    )
  );
  const seen = new Set<string>();
  const all: SportyEvent[] = [];
  for (const ev of [...events, ...rest.flat()]) {
    if (seen.has(ev.eventId)) continue;
    seen.add(ev.eventId);
    all.push(ev);
  }
  feedCache.set(timeline, { at: now, events: all });
  return all;
}

export function resetSportyCache(): void {
  feedCache.clear();
}

// ── Matching legs ────────────────────────────────────────────────────────────

export interface BookingLeg {
  home: string;
  away: string;
  kickoffIso: string;
  market: string;
  pick: string;
  label?: string; // for messages; defaults to market + pick
}

export interface Selection { eventId: string; marketId: string; specifier: string; outcomeId: string }

export interface ResolvedLeg { leg: BookingLeg; selection?: Selection; odds?: number; reason?: string }

const KICKOFF_TOLERANCE_MS = 20 * 60 * 1000;
export const MIN_TEAM_SCORE = 0.6;
export const STRONG_TEAM_SCORE = 0.8;

/**
 * Same kickoff (±20 min) and both team names agree, or one agrees strongly: a team can't play two
 * matches at once, so "Paris Saint Germain" vs "PSG" still matches when the opponent is clear.
 */
export function findEvent(leg: BookingLeg, events: SportyEvent[]): SportyEvent | null {
  const ko = Date.parse(leg.kickoffIso);
  let best: { ev: SportyEvent; score: number } | null = null;
  for (const ev of events) {
    if (!Number.isFinite(ko) || Math.abs(ev.estimateStartTime - ko) > KICKOFF_TOLERANCE_MS) continue;
    const h = teamSimilarity(leg.home, ev.homeTeamName);
    const a = teamSimilarity(leg.away, ev.awayTeamName);
    const both = h >= MIN_TEAM_SCORE && a >= MIN_TEAM_SCORE;
    const oneStrong = Math.max(h, a) >= STRONG_TEAM_SCORE;
    if (!both && !oneStrong) continue;
    const score = h + a;
    if (!best || score > best.score) best = { ev, score };
  }
  return best?.ev || null;
}

function isOpen(m: SportyMarket): boolean {
  return m.status === undefined || m.status === null || Number(m.status) === 0;
}

export function resolveLeg(leg: BookingLeg, events: SportyEvent[]): ResolvedLeg {
  const ref = toSportyMarket(leg.market, leg.pick);
  if (!ref) return { leg, reason: 'market not offered for booking' };
  const ev = findEvent(leg, events);
  if (!ev) return { leg, reason: 'match not found on SportyBet' };
  for (const m of ev.markets) {
    if (String(m.id) !== ref.marketId || String(m.specifier || '') !== ref.specifier || !isOpen(m)) continue;
    for (const o of m.outcomes || []) {
      if (o?.id === undefined || o.isActive === 0) continue;
      if (canonicalOutcome(o.desc) === ref.outcome) {
        return {
          leg,
          selection: { eventId: ev.eventId, marketId: ref.marketId, specifier: ref.specifier, outcomeId: String(o.id) },
          odds: Number(o.odds) || undefined,
        };
      }
    }
  }
  return { leg, reason: 'market closed on SportyBet' };
}

// ── Booking ──────────────────────────────────────────────────────────────────

export interface BookingResult {
  ok: boolean;
  code?: string;
  url?: string;
  booked: ResolvedLeg[];
  skipped: ResolvedLeg[];
  totalOdds?: number;
  error?: string;
}

export function shareUrlFor(code: string): string {
  return `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(code)}`;
}

/** POST the selections; returns the share code or throws. */
export async function createShareCode(selections: Selection[], fetchImpl: typeof fetch = fetch): Promise<{ code: string; url: string; unavailable: Set<string> }> {
  const json = await fetchJson(
    `${SPORTYBET_API}/orders/share`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selections }) },
    fetchImpl
  );
  const code = json?.data?.shareCode;
  if (json?.bizCode !== 10000 || !code) throw new Error(`SportyBet refused the slip (${json?.bizCode ?? 'no code'}${json?.message ? `: ${json.message}` : ''})`);
  // SportyBet lists suspended or dead legs here; they don't count as booked.
  const unavailable = new Set<string>(
    (Array.isArray(json.data.unavailableOutcomes) ? json.data.unavailableOutcomes : []).map((o: any) => String(o?.eventId ?? '')).filter(Boolean)
  );
  const url = String(json.data.shareURL || shareUrlFor(String(code))).replace(/^http:\/\//, 'https://');
  return { code: String(code), url, unavailable };
}

/**
 * Matches the legs to SportyBet and books them as one slip. Legs that kicked off, can't be
 * matched, or don't fit (over 50) are skipped and reported. If SportyBet refuses the slip,
 * it is retried once without legs whose markets may have just closed.
 */
export async function bookLegs(legs: BookingLeg[], fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<BookingResult> {
  const upcoming: BookingLeg[] = [];
  const skipped: ResolvedLeg[] = [];
  const seen = new Set<string>();
  for (const leg of legs) {
    const ko = Date.parse(leg.kickoffIso);
    if (Number.isFinite(ko) && ko <= now + 60 * 1000) {
      skipped.push({ leg, reason: 'already kicked off' });
      continue;
    }
    upcoming.push(leg);
  }
  if (!upcoming.length) return { ok: false, booked: [], skipped, error: 'No upcoming picks to book.' };
  const latest = Math.max(...upcoming.map(l => Date.parse(l.kickoffIso)).filter(Number.isFinite), now);
  const timeline = timelineFor(latest, now);

  let events: SportyEvent[];
  try {
    events = await loadSportyEvents(fetchImpl, now, timeline);
  } catch {
    return { ok: false, booked: [], skipped, error: 'SportyBet is not responding right now.' };
  }

  const booked: ResolvedLeg[] = [];
  for (const leg of upcoming) {
    const r = resolveLeg(leg, events);
    if (!r.selection) {
      skipped.push(r);
      continue;
    }
    // One selection per match: SportyBet won't take two outcomes of the same event.
    if (seen.has(r.selection.eventId)) {
      skipped.push({ leg, reason: 'second pick on the same match' });
      continue;
    }
    if (booked.length >= MAX_LEGS) {
      skipped.push({ leg, reason: `slip is full (${MAX_LEGS} picks max)` });
      continue;
    }
    seen.add(r.selection.eventId);
    booked.push(r);
  }
  if (!booked.length) return { ok: false, booked, skipped, error: 'None of these picks are on SportyBet right now.' };

  try {
    const { code, url, unavailable } = await createShareCode(booked.map(b => b.selection!), fetchImpl);
    return finish(code, url, unavailable, booked, skipped);
  } catch {
    // Retry once with a fresh feed: a market may have closed since it was cached.
    resetSportyCache();
    try {
      const fresh = await loadSportyEvents(fetchImpl, now, timeline);
      const again = booked.map(b => resolveLeg(b.leg, fresh));
      const ok = again.filter(r => r.selection);
      for (const r of again) if (!r.selection) skipped.push(r);
      if (!ok.length) return { ok: false, booked: [], skipped, error: 'SportyBet refused the slip. Please try again shortly.' };
      const { code, url, unavailable } = await createShareCode(ok.map(b => b.selection!), fetchImpl);
      return finish(code, url, unavailable, ok, skipped);
    } catch {
      return { ok: false, booked: [], skipped, error: 'SportyBet refused the slip. Please try again shortly.' };
    }
  }
}

function finish(code: string, url: string, unavailable: Set<string>, booked: ResolvedLeg[], skipped: ResolvedLeg[]): BookingResult {
  const live = booked.filter(b => !unavailable.has(b.selection!.eventId));
  for (const b of booked) if (unavailable.has(b.selection!.eventId)) skipped.push({ leg: b.leg, reason: 'suspended on SportyBet' });
  if (!live.length) return { ok: false, booked: [], skipped, error: 'Every pick is suspended on SportyBet right now.' };
  return { ok: true, code, url, booked: live, skipped, totalOdds: totalOdds(live) };
}

function totalOdds(legs: ResolvedLeg[]): number | undefined {
  if (!legs.length || legs.some(l => !l.odds)) return undefined;
  return Math.round(legs.reduce((acc, l) => acc * (l.odds as number), 1) * 100) / 100;
}

// ── Telegram helpers ─────────────────────────────────────────────────────────

/** Bot views whose main picks are football markets SportyBet can book. */
export const BOOKABLE_VIEWS = new Set(['football', 'bangers', 'toppicks', 'high', 'mid', 'low', 'goals', 'ht05', 'corners']);

export const BOOK_CALLBACK_PREFIX = 'bk|';

export function bookCallback(view: string, dateKey: string): string {
  return `${BOOK_CALLBACK_PREFIX}${view}|${dateKey}`;
}

export function parseBookCallback(data: string | undefined): { view: string; dateKey: string } | null {
  const m = String(data || '').match(/^bk\|([a-z0-9]+)\|(\d{4}-\d{2}-\d{2})$/);
  if (!m || !BOOKABLE_VIEWS.has(m[1])) return null;
  return { view: m[1], dateKey: m[2] };
}

/** Bot list cards -> booking legs (main pick of each match). Card kickoff is "HH:MM" Lagos time. */
export function legsFromCards(
  cards: { title: string; kickoff: string; main: { label: string; result?: string } | null }[],
  dateKey: string
): BookingLeg[] {
  const legs: BookingLeg[] = [];
  for (const c of cards) {
    if (!c.main || (c.main.result && c.main.result !== 'pending')) continue;
    const parts = String(c.title || '').split(' vs ');
    const hhmm = String(c.kickoff || '').match(/^(\d{2}):(\d{2})$/);
    if (parts.length !== 2 || !hhmm) continue;
    legs.push({
      home: parts[0].trim(),
      away: parts[1].trim(),
      kickoffIso: `${dateKey}T${hhmm[1]}:${hhmm[2]}:00+01:00`,
      market: c.main.label,
      pick: '',
      label: c.main.label,
    });
  }
  return legs;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The bot's reply for a booking attempt (Telegram HTML). */
export function renderBookingMessage(result: BookingResult, title: string, displayDate: string): string {
  if (!result.ok || !result.code) {
    return `🎟 <b>SportyBet booking: ${esc(title)}</b>\n📅 ${esc(displayDate)}\n\n⚠️ ${esc(result.error || 'Could not create a booking code.')}`;
  }
  const lines = [
    `🎟 <b>SportyBet booking code</b>`,
    `<b>${esc(title)}</b> · ${esc(displayDate)}`,
    '',
    `Code: <code>${esc(result.code)}</code>`,
    `${result.booked.length} pick${result.booked.length === 1 ? '' : 's'} booked${result.totalOdds ? ` · total odds ${result.totalOdds.toFixed(2)}` : ''}`,
    `👉 <a href="${esc(result.url || shareUrlFor(result.code))}">Open the slip on SportyBet</a>`,
  ];
  const notOn = result.skipped.filter(s => s.reason && s.reason !== 'already kicked off');
  const started = result.skipped.length - notOn.length;
  if (notOn.length) {
    lines.push('', `Not included (${notOn.length}):`);
    for (const s of notOn.slice(0, 10)) lines.push(`• ${esc(`${s.leg.home} vs ${s.leg.away}`)}: ${esc(s.reason!)}`);
    if (notOn.length > 10) lines.push(`• …and ${notOn.length - 10} more`);
  }
  if (started) lines.push('', `${started} match${started === 1 ? '' : 'es'} already started and ${started === 1 ? 'was' : 'were'} left out.`);
  lines.push('', '<i>Enter the code in SportyBet → Load booking code. It works until the first match kicks off. 18+ · Bet responsibly.</i>');
  return lines.join('\n');
}

// Short-lived cache so a busy list doesn't hit SportyBet once per tap.
const CODE_TTL_MS = 5 * 60 * 1000;
const codeCache = new Map<string, { at: number; result: BookingResult }>();

export async function bookLegsCached(key: string, legs: BookingLeg[], fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<BookingResult> {
  const hit = codeCache.get(key);
  if (hit && now - hit.at < CODE_TTL_MS && hit.result.ok) return hit.result;
  const result = await bookLegs(legs, fetchImpl, now);
  if (result.ok) codeCache.set(key, { at: now, result });
  if (codeCache.size > 200) codeCache.delete(codeCache.keys().next().value as string);
  return result;
}

export function resetBookingCaches(): void {
  codeCache.clear();
  feedCache.clear();
}
