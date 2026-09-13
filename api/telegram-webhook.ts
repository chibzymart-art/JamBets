export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Admin email list for direct telegram access
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

  if (user.role === 'admin' || ADMIN_EMAILS.includes(email)) {
    return { isPaid: true, tier: 'Admin VIP' };
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Check active entitlements
  const entRes = await fetch(
    `${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${user.id}&select=tier,valid_until&limit=1`,
    { headers }
  );
  if (entRes.ok) {
    const entData = await entRes.json();
    if (Array.isArray(entData) && entData.length > 0) {
      const ent = entData[0];
      const validUntil = ent.valid_until ? new Date(ent.valid_until).getTime() : Infinity;
      if (validUntil > Date.now() && ['standard', 'bigbang', 'pro', 'premium', 'admin'].includes(ent.tier)) {
        return { isPaid: true, tier: ent.tier.toUpperCase() };
      }
    }
  }

  // Check active subscriptions
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
    return { success: false, error: 'Invalid or expired code. Please generate a new code on the website.' };
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
    return new Response(JSON.stringify({ ok: true, status: 'JamBets Telegram Webhook Active' }), {
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
            `🎉 *Account Connected Successfully!*\n\nWelcome *${linkResult.email}*!\nYour JamBets account is now linked to Telegram.\n\nReady to pull calibrated predictions:\n• /today - All scheduled match predictions\n• /bangers - Super Bankers (P >= 80%)\n• /goals - Over 2.5 Goals / Over 0.5 1st Half\n• /settled - Verified match settlements\n• /status - Your subscription status`
          );
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        } else {
          await sendTelegramMessage(
            chatId,
            `⚠️ *Connection Failed*\n${linkResult.error}\n\nPlease visit [JamBets Dashboard](https://jambets.vercel.app/dashboard) to generate a fresh link code.`
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
          `👋 *Welcome Back to JamBets Sentinel VIP Bot!*\n\nAccount: *${linkedUser.email}*\nTier: *${authInfo.tier}*\n\nCommands:\n• /today - Today's calibrated match predictions\n• /bangers - Super Bankers (P >= 80%)\n• /goals - Over 2.5 & 1st Half Over 0.5\n• /settled - Track record & settlement\n• /status - Subscription details`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `👋 *Welcome to JamBets Sentinel VIP Bot!*\n\nTo access predictions on Telegram, link your JamBets account:\n\n1. Sign in to [JamBets](https://jambets.vercel.app/dashboard)\n2. Click *Connect Telegram VIP Bot*\n3. Click the instant deep link, or send:\n   \`/link YOUR_CODE\`\n\nNeed an account? Register at [JamBets](https://jambets.vercel.app/).`
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (text.startsWith('/link')) {
      const parts = text.split(' ');
      if (parts.length < 2 || !parts[1].trim()) {
        await sendTelegramMessage(
          chatId,
          `ℹ️ *Usage:* \`/link YOUR_CODE\`\n\nGenerate your link code inside your [JamBets Dashboard](https://jambets.vercel.app/dashboard).`
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
          `🔒 *Not Linked*\nYour Telegram account is not connected to a JamBets user profile.\n\nConnect your account at [JamBets Dashboard](https://jambets.vercel.app/dashboard).`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const authInfo = await isUserPaidOrAdmin(user);
      await sendTelegramMessage(
        chatId,
        `📊 *JamBets Subscription Status*\n\n• Email: *${user.email}*\n• Access Tier: *${authInfo.tier}*\n• VIP Unlocked: *${authInfo.isPaid ? 'YES ✅' : 'NO ❌'}*\n• Bot Status: *Active 🟢*\n\n${authInfo.isPaid ? 'You have full access to all prediction feeds.' : 'Upgrade to Standard or BigBang VIP at https://jambets.vercel.app/subscription to unlock instant Telegram feeds.'}`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (text === '/help') {
      await sendTelegramMessage(
        chatId,
        `🤖 *JamBets Bot Command Reference*\n\n` +
        `• /today - All scheduled match predictions for today\n` +
        `• /bangers - High-confidence & Super Banker picks (P >= 80%)\n` +
        `• /goals - Over 2.5 Goals & 1st Half Over 0.5 picks\n` +
        `• /settled - Recently settled match results\n` +
        `• /status - Check your subscription and account status\n` +
        `• /link <CODE> - Link your JamBets website profile\n\n` +
        `🌐 Website: https://jambets.vercel.app`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Predictions Commands: /today, /bangers, /goals, /settled
    if (text === '/today' || text === '/bangers' || text === '/goals') {
      const user = await getLinkedUser(chatId);
      if (!user) {
        await sendTelegramMessage(
          chatId,
          `🔒 *Authentication Required*\n\nPlease link your JamBets account first to pull predictions.\n\n1. Sign in at [JamBets](https://jambets.vercel.app/dashboard)\n2. Click *Connect Telegram VIP Bot*\n3. Enter the code here: \`/link YOUR_CODE\``
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const authInfo = await isUserPaidOrAdmin(user);
      if (!authInfo.isPaid) {
        await sendTelegramMessage(
          chatId,
          `🔒 *VIP Access Required*\n\nYour account is currently on the *Free Tier*.\nTo unlock live 250,000-simulated predictions directly in Telegram, upgrade your plan:\n\n👉 [Upgrade to VIP (₦5,000/mo)](https://jambets.vercel.app/subscription)`
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
        `${SUPABASE_URL}/rest/v1/football_predictions?select=${selectFields}&publication_status=eq.published&settlement_status=eq.pending&order=target_kickoff_at.asc&limit=30`,
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

      if (text === '/bangers') {
        preds = preds.filter((p: any) =>
          ['HIGH_CONFIDENCE', 'SUPER_BANKER'].includes(p.confidence_category) || (p.probability && p.probability >= 80)
        );
      } else if (text === '/goals') {
        preds = preds.filter((p: any) =>
          (p.market && (p.market.includes('Over') || p.market.includes('Under') || p.market.includes('Goal'))) ||
          (p.prediction && (p.prediction.includes('OVER') || p.prediction.includes('UNDER')))
        );
      }

      if (preds.length === 0) {
        await sendTelegramMessage(chatId, `⚽ No matching fixtures found for *${text}* right now. Check back soon!`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // Build Telegram message
      let reply = `⚽ *JamBets VIP Predictions (${text.toUpperCase()})*\n`;
      reply += `📅 Generated with 250,000 Dixon-Coles Monte Carlo draws\n\n`;

      preds.slice(0, 10).forEach((p: any, idx: number) => {
        const f = p.fixture;
        const home = f?.home_team?.name || 'Home';
        const away = f?.away_team?.name || 'Away';
        const league = f?.league?.code || f?.league?.name || 'League';
        const prob = Math.round(p.probability || 0);
        const time = new Date(p.target_kickoff_at || f?.target_kickoff_at).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Lagos',
        });

        reply += `*${idx + 1}. ${home} vs ${away}*\n`;
        reply += `🏆 ${league} • ⏰ ${time} WAT\n`;
        reply += `🎯 Pick: *${p.prediction}* (${prob}%)\n`;
        reply += `📊 Category: \`${p.confidence_category || 'CONSENSUS'}\`\n\n`;
      });

      if (preds.length > 10) {
        reply += `_...and ${preds.length - 10} more fixtures on [JamBets Dashboard](https://jambets.vercel.app/dashboard)_`;
      }

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

      let reply = `📊 *JamBets Verified Track Record (Recent Settlements)*\n\n`;
      settled.forEach((p: any) => {
        const home = p.fixture?.home_team?.name || 'Home';
        const away = p.fixture?.away_team?.name || 'Away';
        const icon = p.settlement_status === 'won' ? '✅ WON' : '❌ LOST';
        const score = p.actual_score || `${p.fixture?.home_score ?? '?'}-${p.fixture?.away_score ?? '?'}`;
        reply += `• *${home} vs ${away}* (${score})\n  Pick: ${p.prediction} → *${icon}*\n`;
      });
      reply += `\nTrack record is 100% auditable at [JamBets](https://jambets.vercel.app/settlement).`;

      await sendTelegramMessage(chatId, reply);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Default reply
    await sendTelegramMessage(
      chatId,
      `❓ Unrecognized command. Use /help to see all available commands.`
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('Error handling Telegram webhook:', err);
    return new Response(JSON.stringify({ ok: true, error: err.message }), { status: 200 });
  }
}
