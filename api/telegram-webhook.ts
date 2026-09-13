export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODg1Mzg3MiwiZXhwIjoyMTA0NDI5ODcyfQ.GN9S6B0YUsq3oz5ouMgI27i0Vu0SRAdEO0aaPLewfQk';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8606037569:AAH_QOJolgxND26su_AXCyxv6z8iCp4WzbA';

// Universal Admin email list for direct Telegram fallback access
const ADMIN_EMAILS = [
  'chibzymart@gmail.com',
  'whizzchibz@gmail.com',
  'chibuezec.amuchie@gmail.com',
  'chibuezeamuchie@gmail.com',
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
        }),
      });
    }
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
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
      if (validUntil > Date.now() && ['standard', 'bigbang', 'pro', 'premium', 'admin', 'vip'].includes(ent.tier)) {
        return { isPaid: true, tier: ent.tier.toUpperCase() };
      }
      if (ent.tier === 'admin' || (ent.features && ent.features.admin === true)) {
        return { isPaid: true, tier: 'ADMIN VIP' };
      }
    }
  }

  // 3. Check active subscriptions
  const subRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&status=eq.active&select=tier&limit=1`,
    { headers }
  );
  if (subRes.ok) {
    const subData = await subRes.json();
    if (Array.isArray(subData) && subData.length > 0) {
      return { isPaid: true, tier: subData[0].tier.toUpperCase() };
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

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: true, status: 'Oddsbanta Telegram Webhook Active' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const update: TelegramUpdate = await req.json();
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
            `• /today - All scheduled match predictions\n` +
            `• /bangers - Super Bankers (P ≥ 85%)\n` +
            `• /toppicks - Top Picks (90% - 95%)\n` +
            `• /high - High Confidence (80% - 89%)\n` +
            `• /mid - Mid Confidence (70% - 79%)\n` +
            `• /low - Low Confidence Leans (&lt; 70%)\n` +
            `• /goals - Over 2.5 &amp; Goals Hub\n` +
            `• /settled - Verified match settlements\n` +
            `• /status - Your subscription status\n` +
            `• /help - Full FAQ &amp; Guide`
          );
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        } else {
          await sendTelegramMessage(
            chatId,
            `⚠️ <b>Connection Failed</b>\n${escapeHtml(linkResult.error)}\n\nPlease visit <a href="https://oddsbanta.com/dashboard">Oddsbanta Dashboard</a> to generate a fresh link code.`
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
          `• /today - All active predictions\n` +
          `• /bangers - Super Bankers (P ≥ 85%)\n` +
          `• /toppicks - Top Picks (90% - 95%)\n` +
          `• /high - High Confidence (80% - 89%)\n` +
          `• /mid - Mid Confidence (70% - 79%)\n` +
          `• /low - Low Confidence value leans\n` +
          `• /goals - Over 2.5 &amp; 1st Half Goals Hub\n` +
          `• /settled - Live track record\n` +
          `• /status - Subscription details\n` +
          `• /help - Complete FAQs &amp; Command Guide`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `👋 <b>Welcome to Oddsbanta Sentinel VIP Bot!</b>\n\n` +
          `To access predictions on Telegram, link your Oddsbanta account:\n\n` +
          `1. Sign in to <a href="https://oddsbanta.com/dashboard">Oddsbanta Dashboard</a>\n` +
          `2. Click <b>Connect Telegram VIP Bot</b> in your profile\n` +
          `3. Click the instant deep link, or send:\n` +
          `   <code>/link YOUR_CODE</code>\n\n` +
          `Need an account? Register at <a href="https://oddsbanta.com">oddsbanta.com</a>.`
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
          `ℹ️ <b>Usage:</b> <code>/link YOUR_CODE</code>\n\nGenerate your code inside your <a href="https://oddsbanta.com/dashboard">Oddsbanta Dashboard</a>.`
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
          `• /today\n• /bangers\n• /toppicks\n• /high\n• /goals\n• /status`
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
          `🔒 <b>Not Linked</b>\nYour Telegram account is not connected to an Oddsbanta profile.\n\nConnect at <a href="https://oddsbanta.com/dashboard">Oddsbanta Dashboard</a>.`
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
        `${authInfo.isPaid ? 'You have full access to all 250,000-simulated prediction feeds.' : 'Upgrade to Standard or BigBang VIP at <a href="https://oddsbanta.com/subscription">oddsbanta.com/subscription</a> to unlock live Telegram feeds.'}`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // 4. ROUTE /help or /faq
    if (commandToken === '/help' || commandToken === '/faq') {
      const helpText =
        `🤖 <b>ODDSBANTA INTELLIGENCE BOT — FAQS &amp; COMMANDS</b>\n\n` +
        `📖 <b>FREQUENTLY ASKED QUESTIONS:</b>\n\n` +
        `❓ <b>1. What is Oddsbanta?</b>\n` +
        `Oddsbanta is an automated football predictive intelligence platform. Every match runs through 250,000 Poisson and Monte Carlo draws (xG, home advantage, form weighting) to identify true statistical edges.\n\n` +
        `❓ <b>2. What is a "Banger"?</b>\n` +
        `A Banger is our highest-conviction classification (simulated probability ≥ 85%-96%+). It represents extreme mathematical alignment across simulations.\n\n` +
        `❓ <b>3. What do the Confidence Tiers mean?</b>\n` +
        `• <b>Banger:</b> ≥ 85%-96%+ simulated probability\n` +
        `• <b>Top Pick:</b> 90% - 95% simulated probability\n` +
        `• <b>High Confidence:</b> 80% - 89% simulated probability\n` +
        `• <b>Mid Confidence:</b> 70% - 79% simulated probability\n` +
        `• <b>Low Confidence:</b> &lt; 70% statistical value leans\n\n` +
        `❓ <b>4. Why are some matches passed or marked SKIP?</b>\n` +
        `When no market meets our 80% Banker threshold, our Anti-Loss Guard flags the match as SKIP / NO SAFE BANKER. The bot automatically filters these out so you only receive actionable predictions.\n\n` +
        `❓ <b>5. How does Match Settlement work?</b>\n` +
        `Our autonomous settlement engine checks official full-time results every 5 minutes. Every published prediction is permanently marked as WON, LOST, or VOID with zero retroactive editing.\n\n` +
        `❓ <b>6. What happens if a match is Postponed?</b>\n` +
        `Postponed or abandoned matches are marked as ⊘ VOID. They do not count as a loss.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 <b>BOT COMMANDS LIST:</b>\n\n` +
        `• /today - All verified active predictions\n` +
        `• /bangers - Super Bankers (P ≥ 85%)\n` +
        `• /toppicks - Top Picks (90% - 95%)\n` +
        `• /high - High Confidence (80% - 89%)\n` +
        `• /mid - Mid Confidence (70% - 79%)\n` +
        `• /low - Low Confidence value leans\n` +
        `• /goals - Over 2.5, Over 1.5 &amp; BTTS Hub\n` +
        `• /settled - Live settled results track record\n` +
        `• /status - Check account &amp; VIP subscription status\n` +
        `• /link &lt;CODE&gt; - Connect your Oddsbanta web profile\n` +
        `• /help - Display this FAQ &amp; command list\n\n` +
        `🌐 <b>Website:</b> https://oddsbanta.com\n` +
        `📊 <b>Dashboard:</b> https://oddsbanta.com/dashboard`;

      await sendTelegramMessage(chatId, helpText);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // 5. ROUTE /settled or /results
    if (commandToken === '/settled' || commandToken === '/results') {
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
      reply += `\nTrack record is 100% auditable at <a href="https://oddsbanta.com/settlement">oddsbanta.com/settlement</a>`;

      await sendTelegramMessage(chatId, reply);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

function formatMarket(mkt: string): string {
  const m = (mkt || '').toLowerCase().trim();
  if (m === 'over_under_1.5') return 'Over/Under 1.5';
  if (m === 'over_under_2.5') return 'Over/Under 2.5';
  if (m === 'over_under_3.5') return 'Over/Under 3.5';
  if (m === 'btts') return 'Both Teams to Score';
  if (m === 'double_chance') return 'Double Chance';
  if (m === 'moneyline' || m === '1x2') return 'Match Result (1X2)';
  if (m === 'home_goals_0.5') return 'Home Over 0.5';
  if (m === 'away_goals_0.5') return 'Away Over 0.5';
  if (m === '1h_goals_0.5') return '1st Half Over 0.5';
  if (m === '2h_goals_0.5') return '2nd Half Over 0.5';
  if (m.startsWith('corners_')) return `Corners ${m.replace('corners_', '')}`;
  return (mkt || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatOutcome(pick: string, market?: string): string {
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

interface PredictionFeedItem {
  fixture: any;
  prediction: string;
  market: string;
  probability: number;
  confidenceCategory: string;
  targetKickoffAt: string;
  isSecondary: boolean;
}

    // 6. ROUTE PREDICTION COMMANDS: /today, /bangers, /toppicks, /high, /mid, /low, /goals
    const predCommands = ['/today', '/bangers', '/toppicks', '/top', '/high', '/mid', '/low', '/goals'];
    if (predCommands.includes(commandToken)) {
      const user = await getLinkedUser(chatId);
      if (!user) {
        await sendTelegramMessage(
          chatId,
          `🔒 <b>Authentication Required</b>\n\n` +
          `Please link your Oddsbanta account first to pull predictions.\n\n` +
          `1. Sign in at <a href="https://oddsbanta.com/dashboard">Oddsbanta</a>\n` +
          `2. Click <b>Connect Telegram VIP Bot</b>\n` +
          `3. Enter the code here: <code>/link YOUR_CODE</code>`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const authInfo = await isUserPaidOrAdmin(user);
      if (!authInfo.isPaid) {
        await sendTelegramMessage(
          chatId,
          `🔒 <b>VIP Access Required</b>\n\n` +
          `Your account is currently on the <b>Free Tier</b>.\n` +
          `To unlock live 250,000-simulated predictions directly in Telegram, upgrade your plan:\n\n` +
          `👉 <a href="https://oddsbanta.com/subscription">Upgrade to VIP (₦5,000/mo)</a>`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // User is VIP/Admin! Query unredacted predictions from Supabase
      const headers = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      };

      const selectFields = encodeURIComponent(
        'id,prediction,market,probability,confidence_category,target_kickoff_at,secondary_predictions,fixture:football_fixtures!inner(id,target_kickoff_at,status,home_team:football_teams!football_fixtures_home_team_id_fkey(name),away_team:football_teams!football_fixtures_away_team_id_fkey(name),league:football_leagues!inner(code,name,country))'
      );

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/football_predictions?select=${selectFields}&publication_status=eq.published&settlement_status=eq.pending&order=target_kickoff_at.asc&limit=100`,
        { headers }
      );

      if (!res.ok) {
        await sendTelegramMessage(chatId, '⚠️ Error pulling predictions from database. Please try again shortly.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const rawPreds: any[] = await res.json();
      if (!Array.isArray(rawPreds) || rawPreds.length === 0) {
        await sendTelegramMessage(chatId, '⚽ No upcoming scheduled predictions found in the active queue.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // Flatten primary + secondary predictions into unified feed items
      const allItems: PredictionFeedItem[] = [];

      for (const p of rawPreds) {
        const prob = normalizeProbability(p.probability);
        const predStr = String(p.prediction || '').trim();
        const mktStr = String(p.market || '').trim();
        const catStr = normalizeCategory(p.confidence_category, prob);

        if (
          predStr &&
          predStr.toUpperCase() !== 'SKIP' &&
          mktStr.toUpperCase() !== 'NO_SAFE_BANKER' &&
          catStr !== 'NO SAFE BANKER'
        ) {
          allItems.push({
            fixture: p.fixture,
            prediction: predStr,
            market: mktStr,
            probability: prob,
            confidenceCategory: catStr,
            targetKickoffAt: p.target_kickoff_at || p.fixture?.target_kickoff_at,
            isSecondary: false,
          });
        }

        let sec = p.secondary_predictions;
        if (typeof sec === 'string') {
          try {
            sec = JSON.parse(sec);
          } catch {
            sec = [];
          }
        }
        if (Array.isArray(sec)) {
          for (const s of sec) {
            const sProb = normalizeProbability(s.probability || s.prob);
            const sPred = String(s.prediction || '').trim();
            const sMkt = String(s.market || '').trim();
            const sCat = normalizeCategory(s.confidence_tier || s.tier, sProb);

            if (
              sPred &&
              sMkt &&
              sPred.toUpperCase() !== 'SKIP' &&
              sMkt.toUpperCase() !== 'NO_SAFE_BANKER'
            ) {
              allItems.push({
                fixture: p.fixture,
                prediction: sPred,
                market: sMkt,
                probability: sProb,
                confidenceCategory: sCat,
                targetKickoffAt: p.target_kickoff_at || p.fixture?.target_kickoff_at,
                isSecondary: true,
              });
            }
          }
        }
      }

      let categoryTitle = 'ALL ACTIONABLE PREDICTIONS';
      let filtered: PredictionFeedItem[] = [];

      if (commandToken === '/today') {
        categoryTitle = 'ALL ACTIVE PREDICTIONS';
        filtered = allItems.filter(i => !i.isSecondary || i.probability >= 80);
      } else if (commandToken === '/bangers') {
        categoryTitle = '🔥 SUPER BANGERS (P ≥ 85%)';
        filtered = allItems.filter(i => i.confidenceCategory === 'BANGER' || i.probability >= 85);
      } else if (commandToken === '/toppicks' || commandToken === '/top') {
        categoryTitle = '⭐ TOP PICKS (90% - 95%)';
        filtered = allItems.filter(i => i.confidenceCategory === 'TOP PICK' || (i.probability >= 90 && i.probability < 96));
      } else if (commandToken === '/high') {
        categoryTitle = '🟢 HIGH CONFIDENCE (80% - 89%)';
        filtered = allItems.filter(i => i.confidenceCategory === 'HIGH CONFIDENCE' || (i.probability >= 80 && i.probability < 90));
      } else if (commandToken === '/mid') {
        categoryTitle = '🔵 MID CONFIDENCE (70% - 79%)';
        filtered = allItems.filter(i => i.confidenceCategory === 'MID CONFIDENCE' || (i.probability >= 70 && i.probability < 80));
      } else if (commandToken === '/low') {
        categoryTitle = '🟡 LOW CONFIDENCE VALUE LEANS (< 70%)';
        filtered = allItems.filter(i => i.confidenceCategory === 'LOW CONFIDENCE' || (i.probability > 0 && i.probability < 70));
      } else if (commandToken === '/goals') {
        categoryTitle = '⚡ OVER 2.5 &amp; GOALS HUB';
        filtered = allItems.filter(i => {
          const m = i.market.toLowerCase();
          const pr = i.prediction.toLowerCase();
          return (
            m.includes('over') ||
            m.includes('under') ||
            m.includes('goal') ||
            m.includes('btts') ||
            pr.includes('over') ||
            pr.includes('under') ||
            pr.includes('goal')
          );
        });
      }

      if (filtered.length === 0) {
        await sendTelegramMessage(
          chatId,
          `⚽ No matching actionable predictions found for <b>${escapeHtml(commandToken)}</b> right now.\n\nUse /today to see all active predictions, or check back after the next automated simulation run!`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // Build Telegram message
      let reply = `⚽ <b>Oddsbanta VIP Predictions</b>\n`;
      reply += `🏷️ <b>Filter:</b> ${categoryTitle}\n`;
      reply += `📅 Generated with 250,000 Poisson-Monte Carlo draws\n\n`;

      filtered.slice(0, 10).forEach((item, idx) => {
        const f = item.fixture;
        const home = escapeHtml(f?.home_team?.name?.replace(/-/g, ' ') || 'Home');
        const away = escapeHtml(f?.away_team?.name?.replace(/-/g, ' ') || 'Away');
        const league = escapeHtml(f?.league?.code || f?.league?.name || 'League');
        const prob = item.probability;
        const formattedMkt = escapeHtml(formatMarket(item.market));
        const formattedPick = escapeHtml(formatOutcome(item.prediction, item.market));
        const cat = escapeHtml(item.confidenceCategory);
        const tag = item.isSecondary ? ' <i>[Value Lean]</i>' : '';
        const time = new Date(item.targetKickoffAt).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Lagos',
        });

        reply += `<b>${idx + 1}. ${home} vs ${away}</b>${tag}\n`;
        reply += `🏆 ${league} • ⏰ ${time} WAT\n`;
        reply += `🎯 Pick: <b>${formattedPick}</b> (${formattedMkt})\n`;
        reply += `📊 Certainty: <b>${prob}%</b> • Tier: <code>${cat}</code>\n\n`;
      });

      if (filtered.length > 10) {
        reply += `<i>...and ${filtered.length - 10} more fixtures on <a href="https://oddsbanta.com/dashboard">Oddsbanta Dashboard</a></i>\n\n`;
      }

      reply += `Quick Filters: /bangers | /toppicks | /high | /mid | /low | /goals`;

      await sendTelegramMessage(chatId, reply);
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
