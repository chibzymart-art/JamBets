import { getWhatsAppUserAccess, linkUserByToken, fetchPredictions, fetchSettledPredictions, fetchGoalsPredictions } from '../services/supabase';
import { formatMarketName, formatOutcome, formatKickoffTime } from '../utils/formatters';
import { config } from '../config';

export async function handleWhatsAppMessage(fromPhone: string, text: string): Promise<string> {
  const cleanText = (text || '').trim();
  const lower = cleanText.toLowerCase();

  // 1. Account Linking: LINK ODDS-XXXX
  if (lower.startsWith('link')) {
    const parts = cleanText.split(/\s+/);
    if (parts.length < 2) {
      return `❌ *Invalid Format*\n\nTo link your Oddsbanta account, type:\n*LINK ODDS-XXXX*\n\n_(Get your code from oddsbanta.com profile settings)_`;
    }
    const token = parts[1].toUpperCase();
    const linkRes = await linkUserByToken(fromPhone, token);
    if (linkRes.success) {
      return `✅ *Account Linked Successfully!*\n\nConnected to: *${linkRes.email}*\nYour WhatsApp phone is now synced with your Oddsbanta VIP privileges.\n\nType *TODAY* or *BANGERS* to start viewing predictions!`;
    } else {
      return `❌ *Link Failed*\n\n${linkRes.error || 'Invalid code.'}\n\nPlease generate a new code on *${config.websiteUrl}*.`;
    }
  }

  // Check user VIP status
  const userAccess = await getWhatsAppUserAccess(fromPhone);

  // 2. Help / Menu
  if (lower === 'help' || lower === 'menu' || lower === '?' || lower === 'hi' || lower === 'hello' || lower === 'start') {
    return (
      `🤖 *Welcome to Oddsbanta VIP Predictions Bot*\n` +
      `_Precision AI Football Analysis & 250k Monte Carlo Draws_\n\n` +
      `Your Status: *${userAccess.isPaid ? '⭐ ' + userAccess.tier : 'Free Access'}*\n\n` +
      `📌 *Available Commands:*\n` +
      `*1* or *TODAY* — Today's Match Predictions\n` +
      `*2* or *BANGERS* — Super Bankers (80%+ Certainty)\n` +
      `*3* or *GOALS* — Over 2.5 & 1st Half Over 0.5\n` +
      `*4* or *SETTLED* — Auditable Win/Loss Settlements\n` +
      `*STATUS* — Check your subscription status\n` +
      `*LINK <CODE>* — Link your account (e.g. LINK ODDS-1234)\n\n` +
      `🌐 *Website:* ${config.websiteUrl}`
    );
  }

  // 3. Status Command
  if (lower === 'status') {
    if (userAccess.isPaid) {
      return (
        `⭐ *Oddsbanta VIP Status: ACTIVE*\n\n` +
        `• Account: *${userAccess.email || 'VIP Member'}*\n` +
        `• Tier: *${userAccess.tier}*\n` +
        `• Access: 100% Unlocked to all Super Bankers and Goals Signals.\n\n` +
        `Type *TODAY* or *BANGERS* to view matches.`
      );
    } else {
      return (
        `🔒 *Oddsbanta Status: Free Plan*\n\n` +
        `You are on the free teaser tier. High-conviction Super Bankers (80%+ win-rate target) are protected for VIP members.\n\n` +
        `⚡ *Upgrade to Standard (₦5,000/mo):*\n` +
        `${config.websiteUrl}/subscription\n\n` +
        `Already subscribed on the web? Link your account:\n` +
        `Type *LINK ODDS-XXXX* with your code from profile settings.`
      );
    }
  }

  // 4. Settled Matches (100% Free & Transparent for Everyone)
  if (lower === 'settled' || lower === '4') {
    const settled = await fetchSettledPredictions();
    if (settled.length === 0) {
      return `📊 *No recent settlements found.* Check back shortly after full-time whistles!`;
    }

    let msg = `📊 *Recent Match Settlements & Audit Ledger:*\n\n`;
    settled.forEach((p: any, idx: number) => {
      const ht = p.fixture?.home_team?.short_name || p.fixture?.home_team?.name || 'Home';
      const at = p.fixture?.away_team?.short_name || p.fixture?.away_team?.name || 'Away';
      const statusIcon = p.settlement_status === 'won' ? '✅ WON' : (p.settlement_status === 'lost' ? '❌ LOST' : '⊘ VOID');
      const score = p.actual_score || 'FT';
      const pick = formatOutcome(p.prediction);
      msg += `${idx + 1}. *${ht} vs ${at}* (${score})\n`;
      msg += `   Pick: ${pick} [${formatMarketName(p.market)}]\n`;
      msg += `   Result: *${statusIcon}*\n\n`;
    });
    msg += `🌐 Full auditable history: ${config.websiteUrl}`;
    return msg;
  }

  // 5. Bangers (Super Bankers >= 80%)
  if (lower === 'bangers' || lower === '2') {
    const allPreds = await fetchPredictions();
    // Filter to bangers or >= 80% probability
    const bangers = allPreds.filter((p: any) => {
      const prob = p.probability <= 1.0 ? p.probability * 100 : p.probability;
      return prob >= 80.0 && p.market !== 'NO_SAFE_BANKER' && p.prediction !== 'SKIP';
    });

    if (bangers.length === 0) {
      return `🔥 *No Super Bankers today.* Anti-Loss Guard active: passing volatile matches to protect bankrolls.`;
    }

    // Paywall Gate for Free Users
    if (!userAccess.isPaid) {
      const teaser = bangers[0];
      const ht = teaser.fixture?.home_team?.short_name || teaser.fixture?.home_team?.name || 'Home';
      const at = teaser.fixture?.away_team?.short_name || teaser.fixture?.away_team?.name || 'Away';
      const time = formatKickoffTime(teaser.target_kickoff_at || teaser.fixture?.target_kickoff_at);
      const prob = (teaser.probability <= 1 ? teaser.probability * 100 : teaser.probability).toFixed(1);

      return (
        `🔥 *Super Bankers Today (${bangers.length} Identified)*\n\n` +
        `🎁 *Free Teaser Pick:*\n` +
        `⚽ *${ht} vs ${at}* (${time})\n` +
        `🎯 Market: ${formatMarketName(teaser.market)}\n` +
        `💡 Pick: *${formatOutcome(teaser.prediction)}*\n` +
        `📊 Probability: *${prob}%*\n\n` +
        `────────────────────\n` +
        `🔒 *${bangers.length - 1} MORE SUPER BANKERS LOCKED*\n\n` +
        `High-conviction Bankers (80%–96%+ certainty) are reserved for active VIP members.\n\n` +
        `⚡ *Upgrade to Standard (₦5,000/mo) to unlock all ${bangers.length} picks:*\n` +
        `👉 ${config.websiteUrl}/subscription\n\n` +
        `_Already paid? Link account: LINK ODDS-XXXX_`
      );
    }

    // Full VIP Unlocked View
    let msg = `🔥 *Oddsbanta Super Bankers (${bangers.length} Matches)*\n`;
    msg += `_Verified 250k Monte Carlo Consensus & High Win-Rate Target_\n\n`;

    bangers.slice(0, 10).forEach((p: any, idx: number) => {
      const ht = p.fixture?.home_team?.short_name || p.fixture?.home_team?.name || 'Home';
      const at = p.fixture?.away_team?.short_name || p.fixture?.away_team?.name || 'Away';
      const league = p.fixture?.league?.name || 'League';
      const time = formatKickoffTime(p.target_kickoff_at || p.fixture?.target_kickoff_at);
      const prob = (p.probability <= 1 ? p.probability * 100 : p.probability).toFixed(1);
      const pick = formatOutcome(p.prediction);

      msg += `${idx + 1}. ⚽ *${ht} vs ${at}*\n`;
      msg += `   🏆 ${league} • ⏰ ${time}\n`;
      msg += `   🎯 Pick: *${pick}* [${formatMarketName(p.market)}]\n`;
      msg += `   ⚡ Certainty: *${prob}%* (${p.confidence_category || 'TOP PICK'})\n\n`;
    });

    msg += `🌐 Analyze simulations & stats: ${config.websiteUrl}`;
    return msg;
  }

  // 6. Goals Specialist Picks
  if (lower === 'goals' || lower === '3') {
    const goals = await fetchGoalsPredictions();
    if (goals.length === 0) {
      return `⚽ *No high-confidence Goal signals today.* Check back later!`;
    }

    if (!userAccess.isPaid) {
      const teaser = goals[0];
      const ht = teaser.fixture?.home_team?.short_name || teaser.fixture?.home_team?.name || 'Home';
      const at = teaser.fixture?.away_team?.short_name || teaser.fixture?.away_team?.name || 'Away';
      const time = formatKickoffTime(teaser.target_kickoff_at || teaser.fixture?.target_kickoff_at);
      const prob = (teaser.probability <= 1 ? teaser.probability * 100 : teaser.probability).toFixed(1);

      return (
        `⚽ *Goals Specialist Feed (${goals.length} Picks Today)*\n\n` +
        `🎁 *Free Sample:*\n` +
        `• *${ht} vs ${at}* (${time})\n` +
        `  Pick: *${formatOutcome(teaser.predicted_outcome)}* [${formatMarketName(teaser.market)}]\n` +
        `  Certainty: *${prob}%*\n\n` +
        `🔒 *${goals.length - 1} Goal Specialist picks locked.*\n` +
        `Unlock full daily Over 2.5 & 1H Over 0.5 feeds:\n` +
        `👉 ${config.websiteUrl}/subscription`
      );
    }

    let msg = `⚽ *Oddsbanta Goal Specialist Picks (${goals.length})*\n\n`;
    goals.slice(0, 10).forEach((g: any, idx: number) => {
      const ht = g.fixture?.home_team?.short_name || g.fixture?.home_team?.name || 'Home';
      const at = g.fixture?.away_team?.short_name || g.fixture?.away_team?.name || 'Away';
      const time = formatKickoffTime(g.target_kickoff_at || g.fixture?.target_kickoff_at);
      const prob = (g.probability <= 1 ? g.probability * 100 : g.probability).toFixed(1);
      msg += `${idx + 1}. *${ht} vs ${at}* (${time})\n`;
      msg += `   🎯 ${formatMarketName(g.market)}: *${formatOutcome(g.predicted_outcome)}* (${prob}%)\n\n`;
    });
    return msg;
  }

  // 7. Today's Predictions (General Feed)
  if (lower === 'today' || lower === '1') {
    const allPreds = await fetchPredictions();
    const valid = allPreds.filter((p: any) => p.market !== 'NO_SAFE_BANKER' && p.prediction !== 'SKIP');

    if (valid.length === 0) {
      return `📅 *No active predictions scheduled for today.* Simulations run every morning!`;
    }

    if (!userAccess.isPaid) {
      const teaser = valid[0];
      const ht = teaser.fixture?.home_team?.short_name || teaser.fixture?.home_team?.name || 'Home';
      const at = teaser.fixture?.away_team?.short_name || teaser.fixture?.away_team?.name || 'Away';
      const time = formatKickoffTime(teaser.target_kickoff_at || teaser.fixture?.target_kickoff_at);
      const prob = (teaser.probability <= 1 ? teaser.probability * 100 : teaser.probability).toFixed(1);

      return (
        `📅 *Today's Match Predictions (${valid.length} Matches)*\n\n` +
        `🎁 *Free Teaser Match:*\n` +
        `⚽ *${ht} vs ${at}* (${time})\n` +
        `🎯 Pick: *${formatOutcome(teaser.prediction)}* [${formatMarketName(teaser.market)}]\n` +
        `⚡ Simulated Win Probability: *${prob}%*\n\n` +
        `────────────────────\n` +
        `🔒 *${valid.length - 1} More Today's Banker Picks Locked*\n\n` +
        `Upgrade to unlock all ${valid.length} today's picks with odds & simulations:\n` +
        `👉 ${config.websiteUrl}/subscription\n\n` +
        `_Already subscribed? Type: LINK ODDS-XXXX_`
      );
    }

    let msg = `📅 *Today's Oddsbanta Matches (${valid.length})*\n\n`;
    valid.slice(0, 8).forEach((p: any, idx: number) => {
      const ht = p.fixture?.home_team?.short_name || p.fixture?.home_team?.name || 'Home';
      const at = p.fixture?.away_team?.short_name || p.fixture?.away_team?.name || 'Away';
      const time = formatKickoffTime(p.target_kickoff_at || p.fixture?.target_kickoff_at);
      const prob = (p.probability <= 1 ? p.probability * 100 : p.probability).toFixed(1);
      msg += `${idx + 1}. *${ht} vs ${at}* (${time})\n`;
      msg += `   👉 *${formatOutcome(p.prediction)}* (${prob}%) [${formatMarketName(p.market)}]\n\n`;
    });
    msg += `🌐 Full dashboard: ${config.websiteUrl}`;
    return msg;
  }

  // Fallback for unknown input
  return (
    `❓ Unrecognized command: "*${cleanText.slice(0, 20)}*"\n\n` +
    `Type *MENU* or enter a number:\n` +
    `*1* — Today's Predictions\n` +
    `*2* — Super Bankers\n` +
    `*3* — Goal Specialist\n` +
    `*4* — Settled Results\n` +
    `*STATUS* — Check VIP plan`
  );
}
