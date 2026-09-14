import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

export const supabase: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey || 'placeholder-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
);

export interface UserAccessStatus {
  isPaid: boolean;
  tier: string;
  email?: string;
  userId?: string;
}

/**
 * Checks if a given WhatsApp phone number belongs to an active subscriber or admin.
 */
export async function getWhatsAppUserAccess(phone: string): Promise<UserAccessStatus> {
  if (!config.supabaseServiceRoleKey) {
    return { isPaid: false, tier: 'unconfigured' };
  }

  // Clean phone number (strip spaces, +, -, @s.whatsapp.net)
  const cleanPhone = phone.replace(/[^0-9]/g, '');

  try {
    // 1. Search for user by whatsapp_phone
    // Allow matching exact or without leading country code zeros
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, role, whatsapp_phone')
      .or(`whatsapp_phone.eq.${cleanPhone},whatsapp_phone.eq.+${cleanPhone}`)
      .limit(1);

    if (error || !users || users.length === 0) {
      return { isPaid: false, tier: 'unlinked' };
    }

    const user = users[0];
    const email = (user.email || '').toLowerCase().trim();

    // 2. Check Admin privilege (Role = 'admin' or in universal admin list)
    if (user.role === 'admin' || config.adminEmails.includes(email)) {
      return { isPaid: true, tier: 'ADMIN VIP', email, userId: user.id };
    }

    // 3. Check Entitlements table
    const { data: entitlements } = await supabase
      .from('entitlements')
      .select('tier, valid_until, features')
      .eq('user_id', user.id)
      .limit(1);

    if (entitlements && entitlements.length > 0) {
      const ent = entitlements[0];
      const validUntil = ent.valid_until ? new Date(ent.valid_until).getTime() : Infinity;
      if (validUntil > Date.now() && ['standard', 'bigbang', 'pro', 'premium', 'admin', 'vip'].includes(ent.tier?.toLowerCase())) {
        return { isPaid: true, tier: ent.tier.toUpperCase(), email, userId: user.id };
      }
      if (ent.tier === 'admin' || ent.features?.admin === true) {
        return { isPaid: true, tier: 'ADMIN VIP', email, userId: user.id };
      }
    }

    // 4. Check Subscriptions table
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('tier, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1);

    if (subscriptions && subscriptions.length > 0) {
      return { isPaid: true, tier: subscriptions[0].tier.toUpperCase(), email, userId: user.id };
    }

    return { isPaid: false, tier: 'Free', email, userId: user.id };
  } catch (err) {
    console.error('Error checking user access:', err);
    return { isPaid: false, tier: 'error' };
  }
}

/**
 * Links a WhatsApp phone number to an Oddsbanta user using their linking code (e.g. ODDS-4921)
 */
export async function linkUserByToken(phone: string, token: string): Promise<{ success: boolean; email?: string; error?: string }> {
  if (!config.supabaseServiceRoleKey) return { success: false, error: 'Database service unavailable.' };

  const cleanToken = token.trim().toUpperCase();
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const nowIso = new Date().toISOString();

  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email')
      .eq('telegram_auth_token', cleanToken)
      .gt('telegram_auth_expires_at', nowIso)
      .limit(1);

    if (error || !users || users.length === 0) {
      return { success: false, error: 'Invalid or expired code. Generate a fresh code in your Oddsbanta profile settings.' };
    }

    const user = users[0];

    // Update user's whatsapp_phone
    const { error: updateErr } = await supabase
      .from('users')
      .update({
        whatsapp_phone: cleanPhone,
        telegram_auth_token: null, // consume token
        updated_at: nowIso
      })
      .eq('id', user.id);

    if (updateErr) {
      return { success: false, error: 'Failed to update WhatsApp link.' };
    }

    return { success: true, email: user.email };
  } catch (err: any) {
    return { success: false, error: err.message || 'Database error occurred.' };
  }
}

/**
 * Fetches today's predictions from Supabase.
 */
export async function fetchPredictions(): Promise<any[]> {
  try {
    const todayLagos = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    const { data: preds, error } = await supabase
      .from('football_predictions')
      .select(`
        id,
        fixture_id,
        market,
        prediction,
        probability,
        confidence_category,
        publication_status,
        target_kickoff_at,
        secondary_predictions,
        fixture:football_fixtures!inner (
          id,
          target_kickoff_at,
          status,
          home_team:football_teams!football_fixtures_home_team_id_fkey (name, short_name),
          away_team:football_teams!football_fixtures_away_team_id_fkey (name, short_name),
          league:football_leagues!inner (name, code, country)
        )
      `)
      .order('probability', { ascending: false })
      .limit(200);

    if (error || !preds) {
      console.error('Error fetching predictions:', error);
      return [];
    }

    // Filter to today's Lagos date
    return preds.filter((p: any) => {
      const ko = p.target_kickoff_at || p.fixture?.target_kickoff_at;
      if (!ko) return false;
      const dLagos = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(ko));
      return dLagos === todayLagos;
    });
  } catch (err) {
    console.error('Error in fetchPredictions:', err);
    return [];
  }
}

/**
 * Fetches settled predictions from Supabase.
 */
export async function fetchSettledPredictions(): Promise<any[]> {
  try {
    const { data: settled, error } = await supabase
      .from('football_predictions')
      .select(`
        id,
        market,
        prediction,
        probability,
        confidence_category,
        settlement_status,
        actual_score,
        target_kickoff_at,
        fixture:football_fixtures!inner (
          home_team:football_teams!football_fixtures_home_team_id_fkey (name, short_name),
          away_team:football_teams!football_fixtures_away_team_id_fkey (name, short_name),
          league:football_leagues!inner (name, code)
        )
      `)
      .in('settlement_status', ['won', 'lost', 'void'])
      .order('target_kickoff_at', { ascending: false })
      .limit(10);

    if (error || !settled) return [];
    return settled;
  } catch (err) {
    console.error('Error in fetchSettledPredictions:', err);
    return [];
  }
}

/**
 * Fetches Goal Specialist predictions from Supabase.
 */
export async function fetchGoalsPredictions(): Promise<any[]> {
  try {
    const todayLagos = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    const { data: goals, error } = await supabase
      .from('goals_predictions')
      .select(`
        id,
        market,
        predicted_outcome,
        probability,
        confidence_tier,
        xg_combined,
        target_kickoff_at,
        fixture:football_fixtures!inner (
          target_kickoff_at,
          home_team:football_teams!football_fixtures_home_team_id_fkey (name, short_name),
          away_team:football_teams!football_fixtures_away_team_id_fkey (name, short_name),
          league:football_leagues!inner (name, code)
        )
      `)
      .order('probability', { ascending: false })
      .limit(100);

    if (error || !goals) return [];

    return goals.filter((g: any) => {
      const ko = g.target_kickoff_at || g.fixture?.target_kickoff_at;
      if (!ko) return false;
      const dLagos = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(ko));
      return dLagos === todayLagos;
    });
  } catch (err) {
    console.error('Error in fetchGoalsPredictions:', err);
    return [];
  }
}
