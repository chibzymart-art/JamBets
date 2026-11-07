import {
  type SecondaryLeanItem,
  type TelegramFixtureCard,
  type ListCard,
  formatMarket,
  formatOutcome,
  footballListCard,
  renderListPage,
  parsePageCallback,
  commandToView,
  commandListHtml,
  filterForView,
  sourceForView,
  NOOP_CALLBACK,
  normalizeResult,
  parseDateArg,
  daysBetween,
  MIN_DAY_OFFSET,
  MAX_DAY_OFFSET,
  VIEWS,
} from './_lib/telegram-pages';
import {
  BOOKABLE_VIEWS,
  bookCallback,
  parseBookCallback,
  legsFromCards,
  bookLegsCached,
  renderBookingMessage,
  bookingEnabled,
} from './_lib/sportybet-booking';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

// Universal Admin email list for direct Telegram fallback access
const ADMIN_EMAILS = [
  'chibzymart@gmail.com',
  'whizzchibz@gmail.com',
  'chibuezec.amuchie@gmail.com',
  'nnamdiamuchie@gmail.com'
];

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    date: number;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    message?: { message_id: number; chat: { id: number; type: string } };
    data?: string;
  };
}

function escapeHtml(str: any): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendTelegramMessage(chatId: number, htmlText: string, replyMarkup?: any) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured.');
    return;
  }
  try {
    const payload: any = {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('Telegram HTML sendMessage failed, trying plain text fallback:', res.status, errText);
      // Fallback: strip HTML tags so message is NEVER lost
      const plainText = htmlText.replace(/<[^>]+>/g, '');
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: plainText,
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
    }
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
  }
}

// Replaces the text (and page buttons) of a message the bot already sent. Used for page turns.
async function editTelegramMessage(chatId: number, messageId: number, htmlText: string, replyMarkup?: any) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const base: any = { chat_id: chatId, message_id: messageId, disable_web_page_preview: true };
    if (replyMarkup) base.reply_markup = replyMarkup;
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, text: htmlText, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (/message is not modified/i.test(errText)) return;
      console.error('Telegram HTML editMessageText failed, trying plain text fallback:', res.status, errText);
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, text: htmlText.replace(/<[^>]+>/g, '') }),
      });
    }
  } catch (err) {
    console.error('Failed to edit Telegram message:', err);
  }
}

// Stops the loading spinner on a pressed inline button.
async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
    });
  } catch (err) {
    console.error('Failed to answer Telegram callback query:', err);
  }
}

async function getLinkedUser(chatId: number): Promise<any | null> {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?telegram_chat_id=eq.${chatId}&select=id,email,role,is_deleted&limit=1`,
    { headers }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

// Tiers that unlock bot picks. 'free' (every new account) and anything unknown do not.
const PAID_TIERS = ['standard', 'bigbang', 'pro', 'premium', 'admin', 'vip'];

async function isUserPaidOrAdmin(user: any): Promise<{ isPaid: boolean; tier: string }> {
  if (!user) return { isPaid: false, tier: 'unlinked' };
  const email = (user.email || '').toLowerCase().trim();

  // 1. Any account with role 'admin' or in universal admin email list has 100% full VIP access
  if (user.role === 'admin' || ADMIN_EMAILS.includes(email)) {
    return { isPaid: true, tier: 'Admin VIP' };
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // 2. Check active entitlements
  const entRes = await fetch(
    `${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${user.id}&select=tier,valid_until,features&limit=1`,
    { headers }
  );
  if (entRes.ok) {
    const entData = await entRes.json();
    if (Array.isArray(entData) && entData.length > 0) {
      const ent = entData[0];
      const validUntil = ent.valid_until ? new Date(ent.valid_until).getTime() : Infinity;
      if (validUntil > Date.now() && PAID_TIERS.includes(String(ent.tier || '').toLowerCase())) {
        return { isPaid: true, tier: ent.tier.toUpperCase() };
      }
      if (ent.tier === 'admin' || (ent.features && ent.features.admin === true)) {
        return { isPaid: true, tier: 'ADMIN VIP' };
      }
    }
  }

  // 3. Check active subscriptions. Only paid tiers count, and only until their period ends:
  //    every free account also has an "active" subscription row with tier 'free'.
  const subRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&status=eq.active&tier=in.(${PAID_TIERS.join(',')})&select=tier,current_period_end&order=created_at.desc&limit=5`,
    { headers }
  );
  if (subRes.ok) {
    const subData = await subRes.json();
    const live = Array.isArray(subData)
      ? subData.find((s: any) => PAID_TIERS.includes(String(s.tier || '').toLowerCase())
          && (!s.current_period_end || new Date(s.current_period_end).getTime() > Date.now()))
      : null;
    if (live) {
      return { isPaid: true, tier: String(live.tier).toUpperCase() };
    }
  }

  return { isPaid: false, tier: 'Free' };
}

async function linkUserByToken(chatId: number, username: string | undefined, token: string): Promise<{ success: boolean; email?: string; error?: string }> {
  if (!SUPABASE_SERVICE_ROLE_KEY) return { success: false, error: 'Database service unavailable.' };
  const cleanToken = token.trim().toUpperCase();

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  const nowIso = new Date().toISOString();
  const searchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?telegram_auth_token=eq.${cleanToken}&telegram_auth_expires_at=gt.${nowIso}&select=id,email&limit=1`,
    { headers }
  );
  if (!searchRes.ok) return { success: false, error: 'Token verification failed.' };

  const users = await searchRes.json();
  if (!Array.isArray(users) || users.length === 0) {
    return { success: false, error: 'Invalid or expired code. Please generate a new code on Oddsbanta.' };
  }

  const user = users[0];

  const updateRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        telegram_chat_id: String(chatId),
        telegram_username: username || null,
        telegram_auth_token: null,
      }),
    }
  );

  if (!updateRes.ok) {
    return { success: false, error: 'Failed to record connection in database.' };
  }

  return { success: true, email: user.email };
}

// ── Prediction listing (paged) ────────────────────────────────────────────────

function normalizeProbability(val: any): number {
  const n = parseFloat(val) || 0;
  return n <= 1 && n > 0 ? Math.round(n * 100) : Math.round(n);
}

function normalizeCategory(cat: any, prob: number): string {
  const c = String(cat || '').toUpperCase().replace(/_/g, ' ').trim();
  if (c === 'BANGER' || c === 'SUPER BANKER' || prob >= 96) return 'BANGER';
  if (c === 'TOP PICK' || (prob >= 90 && prob < 96)) return 'TOP PICK';
  if (c === 'HIGH CONFIDENCE' || (prob >= 80 && prob < 90)) return 'HIGH CONFIDENCE';
  if (c === 'MID CONFIDENCE' || (prob >= 70 && prob < 80)) return 'MID CONFIDENCE';
  if (c === 'LOW CONFIDENCE' || (prob > 0 && prob < 70)) return 'LOW CONFIDENCE';
  return 'CONSENSUS';
}

function getLagosDateBoundaries(offsetDays: number = 0): { startUtc: string; endUtc: string; lagosDateStr: string; displayDate: string } {
  const now = new Date();
  const lagosTodayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const [y, m, d] = lagosTodayStr.split('-').map(Number);
  const startUtcDate = new Date(Date.UTC(y, m - 1, d + offsetDays, -1, 0, 0, 0));
  const endUtcDate = new Date(Date.UTC(y, m - 1, d + offsetDays, 22, 59, 59, 999));

  const targetDateObj = new Date(Date.UTC(y, m - 1, d + offsetDays, 12, 0, 0));
  const targetLagosStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(targetDateObj);

  const displayDate = targetDateObj.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });

  return {
    startUtc: startUtcDate.toISOString(),
    endUtc: endUtcDate.toISOString(),
    lagosDateStr: targetLagosStr,
    displayDate,
  };
}

/** Days from today's Lagos date to a YYYY-MM-DD Lagos date (0 = today, 1 = tomorrow). */
function lagosOffsetForDateKey(dateKey: string): number {
  const today = getLagosDateBoundaries(0).lagosDateStr;
  const [ty, tm, td] = today.split('-').map(Number);
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 864e5);
}

// Same gate messages as before; used for typed commands and page buttons alike.
const LINK_REQUIRED_MESSAGE =
  `🔒 <b>Authentication Required</b>\n\n` +
  `Please link your Oddsbanta account first to pull predictions.\n\n` +
  `1. Sign in at <a href="https://www.oddsbanta.com/dashboard">Oddsbanta</a>\n` +
  `2. Click <b>Connect Telegram VIP Bot</b>\n` +
  `3. Enter the code here: <code>/link YOUR_CODE</code>`;

const VIP_REQUIRED_MESSAGE =
  `🔒 <b>VIP Access Required</b>\n\n` +
  `Your account is currently on the <b>Free Tier</b>.\n` +
  `To unlock live predictions directly in Telegram, upgrade your plan:\n\n` +
  `👉 <a href="https://www.oddsbanta.com/subscription">Upgrade to VIP (₦5,000/mo)</a>`;

/** "FT 2-1" once a football match has a score; "Live 1-0" while it is in play. */
function footballScoreLine(actualScore: any, f: any): string | undefined {
  const status = String(f?.status || '').toLowerCase();
  const hs = f?.home_score, as = f?.away_score;
  const fromFixture = hs != null && as != null ? `${hs}-${as}` : '';
  const score = String(actualScore || '').trim() || fromFixture;
  if (!score) return undefined;
  if (['live', 'in_play', '1h', '2h', 'ht', 'halftime'].includes(status)) return `Live ${fromFixture || score}`;
  if (['postponed', 'cancelled', 'abandoned'].includes(status)) return status.charAt(0).toUpperCase() + status.slice(1);
  const ht = f?.half_time_home_score != null && f?.half_time_away_score != null ? ` · HT ${f.half_time_home_score}-${f.half_time_away_score}` : '';
  return `FT ${score}${ht}`;
}

/** Loads one WAT day of published predictions as one card per fixture. null on a database error. */
async function loadFixtureCards(dateRange: { startUtc: string; endUtc: string }): Promise<TelegramFixtureCard[] | null> {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  const selectFields = encodeURIComponent(
    'id,fixture_id,prediction,market,probability,confidence_category,secondary_predictions,target_kickoff_at,settlement_status,actual_score,fixture:football_fixtures!inner(id,target_kickoff_at,status,home_score,away_score,half_time_home_score,half_time_away_score,home_team:football_teams!football_fixtures_home_team_id_fkey(name),away_team:football_teams!football_fixtures_away_team_id_fkey(name),league:football_leagues!inner(code,name,country))'
  );

  const andFilter = encodeURIComponent(`(target_kickoff_at.gte.${dateRange.startUtc},target_kickoff_at.lte.${dateRange.endUtc})`);
  const queryUrl = `${SUPABASE_URL}/rest/v1/football_predictions?select=${selectFields}&publication_status=eq.published&and=${andFilter}&order=target_kickoff_at.asc,id.asc&limit=200`;

  const res = await fetch(queryUrl, { headers });
  if (!res.ok) return null;

  const rawPreds: any[] = await res.json();
  if (!Array.isArray(rawPreds)) return [];

  // Group into 1 fixture = 1 card
  const fixtureCards: TelegramFixtureCard[] = [];

  for (const p of rawPreds) {
    const f = p.fixture;
    const home = f?.home_team?.name?.replace(/-/g, ' ') || 'Home';
    const away = f?.away_team?.name?.replace(/-/g, ' ') || 'Away';
    const league = f?.league?.code || f?.league?.name || 'League';
    const kickoffIso = p.target_kickoff_at || f?.target_kickoff_at;
    const kickoffWat = new Date(kickoffIso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Lagos',
    });

    const rawMkt = String(p.market || '').trim();
    const rawPred = String(p.prediction || '').trim();
    const rawCat = String(p.confidence_category || '').trim();
    const isPass =
      !rawPred ||
      rawPred.toUpperCase() === 'SKIP' ||
      rawMkt.toUpperCase() === 'NO_SAFE_BANKER' ||
      rawCat.toUpperCase() === 'NO_SAFE_BANKER' ||
      rawCat.toUpperCase() === 'NO SAFE BANKER';

    const primProb = normalizeProbability(p.probability);
    const primCat = isPass ? 'NO SAFE BANKER' : normalizeCategory(p.confidence_category, primProb);

    let sec = p.secondary_predictions;
    if (typeof sec === 'string') {
      try {
        sec = JSON.parse(sec);
      } catch {
        sec = [];
      }
    }

    const secondaryLeans: SecondaryLeanItem[] = [];
    if (Array.isArray(sec)) {
      for (const s of sec) {
        const sProb = normalizeProbability(s.probability || s.prob);
        const sPred = String(s.prediction || '').trim();
        const sMkt = String(s.market || '').trim();
        const sCat = normalizeCategory(s.confidence_tier || s.tier, sProb);
        if (sPred && sMkt && sPred.toUpperCase() !== 'SKIP' && sMkt.toUpperCase() !== 'NO_SAFE_BANKER') {
          secondaryLeans.push({
            market: sMkt,
            prediction: sPred,
            probability: sProb,
            confidenceCategory: sCat,
            formattedMkt: formatMarket(sMkt),
            formattedPick: formatOutcome(sPred, sMkt),
            result: s.settlement_status ? normalizeResult(s.settlement_status) : undefined,
          });
        }
      }
    }
    secondaryLeans.sort((a, b) => b.probability - a.probability);

    let maxProb = isPass ? 0 : primProb;
    for (const s of secondaryLeans) {
      if (s.probability > maxProb) maxProb = s.probability;
    }

    const isGoalMatch = (m: string, pr: string) => {
      const ml = m.toLowerCase();
      const pl = pr.toLowerCase();
      return (
        ml.includes('over') ||
        ml.includes('under') ||
        ml.includes('goal') ||
        ml.includes('btts') ||
        pl.includes('over') ||
        pl.includes('under') ||
        pl.includes('goal')
      );
    };

    const hasBanger = (!isPass && (primCat === 'BANGER' || primProb >= 85)) || secondaryLeans.some(s => s.confidenceCategory === 'BANGER' || s.probability >= 85);
    const hasTopPick = (!isPass && (primCat === 'TOP PICK' || (primProb >= 90 && primProb < 96))) || secondaryLeans.some(s => s.confidenceCategory === 'TOP PICK' || (s.probability >= 90 && s.probability < 96));
    const hasHigh = (!isPass && (primCat === 'HIGH CONFIDENCE' || (primProb >= 80 && primProb < 90))) || secondaryLeans.some(s => s.confidenceCategory === 'HIGH CONFIDENCE' || (s.probability >= 80 && s.probability < 90));
    const hasMid = (!isPass && (primCat === 'MID CONFIDENCE' || (primProb >= 70 && primProb < 80))) || secondaryLeans.some(s => s.confidenceCategory === 'MID CONFIDENCE' || (s.probability >= 70 && s.probability < 80));
    const hasLow = (!isPass && (primCat === 'LOW CONFIDENCE' || (primProb > 0 && primProb < 70))) || secondaryLeans.some(s => s.confidenceCategory === 'LOW CONFIDENCE' || (s.probability > 0 && s.probability < 70));
    const hasGoalLean = (!isPass && isGoalMatch(rawMkt, rawPred)) || secondaryLeans.some(s => isGoalMatch(s.market, s.prediction));

    fixtureCards.push({
      fixtureId: p.fixture_id || f?.id,
      homeTeam: home,
      awayTeam: away,
      leagueCode: league,
      kickoffTimeWat: kickoffWat,
      targetKickoffAt: kickoffIso,
      isBankerPass: isPass,
      primaryMarket: rawMkt,
      primaryPick: rawPred,
      primaryProbability: primProb,
      primaryCategory: primCat,
      secondaryLeans,
      maxProbability: maxProb,
      hasBanger,
      hasTopPick,
      hasHigh,
      hasMid,
      hasLow,
      hasGoalLean,
      primaryResult: isPass ? undefined : normalizeResult(p.settlement_status),
      scoreLine: footballScoreLine(p.actual_score, f),
    });
  }

  return fixtureCards;
}

function watTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
}

function serviceHeaders() {
  return { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
}

function dayFilter(range: { startUtc: string; endUtc: string }): string {
  return `and=${encodeURIComponent(`(target_kickoff_at.gte.${range.startUtc},target_kickoff_at.lte.${range.endUtc})`)}`;
}

async function fetchRows(table: string, select: string, range: { startUtc: string; endUtc: string }, extra = ''): Promise<any[] | null> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&publication_status=eq.published&${dayFilter(range)}${extra}&order=target_kickoff_at.asc,id.asc&limit=500`;
  const res = await fetch(url, { headers: serviceHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function parseJsonArray(v: any): any[] {
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v : [];
}

const FOOTBALL_FIXTURE_JOIN =
  'fixture:football_fixtures!inner(id,target_kickoff_at,home_team:football_teams!football_fixtures_home_team_id_fkey(name),away_team:football_teams!football_fixtures_away_team_id_fkey(name),league:football_leagues(code,name))';

const GOALS_LABELS: Record<string, string> = {
  'over_2.5_goals': 'Over 2.5 Goals',
  'ht_over_0.5_goals': '1st Half Over 0.5 Goals',
};

/** Over 2.5 / 1st-half 0.5 goals (goals_predictions). The other goals market for the same match is a sub-pick. */
async function loadGoalsCards(range: { startUtc: string; endUtc: string }, market: string): Promise<ListCard[] | null> {
  const rows = await fetchRows(
    'goals_predictions',
    `id,fixture_id,market,probability,confidence_tier,xg_combined,target_kickoff_at,settlement_status,actual_score,ht_score,${FOOTBALL_FIXTURE_JOIN}`,
    range,
    '&settlement_status=neq.void'
  );
  if (!rows) return null;
  const byFixture = new Map<string, any[]>();
  for (const r of rows) {
    const list = byFixture.get(r.fixture_id) || [];
    list.push(r);
    byFixture.set(r.fixture_id, list);
  }
  return rows
    .filter(r => r.market === market)
    .map(r => {
      const f = r.fixture || {};
      const others = (byFixture.get(r.fixture_id) || []).filter(o => o.market !== market && GOALS_LABELS[o.market]);
      const xg = Number(r.xg_combined);
      return {
        title: `${(f.home_team?.name || 'Home').replace(/-/g, ' ')} vs ${(f.away_team?.name || 'Away').replace(/-/g, ' ')}`,
        league: f.league?.code || f.league?.name || 'League',
        kickoff: watTime(r.target_kickoff_at || f.target_kickoff_at),
        main: { label: GOALS_LABELS[market], probability: normalizeProbability(r.probability), tier: r.confidence_tier || undefined, result: normalizeResult(r.settlement_status) },
        subs: others.map(o => ({ label: GOALS_LABELS[o.market], probability: normalizeProbability(o.probability), tier: o.confidence_tier || undefined, result: normalizeResult(o.settlement_status) })),
        score: [r.actual_score ? `FT ${r.actual_score}` : '', r.ht_score ? `HT ${r.ht_score}` : ''].filter(Boolean).join(' · ') || undefined,
        note: Number.isFinite(xg) && xg > 0 ? `Expected goals (xG): ${xg.toFixed(2)}` : undefined,
        tiers: [],
      };
    });
}

/** "Corners: 6 (4H - 2A)" from actual_corners such as "6 corners (4H - 2A)"; nothing for "N/A" etc. */
function cornersScoreLine(actual: any): string | undefined {
  const t = String(actual ?? '').trim();
  const m = t.match(/^(\d+)\s*(?:corners?)?\s*(.*)$/i);
  if (!m) return undefined;
  return `Corners: ${m[1]}${m[2] ? ` ${m[2].trim()}` : ''}`;
}

/** Corners (corner_predictions). The other corner lines' probabilities are sub-picks. */
async function loadCornerCards(range: { startUtc: string; endUtc: string }): Promise<ListCard[] | null> {
  const rows = await fetchRows(
    'corner_predictions',
    `id,fixture_id,market,prediction,probability,confidence_category,predicted_total_corners,over_8_5_prob,over_9_5_prob,over_10_5_prob,target_kickoff_at,settlement_status,actual_corners,${FOOTBALL_FIXTURE_JOIN}`,
    range,
    '&settlement_status=neq.void'
  );
  if (!rows) return null;
  return rows.map(r => {
    const f = r.fixture || {};
    const mainLabel = String(r.prediction || formatMarket(r.market || '')).trim();
    const lines: [string, any][] = [['Over 8.5 Corners', r.over_8_5_prob], ['Over 9.5 Corners', r.over_9_5_prob], ['Over 10.5 Corners', r.over_10_5_prob]];
    const subs = lines
      .filter(([label, v]) => v != null && Number(v) > 0 && label.toLowerCase() !== mainLabel.toLowerCase())
      .map(([label, v]) => ({ label, probability: normalizeProbability(v) }));
    const total = Number(r.predicted_total_corners);
    return {
      title: `${(f.home_team?.name || 'Home').replace(/-/g, ' ')} vs ${(f.away_team?.name || 'Away').replace(/-/g, ' ')}`,
      league: f.league?.code || f.league?.name || 'League',
      kickoff: watTime(r.target_kickoff_at || f.target_kickoff_at),
      main: { label: mainLabel, probability: normalizeProbability(r.probability), tier: r.confidence_category || undefined, result: normalizeResult(r.settlement_status) },
      subs,
      score: cornersScoreLine(r.actual_corners),
      note: Number.isFinite(total) && total > 0 ? `Expected corners: ${total.toFixed(1)}` : undefined,
      tiers: [],
    };
  });
}

function isNoBanker(market: any, prediction: any, category: any): boolean {
  const m = String(market || '').toUpperCase();
  const c = String(category || '').toUpperCase().replace(/_/g, ' ');
  return !prediction || m === 'NO_SAFE_BANKER' || c === 'NO SAFE BANKER' || String(prediction).toUpperCase().startsWith('NO SAFE BANKER');
}

function subPicksFrom(secondary: any): { label: string; probability: number; tier?: string }[] {
  return parseJsonArray(secondary)
    .map((s: any) => ({
      label: String(s.prediction || s.pick || '').trim(),
      probability: normalizeProbability(s.probability ?? s.prob),
      tier: s.confidence_category || s.tier || undefined,
      result: s.settlement_status ? normalizeResult(s.settlement_status) : undefined,
    }))
    .filter(s => s.label && s.label.toUpperCase() !== 'SKIP')
    .sort((a, b) => b.probability - a.probability);
}

/** Basketball (basketball_predictions): main pick plus every secondary market. */
async function loadBasketballCards(range: { startUtc: string; endUtc: string }): Promise<ListCard[] | null> {
  const rows = await fetchRows(
    'basketball_predictions',
    'id,market,prediction,probability,confidence_category,secondary_predictions,target_kickoff_at,settlement_status,actual_result,fixture:basketball_fixtures(target_kickoff_at,status,home_score,away_score,league:basketball_leagues(code,name),home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(canonical_name,short_name),away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(canonical_name,short_name))',
    range
  );
  if (!rows) return null;
  return rows.map(r => {
    const f = r.fixture || {};
    const pass = isNoBanker(r.market, r.prediction, r.confidence_category);
    return {
      title: `${f.home_team?.canonical_name || f.home_team?.short_name || 'Home'} vs ${f.away_team?.canonical_name || f.away_team?.short_name || 'Away'}`,
      league: f.league?.name || f.league?.code || 'League',
      kickoff: watTime(r.target_kickoff_at || f.target_kickoff_at),
      main: pass ? null : { label: String(r.prediction), probability: normalizeProbability(r.probability), tier: r.confidence_category || undefined, result: normalizeResult(r.settlement_status) },
      subs: subPicksFrom(r.secondary_predictions),
      score: String(r.actual_result || '').trim()
        || (f.home_score != null && f.away_score != null && (Number(f.home_score) > 0 || Number(f.away_score) > 0) ? `FT ${f.home_score}-${f.away_score}` : '')
        || undefined,
      tiers: [],
    };
  });
}

/** "Sets 2-0 (6-4, 6-3)" once a tennis match has a score. */
function tennisScoreLine(f: any): string | undefined {
  const a = f?.score_p1_sets, b = f?.score_p2_sets;
  if (a == null || b == null || (Number(a) === 0 && Number(b) === 0)) return undefined;
  let sets = '';
  const raw = parseJsonArray(f?.set_scores);
  if (raw.length) {
    sets = raw
      .map((x: any) => (Array.isArray(x) ? `${x[0]}-${x[1]}` : x && typeof x === 'object' ? `${x.p1 ?? x.player1 ?? x[0] ?? '?'}-${x.p2 ?? x.player2 ?? x[1] ?? '?'}` : String(x)))
      .join(', ');
  } else if (typeof f?.set_scores === 'string' && f.set_scores.trim() && !f.set_scores.trim().startsWith('[')) {
    sets = f.set_scores.trim();
  }
  const live = ['live', 'in_progress', 'in_play'].includes(String(f?.status || '').toLowerCase());
  return `${live ? 'Live' : 'Sets'} ${a}-${b}${sets ? ` (${sets})` : ''}`;
}

/** Tennis (tennis_predictions): main pick (or no safe banker) plus every secondary market. */
async function loadTennisCards(range: { startUtc: string; endUtc: string }): Promise<ListCard[] | null> {
  const rows = await fetchRows(
    'tennis_predictions',
    'id,market,prediction,probability,confidence_category,secondary_predictions,target_kickoff_at,settlement_status,actual_result,fixture:tennis_fixtures(target_kickoff_at,status,score_p1_sets,score_p2_sets,set_scores,round,tournament:tennis_tournaments(name,tour),player1:tennis_players!tennis_fixtures_player1_id_fkey(display_name),player2:tennis_players!tennis_fixtures_player2_id_fkey(display_name))',
    range
  );
  if (!rows) return null;
  return rows.map(r => {
    const f = r.fixture || {};
    const pass = isNoBanker(r.market, r.prediction, r.confidence_category);
    const t = f.tournament || {};
    const league = [t.tour, t.name].filter(Boolean).join(' ') + (f.round ? ` · ${f.round}` : '');
    return {
      title: `${f.player1?.display_name || 'Player 1'} vs ${f.player2?.display_name || 'Player 2'}`,
      league: league || 'Tennis',
      kickoff: watTime(r.target_kickoff_at || f.target_kickoff_at),
      main: pass ? null : { label: String(r.prediction), probability: normalizeProbability(r.probability), tier: r.confidence_category || undefined, result: normalizeResult(r.settlement_status) },
      subs: subPicksFrom(r.secondary_predictions),
      score: String(r.actual_result || '').trim() || tennisScoreLine(f),
      tiers: [],
    };
  });
}

/** Cards for a view (tab) on one WAT day. null on a database error. */
async function loadCardsForView(view: string, range: { startUtc: string; endUtc: string }): Promise<ListCard[] | null> {
  switch (sourceForView(view)) {
    case 'goals': return loadGoalsCards(range, 'over_2.5_goals');
    case 'ht05': return loadGoalsCards(range, 'ht_over_0.5_goals');
    case 'corners': return loadCornerCards(range);
    case 'basketball': return loadBasketballCards(range);
    case 'tennis': return loadTennisCards(range);
    default: {
      const football = await loadFixtureCards(range);
      return football === null ? null : filterForView(view, football.map(footballListCard));
    }
  }
}

/** Adds a "Book on SportyBet" button under football lists for today and later days. */
function withBookButton(replyMarkup: any, view: string, dateKey: string, cards: ListCard[]): any {
  if (!bookingEnabled() || !BOOKABLE_VIEWS.has(view) || lagosOffsetForDateKey(dateKey) < 0) return replyMarkup;
  if (!cards.some(c => c.main && (!c.main.result || c.main.result === 'pending'))) return replyMarkup;
  const rows = Array.isArray(replyMarkup?.inline_keyboard) ? replyMarkup.inline_keyboard : [];
  return { inline_keyboard: [...rows, [{ text: '🎟 Book these on SportyBet', callback_data: bookCallback(view, dateKey) }]] };
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: true, status: 'Oddsbanta Telegram Webhook Active' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SEC-03: Validate Telegram Webhook Secret Token (Strict Fail-Closed)
  const incomingSecret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!TELEGRAM_WEBHOOK_SECRET || incomingSecret !== TELEGRAM_WEBHOOK_SECRET) {
    console.warn('Blocked unauthorized Telegram webhook call: missing or invalid secret token');
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Invalid webhook secret' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SEC-06: Fail securely if server credentials are not configured
  if (!SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN) {
    console.error('Server credentials missing: SUPABASE_SERVICE_ROLE_KEY or TELEGRAM_BOT_TOKEN');
    return new Response(JSON.stringify({ success: false, error: 'Server credentials misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const update: TelegramUpdate = await req.json();

    // 0. PAGE BUTTONS on a prediction list (inline keyboard callbacks)
    if (update.callback_query) {
      const cq = update.callback_query;
      const cbChatId = cq.message?.chat?.id;
      const cbMessageId = cq.message?.message_id;
      const parsed = parsePageCallback(cq.data);
      const bookReq = parseBookCallback(cq.data);

      // SportyBet booking code for the list on screen (same premium gate as the lists).
      if (bookReq && cbChatId) {
        if (!bookingEnabled()) {
          await answerCallbackQuery(cq.id, 'SportyBet booking is coming soon.');
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        const bkUser = await getLinkedUser(cbChatId);
        if (!bkUser) {
          await answerCallbackQuery(cq.id);
          await sendTelegramMessage(cbChatId, LINK_REQUIRED_MESSAGE);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        const bkAuth = await isUserPaidOrAdmin(bkUser);
        if (!bkAuth.isPaid) {
          await answerCallbackQuery(cq.id);
          await sendTelegramMessage(cbChatId, VIP_REQUIRED_MESSAGE);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        const bkOffset = lagosOffsetForDateKey(bookReq.dateKey);
        if (bkOffset < 0 || bkOffset > MAX_DAY_OFFSET) {
          await answerCallbackQuery(cq.id, 'Only today and upcoming days can be booked.');
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        await answerCallbackQuery(cq.id, 'Booking on SportyBet…');
        const bkRange = getLagosDateBoundaries(bkOffset);
        const bkCards = await loadCardsForView(bookReq.view, bkRange);
        if (bkCards === null) {
          await sendTelegramMessage(cbChatId, '⚠️ Could not load predictions. Please try again shortly.');
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        const result = await bookLegsCached(`${bookReq.view}|${bookReq.dateKey}`, legsFromCards(bkCards, bookReq.dateKey));
        const title = (VIEWS[bookReq.view]?.title || 'Picks').replace(/<[^>]+>/g, '');
        await sendTelegramMessage(cbChatId, renderBookingMessage(result, title, bkRange.displayDate));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (cq.data === NOOP_CALLBACK || !parsed || !cbChatId || !cbMessageId) {
        await answerCallbackQuery(cq.id);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // Same premium gate as typed commands, checked again on every page turn.
      const cbUser = await getLinkedUser(cbChatId);
      if (!cbUser) {
        await answerCallbackQuery(cq.id);
        await sendTelegramMessage(cbChatId, LINK_REQUIRED_MESSAGE);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      const cbAuth = await isUserPaidOrAdmin(cbUser);
      if (!cbAuth.isPaid) {
        await answerCallbackQuery(cq.id);
        await sendTelegramMessage(cbChatId, VIP_REQUIRED_MESSAGE);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // The list stays on the day it was requested for, even after midnight.
      const cbOffset = lagosOffsetForDateKey(parsed.dateKey);
      if (cbOffset < MIN_DAY_OFFSET || cbOffset > MAX_DAY_OFFSET) {
        await answerCallbackQuery(cq.id, 'That day is out of range.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      const cbRange = getLagosDateBoundaries(cbOffset);
      const cbCards = await loadCardsForView(parsed.cmd, cbRange);
      if (cbCards === null) {
        await answerCallbackQuery(cq.id, 'Could not load predictions. Please try again shortly.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const view = renderListPage({
        view: parsed.cmd,
        displayDate: cbRange.displayDate,
        dateKey: parsed.dateKey,
        todayKey: getLagosDateBoundaries(0).lagosDateStr,
        tomorrowKey: getLagosDateBoundaries(1).lagosDateStr,
        cards: cbCards,
        page: parsed.page,
      });
      await answerCallbackQuery(cq.id);
      await editTelegramMessage(cbChatId, cbMessageId, view.text, withBookButton(view.replyMarkup, parsed.cmd, parsed.dateKey, cbCards));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (!update.message || !update.message.text) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const message = update.message;
    const chatId = message.chat.id;
    const rawText = message.text.trim();
    const username = message.from?.username;

    // Normalize command token: e.g. "/today@Oddsbanta_bot" -> "/today"
    const commandToken = rawText.split(/\s+/)[0].replace(/@\w+$/i, '').toLowerCase();

    // 1. ROUTE /start
    if (commandToken === '/start') {
      const parts = rawText.split(/\s+/);
      if (parts.length > 1 && parts[1].trim()) {
        const linkResult = await linkUserByToken(chatId, username, parts[1].trim());
        if (linkResult.success) {
          await sendTelegramMessage(
            chatId,
            `🎉 <b>Account Connected Successfully!</b>\n\n` +
            `Welcome <b>${escapeHtml(linkResult.email)}</b>!\n` +
            `Your Oddsbanta profile is now linked.\n\n` +
            `<b>Available Commands:</b>\n` +
            commandListHtml()
          );
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        } else {
          await sendTelegramMessage(
            chatId,
            `⚠️ <b>Connection Failed</b>\n${escapeHtml(linkResult.error)}\n\nPlease visit <a href="https://www.oddsbanta.com/dashboard">Oddsbanta Dashboard</a> to generate a fresh link code.`
          );
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
      }

      // Plain /start without token
      const linkedUser = await getLinkedUser(chatId);
      if (linkedUser) {
        const authInfo = await isUserPaidOrAdmin(linkedUser);
        await sendTelegramMessage(
          chatId,
          `👋 <b>Welcome Back to Oddsbanta Sentinel VIP Bot!</b>\n\n` +
          `• Account: <b>${escapeHtml(linkedUser.email)}</b>\n` +
          `• Access Tier: <b>${escapeHtml(authInfo.tier)}</b>\n` +
          `• VIP Status: <b>${authInfo.isPaid ? 'UNLOCKED ✅' : 'LOCKED 🔒'}</b>\n\n` +
          `<b>Ready to pull calibrated predictions:</b>\n` +
          commandListHtml()
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `👋 <b>Welcome to Oddsbanta Sentinel VIP Bot!</b>\n\n` +
          `To access predictions on Telegram, link your Oddsbanta account:\n\n` +
          `1. Sign in to <a href="https://www.oddsbanta.com/dashboard">Oddsbanta Dashboard</a>\n` +
          `2. Click <b>Connect Telegram VIP Bot</b> in your profile\n` +
          `3. Click the instant deep link, or send:\n` +
          `   <code>/link YOUR_CODE</code>\n\n` +
          `Need an account? Register at <a href="https://www.oddsbanta.com">oddsbanta.com</a>.`
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // 2. ROUTE /link
    if (commandToken === '/link') {
      const parts = rawText.split(/\s+/);
      if (parts.length < 2 || !parts[1].trim()) {
        await sendTelegramMessage(
          chatId,
          `ℹ️ <b>Usage:</b> <code>/link YOUR_CODE</code>\n\nGenerate your code inside your <a href="https://www.oddsbanta.com/dashboard">Oddsbanta Dashboard</a>.`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const linkResult = await linkUserByToken(chatId, username, parts[1].trim());
      if (linkResult.success) {
        await sendTelegramMessage(
          chatId,
          `🎉 <b>Account Connected Successfully!</b>\n\n` +
          `Welcome <b>${escapeHtml(linkResult.email)}</b>!\n` +
          `You can now pull predictions anytime using:\n` +
          commandListHtml()
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Connection Error:</b>\n${escapeHtml(linkResult.error)}`
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // 3. ROUTE /status
    if (commandToken === '/status') {
      const user = await getLinkedUser(chatId);
      if (!user) {
        await sendTelegramMessage(
          chatId,
          `🔒 <b>Not Linked</b>\nYour Telegram account is not connected to an Oddsbanta profile.\n\nConnect at <a href="https://www.oddsbanta.com/dashboard">Oddsbanta Dashboard</a>.`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const authInfo = await isUserPaidOrAdmin(user);
      await sendTelegramMessage(
        chatId,
        `📊 <b>Oddsbanta Subscription Status</b>\n\n` +
        `• Email: <b>${escapeHtml(user.email)}</b>\n` +
        `• Access Tier: <b>${escapeHtml(authInfo.tier)}</b>\n` +
        `• VIP Status: <b>${authInfo.isPaid ? 'UNLOCKED ✅' : 'LOCKED ❌'}</b>\n` +
        `• Bot Engine: <b>Active 🟢 (v2.4 Sniper)</b>\n\n` +
        `${authInfo.isPaid ? 'You have full access to all verified prediction feeds.' : 'Upgrade to Standard or BigBang VIP at <a href="https://www.oddsbanta.com/subscription">oddsbanta.com/subscription</a> to unlock live Telegram feeds.'}`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // 4. ROUTE /help or /faq
    if (commandToken === '/help' || commandToken === '/faq') {
      const helpText =
        `🤖 <b>ODDSBANTA INTELLIGENCE BOT — FAQS &amp; COMMANDS</b>\n\n` +
        `📖 <b>FREQUENTLY ASKED QUESTIONS:</b>\n\n` +
        `❓ <b>1. What is Oddsbanta?</b>\n` +
        `Oddsbanta is an automated sports predictive intelligence platform. Every match is evaluated with calibrated Poisson and statistical models (xG, home advantage, form weighting) to identify true probability edges.\n\n` +
        `❓ <b>2. What is a "Banger"?</b>\n` +
        `A Banger is our highest-conviction classification (simulated probability 96% and above). It represents extreme mathematical alignment across simulations.\n\n` +
        `❓ <b>3. What do the Confidence Tiers mean?</b>\n` +
        `• <b>Banger:</b> 96% and above\n` +
        `• <b>Top Pick:</b> 90% - 95%\n` +
        `• <b>High Confidence:</b> 80% - 89%\n` +
        `• <b>Mid Confidence:</b> 70% - 79%\n` +
        `• <b>Low Confidence:</b> under 70%, statistical value leans\n\n` +
        `❓ <b>4. Why are some matches passed or marked SKIP?</b>\n` +
        `When no market meets our 80% Banker threshold, our Anti-Loss Guard flags the match as SKIP / NO SAFE BANKER. The bot still lists that match with its other picks, clearly marked, so you can judge them yourself.\n\n` +
        `❓ <b>5. How does Match Settlement work?</b>\n` +
        `Our autonomous settlement engine checks official full-time results every 5 minutes. Every published prediction is permanently marked as WON, LOST, or VOID with zero retroactive editing.\n\n` +
        `❓ <b>6. What happens if a match is Postponed?</b>\n` +
        `Postponed or abandoned matches are marked as ⊘ VOID. They do not count as a loss.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 <b>BOT COMMANDS LIST:</b>\n\n` +
        commandListHtml() + `\n` +
        `• /link &lt;CODE&gt; — Connect your Oddsbanta web profile\n\n` +
        `Every list shows all matches in pages. Use the buttons under a list to switch sport or market, change day, or turn pages.\n\n` +
        `🌐 <b>Website:</b> https://www.oddsbanta.com\n` +
        `📊 <b>Dashboard:</b> https://www.oddsbanta.com/dashboard`;

      await sendTelegramMessage(chatId, helpText);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // 5. ROUTE /settled or /results
    if (commandToken === '/settled') {
      // Admin-only: settled results are no longer public (Track Record is an admin feature).
      const settledUser = await getLinkedUser(chatId);
      const settledEmail = (settledUser?.email || '').toLowerCase().trim();
      const settledIsAdmin = !!settledUser && (settledUser.role === 'admin' || ADMIN_EMAILS.includes(settledEmail));
      if (!settledIsAdmin) {
        await sendTelegramMessage(chatId, 'This command is not available. Open your dashboard at https://www.oddsbanta.com/dashboard for your picks.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const headers = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      };

      const selectFields = encodeURIComponent(
        'id,prediction,market,settlement_status,actual_score,target_kickoff_at,fixture:football_fixtures!inner(id,home_score,away_score,home_team:football_teams!football_fixtures_home_team_id_fkey(name),away_team:football_teams!football_fixtures_away_team_id_fkey(name))'
      );

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/football_predictions?select=${selectFields}&settlement_status=in.(won,lost)&order=target_kickoff_at.desc&limit=8`,
        { headers }
      );

      if (!res.ok) {
        await sendTelegramMessage(chatId, '⚠️ Error loading settled records.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const settled: any[] = await res.json();
      if (!Array.isArray(settled) || settled.length === 0) {
        await sendTelegramMessage(chatId, '📊 No recently settled predictions found in the log.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      let reply = `📊 <b>Oddsbanta Verified Track Record (Recent Settlements)</b>\n\n`;
      settled.forEach((p: any) => {
        const home = escapeHtml(p.fixture?.home_team?.name?.replace(/-/g, ' ') || 'Home');
        const away = escapeHtml(p.fixture?.away_team?.name?.replace(/-/g, ' ') || 'Away');
        const isWon = p.settlement_status === 'won';
        const icon = isWon ? '✅ WON' : '❌ LOST';
        const score = escapeHtml(p.actual_score || `${p.fixture?.home_score ?? '?'}-${p.fixture?.away_score ?? '?'}`);
        const pick = escapeHtml(p.prediction || '');
        reply += `• <b>${home} vs ${away}</b> (${score})\n  Pick: ${pick} → <b>${icon}</b>\n`;
      });

      await sendTelegramMessage(chatId, reply);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // 6. ROUTE PREDICTION LISTS: football (/today, /tomorrow, tier views), /goals, /ht05, /corners, /basketball, /tennis
    // /date <day>: football list for any day in range (past days show results).
    let listTarget = commandToView(commandToken);
    if (commandToken === '/date') {
      const todayKey = getLagosDateBoundaries(0).lagosDateStr;
      const arg = rawText.split(/\s+/).slice(1).join(' ');
      const dateKey = parseDateArg(arg, todayKey);
      const offset = dateKey ? daysBetween(todayKey, dateKey) : NaN;
      if (!dateKey || offset < MIN_DAY_OFFSET || offset > MAX_DAY_OFFSET) {
        await sendTelegramMessage(
          chatId,
          `📅 <b>Pick a day</b>\n\nSend <code>/date 2026-11-05</code>, <code>/date 5/11</code> or <code>/date 5 Nov</code>.\n` +
          `You can go back ${-MIN_DAY_OFFSET} days and ahead ${MAX_DAY_OFFSET} days. Past days show each pick's result.`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      listTarget = { view: 'football', dayOffset: offset };
    }
    if (listTarget) {
      const user = await getLinkedUser(chatId);
      if (!user) {
        await sendTelegramMessage(chatId, LINK_REQUIRED_MESSAGE);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const authInfo = await isUserPaidOrAdmin(user);
      if (!authInfo.isPaid) {
        await sendTelegramMessage(chatId, VIP_REQUIRED_MESSAGE);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // Date scoping strictly in Africa/Lagos (WAT, UTC+1)
      const dateRange = getLagosDateBoundaries(listTarget.dayOffset);
      const cards = await loadCardsForView(listTarget.view, dateRange);
      if (cards === null) {
        await sendTelegramMessage(chatId, '⚠️ Error pulling predictions from database. Please try again shortly.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // Every match is listed across pages, with sport/market tabs and page buttons underneath.
      const view = renderListPage({
        view: listTarget.view,
        displayDate: dateRange.displayDate,
        dateKey: dateRange.lagosDateStr,
        todayKey: getLagosDateBoundaries(0).lagosDateStr,
        tomorrowKey: getLagosDateBoundaries(1).lagosDateStr,
        cards,
        page: 1,
      });
      await sendTelegramMessage(chatId, view.text, withBookButton(view.replyMarkup, listTarget.view, dateRange.lagosDateStr, cards));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Default reply for unrecognized commands
    await sendTelegramMessage(
      chatId,
      `❓ Unrecognized command <b>${escapeHtml(commandToken)}</b>.\n\nUse /help to see all available Oddsbanta commands.`
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('Error handling Telegram webhook:', err);
    return new Response(JSON.stringify({ ok: true, error: err.message }), { status: 200 });
  }
}
