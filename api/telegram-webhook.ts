export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
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

async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: any) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured.');
    return;
  }
  try {
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
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

  // Find user by valid unexpired token
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

  // Update user with telegram_chat_id and clear token
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
    const text = message.text.trim();
    const username = message.from?.username;

    // Route commands
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      if (parts.length > 1 && parts[1].trim()) {
        const linkResult = await linkUserByToken(chatId, username, parts[1].trim());
        if (linkResult.success) {
          await sendTelegramMessage(
            chatId,
            `🎉 *Account Connected Successfully!*\n\nWelcome *${linkResult.email}*!\nYour Oddsbanta account is now linked to Telegram.\n\nReady to pull calibrated predictions:\n• /today - All scheduled match predictions\n• /bangers - Super Bankers (P ≥ 85%)\n• /toppicks - Top Picks (90% - 95%)\n• /high - High Confidence (80% - 89%)\n• /mid - Mid Confidence (70% - 79%)\n• /low - Low Confidence Leans (< 70%)\n• /goals - Over 2.5 & Goals Hub\n• /settled - Verified match settlements\n• /status - Your subscription status\n• /help - Full FAQ & Command List`
          );
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        } else {
          await sendTelegramMessage(
            chatId,
            `⚠️ *Connection Failed*\n${linkResult.error}\n\nPlease visit [Oddsbanta Dashboard](https://oddsbanta.com/dashboard) to generate a fresh link code.`
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
          `👋 *Welcome Back to Oddsbanta Sentinel VIP Bot!*\n\nAccount: *${linkedUser.email}*\nTier: *${authInfo.tier}*\n\nCommands:\n• /today - All scheduled predictions\n• /bangers - Super Bankers (P ≥ 85%)\n• /toppicks - Top Picks (90% - 95%)\n• /high - High Confidence (80% - 89%)\n• /mid - Mid Confidence (70% - 79%)\n• /low - Low Confidence Leans (< 70%)\n• /goals - Over 2.5 & Goals Hub\n• /settled - Track record & settlement\n• /status - Subscription details\n• /help - Full FAQ & Guide`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `👋 *Welcome to Oddsbanta Sentinel VIP Bot!*\n\nTo access predictions on Telegram, link your Oddsbanta account:\n\n1. Sign in to [Oddsbanta](https://oddsbanta.com/dashboard)\n2. Click *Connect Telegram VIP Bot*\n3. Click the instant deep link, or send:\n   \`/link YOUR_CODE\`\n\nNeed an account? Register at [Oddsbanta](https://oddsbanta.com).`
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (text.startsWith('/link')) {
      const parts = text.split(' ');
      if (parts.length < 2 || !parts[1].trim()) {
        await sendTelegramMessage(
          chatId,
          `ℹ️ *Usage:* \`/link YOUR_CODE\`\n\nGenerate your link code inside your [Oddsbanta Dashboard](https://oddsbanta.com/dashboard).`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const linkResult = await linkUserByToken(chatId, username, parts[1].trim());
      if (linkResult.success) {
        await sendTelegramMessage(
          chatId,
          `🎉 *Account Connected Successfully!*\n\nWelcome *${linkResult.email}*!\nYou can now pull live predictions anytime using:\n• /today\n• /bangers\n• /goals\n• /status`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `⚠️ *Connection Error:*\n${linkResult.error}`
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (text === '/status') {
      const user = await getLinkedUser(chatId);
      if (!user) {
        await sendTelegramMessage(
          chatId,
          `🔒 *Not Linked*\nYour Telegram account is not connected to an Oddsbanta user profile.\n\nConnect your account at [Oddsbanta Dashboard](https://oddsbanta.com/dashboard).`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const authInfo = await isUserPaidOrAdmin(user);
      await sendTelegramMessage(
        chatId,
        `📊 *Oddsbanta Subscription Status*\n\n• Email: *${user.email}*\n• Access Tier: *${authInfo.tier}*\n• VIP Unlocked: *${authInfo.isPaid ? 'YES ✅' : 'NO ❌'}*\n• Bot Status: *Active 🟢*\n\n${authInfo.isPaid ? 'You have full access to all prediction feeds.' : 'Upgrade to Standard or BigBang VIP at https://oddsbanta.com/subscription to unlock instant Telegram feeds.'}`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (text === '/help' || text === '/faq') {
      const helpText =
        `🤖 *ODDSBANTA INTELLIGENCE BOT — FAQS & COMMANDS*\n\n` +
        `📖 *FREQUENTLY ASKED QUESTIONS:*\n\n` +
        `❓ *1. What is Oddsbanta?*\n` +
        `Oddsbanta is an automated football predictive intelligence platform. Every match runs through 250,000 Poisson and Monte Carlo draws (xG, home advantage, form weighting) to identify true statistical edges.\n\n` +
        `❓ *2. What is a "Banger"?*\n` +
        `A Banger is our highest-conviction classification (simulated probability ≥ 85%-96%+). It represents extreme mathematical alignment across simulations.\n\n` +
        `❓ *3. What do the Confidence Tiers mean?*\n` +
        `• *Banger:* ≥ 85%-96%+ simulated probability\n` +
        `• *Top Pick:* 90% - 95% simulated probability\n` +
        `• *High Confidence:* 80% - 89% simulated probability\n` +
        `• *Mid Confidence:* 70% - 79% simulated probability\n` +
        `• *Low Confidence:* < 70% statistical value leans\n\n` +
        `❓ *4. Why are some matches passed or marked SKIP?*\n` +
        `When no market meets our 80% Banker threshold, our Anti-Loss Guard flags the match as SKIP / NO SAFE BANKER. The bot automatically filters these out so you only receive actionable predictions.\n\n` +
        `❓ *5. How does Match Settlement work?*\n` +
        `Our autonomous settlement engine checks official full-time results every 5 minutes. Every published prediction is permanently marked as WON, LOST, or VOID with zero retroactive editing.\n\n` +
        `❓ *6. What happens if a match is Postponed?*\n` +
        `Postponed or abandoned matches are marked as ⊘ VOID. They do not count as a loss.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *BOT COMMANDS LIST:*\n\n` +
        `• /today - All verified active predictions\n` +
        `• /bangers - Super Bankers (P ≥ 85%)\n` +
        `• /toppicks - Top Picks (90% - 95%)\n` +
        `• /high - High Confidence (80% - 89%)\n` +
        `• /mid - Mid Confidence (70% - 79%)\n` +
        `• /low - Low Confidence value leans\n` +
        `• /goals - Over 2.5, Over 1.5 & BTTS Hub\n` +
        `• /settled - Live settled results track record\n` +
        `• /status - Check account & VIP subscription status\n` +
        `• /link <CODE> - Connect your Oddsbanta web profile\n` +
        `• /help - Display this FAQ & command list\n\n` +
        `🌐 *Website:* https://oddsbanta.com\n` +
        `📊 *Dashboard:* https://oddsbanta.com/dashboard`;

      await sendTelegramMessage(chatId, helpText);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Predictions Commands: /today, /bangers, /toppicks, /high, /mid, /low, /goals
    const predCommands = ['/today', '/bangers', '/toppicks', '/high', '/mid', '/low', '/goals'];
    const matchingCmd = predCommands.find((cmd) => text === cmd || text.startsWith(`${cmd} `));

    if (matchingCmd) {
      const user = await getLinkedUser(chatId);
      if (!user) {
        await sendTelegramMessage(
          chatId,
          `🔒 *Authentication Required*\n\nPlease link your Oddsbanta account first to pull predictions.\n\n1. Sign in at [Oddsbanta](https://oddsbanta.com/dashboard)\n2. Click *Connect Telegram VIP Bot*\n3. Enter the code here: \`/link YOUR_CODE\``
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const authInfo = await isUserPaidOrAdmin(user);
      if (!authInfo.isPaid) {
        await sendTelegramMessage(
          chatId,
          `🔒 *VIP Access Required*\n\nYour account is currently on the *Free Tier*.\nTo unlock live 250,000-simulated predictions directly in Telegram, upgrade your plan:\n\n👉 [Upgrade to VIP (₦5,000/mo)](https://oddsbanta.com/subscription)`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // User is VIP! Query unredacted predictions from Supabase
      const headers = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      };

      const selectFields = encodeURIComponent(
        'id,prediction,market,probability,confidence_category,target_kickoff_at,fixture:football_fixtures!inner(id,target_kickoff_at,status,home_team:football_teams!football_fixtures_home_team_id_fkey(name),away_team:football_teams!football_fixtures_away_team_id_fkey(name),league:football_leagues!inner(code,name,country))'
      );

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/football_predictions?select=${selectFields}&publication_status=eq.published&settlement_status=eq.pending&order=target_kickoff_at.asc&limit=100`,
        { headers }
      );

      if (!res.ok) {
        await sendTelegramMessage(chatId, '⚠️ Error pulling predictions from database. Please try again shortly.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      let preds: any[] = await res.json();
      if (!Array.isArray(preds) || preds.length === 0) {
        await sendTelegramMessage(chatId, '⚽ No upcoming scheduled predictions found in the active queue.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // CRITICAL: Filter out SKIP and NO_SAFE_BANKER predictions
      preds = preds.filter((p: any) => {
        const predStr = (p.prediction || '').toUpperCase().trim();
        const mktStr = (p.market || '').toUpperCase().trim();
        const catStr = (p.confidence_category || '').toUpperCase().trim();
        return predStr !== 'SKIP' && mktStr !== 'NO_SAFE_BANKER' && catStr !== 'NO_SAFE_BANKER';
      });

      let categoryTitle = 'ALL ACTIONABLE PREDICTIONS';

      if (matchingCmd === '/bangers') {
        categoryTitle = '🔥 SUPER BANGERS (P ≥ 85%)';
        preds = preds.filter((p: any) =>
          ['BANGER', 'SUPER_BANKER'].includes(p.confidence_category) || (p.probability && p.probability >= 85)
        );
      } else if (matchingCmd === '/toppicks') {
        categoryTitle = '⭐ TOP PICKS (90% - 95%)';
        preds = preds.filter((p: any) => {
          const cat = (p.confidence_category || '').toUpperCase();
          const prob = p.probability || 0;
          return cat === 'TOP_PICK' || cat === 'TOPPICK' || (prob >= 90 && prob < 96);
        });
      } else if (matchingCmd === '/high') {
        categoryTitle = '🟢 HIGH CONFIDENCE (80% - 89%)';
        preds = preds.filter((p: any) => {
          const cat = (p.confidence_category || '').toUpperCase();
          const prob = p.probability || 0;
          return cat === 'HIGH_CONFIDENCE' || (prob >= 80 && prob < 90);
        });
      } else if (matchingCmd === '/mid') {
        categoryTitle = '🔵 MID CONFIDENCE (70% - 79%)';
        preds = preds.filter((p: any) => {
          const cat = (p.confidence_category || '').toUpperCase();
          const prob = p.probability || 0;
          return cat === 'MID_CONFIDENCE' || (prob >= 70 && prob < 80);
        });
      } else if (matchingCmd === '/low') {
        categoryTitle = '🟡 LOW CONFIDENCE VALUE LEANS (< 70%)';
        preds = preds.filter((p: any) => {
          const cat = (p.confidence_category || '').toUpperCase();
          const prob = p.probability || 0;
          return cat === 'LOW_CONFIDENCE' || (prob > 0 && prob < 70);
        });
      } else if (matchingCmd === '/goals') {
        categoryTitle = '⚡ OVER 2.5 & GOALS HUB';
        preds = preds.filter((p: any) =>
          (p.market && (p.market.toLowerCase().includes('over') || p.market.toLowerCase().includes('under') || p.market.toLowerCase().includes('goal') || p.market.toLowerCase().includes('btts'))) ||
          (p.prediction && (p.prediction.toLowerCase().includes('over') || p.prediction.toLowerCase().includes('under') || p.prediction.toLowerCase().includes('goal')))
        );
      }

      if (preds.length === 0) {
        await sendTelegramMessage(
          chatId,
          `⚽ No matching actionable predictions found for *${matchingCmd}* right now.\n\nUse /today to see all active predictions, or check back after the next automated simulation run!`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // Build Telegram message
      let reply = `⚽ *Oddsbanta VIP Predictions*\n`;
      reply += `🏷️ *Filter:* ${categoryTitle}\n`;
      reply += `📅 Generated with 250,000 Poisson-Monte Carlo draws\n\n`;

      preds.slice(0, 10).forEach((p: any, idx: number) => {
        const f = p.fixture;
        const home = f?.home_team?.name?.replace(/-/g, ' ') || 'Home';
        const away = f?.away_team?.name?.replace(/-/g, ' ') || 'Away';
        const league = f?.league?.code || f?.league?.name || 'League';
        const prob = Math.round(p.probability || 0);
        const time = new Date(p.target_kickoff_at || f?.target_kickoff_at).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Lagos',
        });

        reply += `*${idx + 1}. ${home} vs ${away}*\n`;
        reply += `🏆 ${league} • ⏰ ${time} WAT\n`;
        reply += `🎯 Pick: *${p.prediction}* (${p.market})\n`;
        reply += `📊 Certainty: *${prob}%* • Tier: \`${p.confidence_category || 'CONSENSUS'}\`\n\n`;
      });

      if (preds.length > 10) {
        reply += `_...and ${preds.length - 10} more fixtures on [Oddsbanta Dashboard](https://oddsbanta.com/dashboard)_\n\n`;
      }

      reply += `Quick Filters: /bangers | /toppicks | /high | /mid | /low | /goals`;

      await sendTelegramMessage(chatId, reply);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (text === '/settled') {
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
        await sendTelegramMessage(chatId, '📊 No recently settled predictions found.');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      let reply = `📊 *Oddsbanta Verified Track Record (Recent Settlements)*\n\n`;
      settled.forEach((p: any) => {
        const home = p.fixture?.home_team?.name || 'Home';
        const away = p.fixture?.away_team?.name || 'Away';
        const icon = p.settlement_status === 'won' ? '✅ WON' : '❌ LOST';
        const score = p.actual_score || `${p.fixture?.home_score ?? '?'}-${p.fixture?.away_score ?? '?'}`;
        reply += `• *${home} vs ${away}* (${score})\n  Pick: ${p.prediction} → *${icon}*\n`;
      });
      reply += `\nTrack record is 100% auditable at [Oddsbanta](https://oddsbanta.com/settlement).`;

      await sendTelegramMessage(chatId, reply);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Default reply
    await sendTelegramMessage(
      chatId,
      `❓ Unrecognized command. Use /help to see all available Oddsbanta commands.`
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('Error handling Telegram webhook:', err);
    return new Response(JSON.stringify({ ok: true, error: err.message }), { status: 200 });
  }
}
