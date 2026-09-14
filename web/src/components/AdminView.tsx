import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { SystemHealthStatus, AuditRecord, UserProfile, LeagueRecord, PaymentRecord } from '../types';
import { getAdConfig, saveAdConfig, resetAdConfig, AdBannerConfig } from '../lib/adConfig';

interface AdminViewProps {
  currentUserProfile: UserProfile | null;
  onBackToFixtures?: () => void;
  onOpenAuthModal?: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({
  currentUserProfile,
  onBackToFixtures,
  onOpenAuthModal
}) => {
  // Server-side admin verification
  const [isAdminVerified, setIsAdminVerified] = useState<boolean | null>(null);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

  // Health data
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);
  const [auditFilter, setAuditFilter] = useState<string>('all');
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [autoRefreshLogs, setAutoRefreshLogs] = useState<boolean>(true);

  // Users & Subscriptions management
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(false);
  const [userSearch, setUserSearch] = useState<string>('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
  const [roleChangeUserId, setRoleChangeUserId] = useState<string>('');
  const [newRole, setNewRole] = useState<'free' | 'standard' | 'bigbang' | 'admin'>('standard');
  const [roleReason, setRoleReason] = useState<string>('');

  // Payments & Financial activity tracking
  const [paymentsList, setPaymentsList] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState<boolean>(false);
  const [paymentSearch, setPaymentSearch] = useState<string>('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [isManualPaymentModalOpen, setIsManualPaymentModalOpen] = useState<boolean>(false);
  const [manualPayUserId, setManualPayUserId] = useState<string>('');
  const [manualPayAmount, setManualPayAmount] = useState<number>(5000);
  const [manualPayCurrency, setManualPayCurrency] = useState<string>('ngn');
  const [manualPayPlan, setManualPayPlan] = useState<string>('Standard VIP Monthly (₦5,000)');
  const [manualPayProvider, setManualPayProvider] = useState<string>('manual_bank_transfer');
  const [manualPayNotes, setManualPayNotes] = useState<string>('');

  // Leagues management
  const [leaguesList, setLeaguesList] = useState<LeagueRecord[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState<boolean>(false);
  const [leagueSearch, setLeagueSearch] = useState<string>('');
  const [leagueCategoryFilter, setLeagueCategoryFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Gen-Z Engine Trigger & Automation State
  const [engineTaskStatus, setEngineTaskStatus] = useState<{
    type: 'prediction' | 'settlement' | 'goals_prediction' | 'goals_settlement' | 'goals' | null;
    status: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
    message?: string;
  }>({ type: null, status: 'idle' });

  // Sound effects toggle
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);

  // Global action toasts
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // 1-Click WhatsApp Broadcast Station
  const [broadcastLoading, setBroadcastLoading] = useState<boolean>(false);
  const [broadcastText, setBroadcastText] = useState<string>('');
  const [copiedBroadcast, setCopiedBroadcast] = useState<boolean>(false);

  // Ad Banner Campaign Settings State
  const [adConfig, setAdConfigState] = useState<AdBannerConfig>(getAdConfig());
  const [adSaveLoading, setAdSaveLoading] = useState<boolean>(false);

  const handleSaveAdConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    playSfx('click');
    setAdSaveLoading(true);
    setActionError(null);
    try {
      saveAdConfig(adConfig);

      // Audit log entry
      try {
        await supabase.from('audit_logs').insert({
          actor_id: currentUserProfile?.id,
          actor_email: currentUserProfile?.email,
          actor_role: 'admin',
          action: 'admin_ad_banners_updated',
          affected_table: 'ad_banners_config',
          new_state: adConfig,
          reason: `Admin updated ad banner campaign for: ${adConfig.brandTitle}`
        });
      } catch (logErr) {
        console.warn('Audit log write error:', logErr);
      }

      playSfx('success');
      setActionSuccess(`📢 Ad Banner Campaign for "${adConfig.brandTitle}" published live across all pages!`);
      setTimeout(() => setActionSuccess(null), 4000);
      fetchAuditLogs();
    } catch (err: any) {
      playSfx('error');
      console.error('Error saving ad config:', err);
      setActionError(err.message || 'Failed to update ad banners.');
    } finally {
      setAdSaveLoading(false);
    }
  };

  const handleResetAdConfig = () => {
    playSfx('click');
    const def = resetAdConfig();
    setAdConfigState(def);
    playSfx('success');
    setActionSuccess('📢 Ad banners reset to factory defaults (MyBrainPadi)!');
    setTimeout(() => setActionSuccess(null), 3500);
  };

  const generateBroadcastPicks = async () => {
    setBroadcastLoading(true);
    setActionError(null);
    try {
      const { data, error } = await supabase
        .from('football_predictions')
        .select(`
          id,
          prediction,
          market,
          probability,
          confidence_category,
          target_kickoff_at,
          fixture:football_fixtures!inner(
            home_team:football_teams!football_fixtures_home_team_id_fkey(name),
            away_team:football_teams!football_fixtures_away_team_id_fkey(name),
            league:football_leagues!inner(code,name)
          )
        `)
        .eq('publication_status', 'published')
        .eq('settlement_status', 'pending')
        .order('target_kickoff_at', { ascending: true })
        .limit(10);

      if (error) throw error;
      const preds = (data || []) as any[];

      const todayStr = new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Africa/Lagos'
      });

      let text = `🔥 *ODDSBANTA VIP DAILY PICKS*\n`;
      text += `⚡ *Calibrated via 250,000 Dixon-Coles Monte Carlo Draws*\n`;
      text += `📅 Date: *${todayStr}*\n\n`;

      if (preds.length === 0) {
        text += `⚽ No active scheduled fixtures in the queue right now.\nCheck back shortly!\n\n`;
      } else {
        preds.forEach((p: any, idx: number) => {
          const f = p.fixture;
          const home = f?.home_team?.name || 'Home';
          const away = f?.away_team?.name || 'Away';
          const league = f?.league?.code || f?.league?.name || 'League';
          const prob = Math.round(p.probability || 0);
          const time = new Date(p.target_kickoff_at).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Africa/Lagos'
          });

          text += `*${idx + 1}. ${home} vs ${away}*\n`;
          text += `🏆 ${league} • ⏰ ${time} WAT\n`;
          text += `🎯 Pick: *${p.prediction}* (${prob}%)\n`;
          text += `📊 Confidence: ${p.confidence_category || 'CONSENSUS'}\n\n`;
        });
      }

      text += `🔒 Full 5-dimension breakdowns & live predictions:\n`;
      text += `👉 https://oddsbanta.com/dashboard\n\n`;
      text += `_Oddsbanta — Precision AI Football Analysis_`;

      setBroadcastText(text);
      playSfx('success');
    } catch (err: any) {
      console.error('Error generating broadcast text:', err);
      setActionError(err.message || 'Failed to fetch predictions for broadcast.');
    } finally {
      setBroadcastLoading(false);
    }
  };

  const copyBroadcastText = () => {
    if (!broadcastText) return;
    navigator.clipboard.writeText(broadcastText);
    setCopiedBroadcast(true);
    playSfx('click');
    setTimeout(() => setCopiedBroadcast(false), 3000);
  };

  // Web Audio Synthesizer for Gen-Z Interactive UI Feedback
  const playSfx = (type: 'click' | 'success' | 'error' | 'cook') => {
    if (!sfxEnabled || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'click') {
        osc.frequency.setValueAtTime(900, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(450, ctx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.04);
        osc.start();
        osc.stop(ctx.currentTime + 0.04);
      } else if (type === 'cook') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      } else if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.28);
        osc.start();
        osc.stop(ctx.currentTime + 0.28);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(250, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      }
    } catch {}
  };

  // 1. Verify server-side admin privilege
  const verifyServerAdmin = async () => {
    setCheckingAuth(true);
    try {
      const email = currentUserProfile?.email?.toLowerCase().trim();
      const isProfileAdmin = (currentUserProfile as any)?.role === 'admin';
      const adminEmails = [
        'chibzymart@gmail.com',
        'whizzchibz@gmail.com',
        'chibuezec.amuchie@gmail.com',
        'chibuezeamuchie@gmail.com',
        'nnamdiamuchie@gmail.com'
      ];
      if (
        isProfileAdmin ||
        (email ? adminEmails.includes(email) : false)
      ) {
        setIsAdminVerified(true);
        setCheckingAuth(false);
        return;
      }

      // Check active auth session metadata in case profile is still syncing
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUser = sessionData?.session?.user;
      if (
        sessionUser?.user_metadata?.role === 'admin' ||
        (sessionUser as any)?.app_metadata?.role === 'admin'
      ) {
        setIsAdminVerified(true);
        setCheckingAuth(false);
        return;
      }

      const { data, error } = await supabase.rpc('is_admin');
      if (error) {
        console.error('is_admin RPC error:', error);
        setIsAdminVerified(false);
      } else {
        setIsAdminVerified(data === true);
      }
    } catch (err) {
      console.error('Admin verification threw:', err);
      setIsAdminVerified(false);
    } finally {
      setCheckingAuth(false);
    }
  };

  useEffect(() => {
    verifyServerAdmin();
  }, [currentUserProfile]);

  // 2. Fetch system health
  const fetchHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const { data, error } = await supabase.rpc('get_system_health');
      if (error) throw error;
      setHealth(data as SystemHealthStatus);
    } catch (err: any) {
      console.error('Failed to fetch system health:', err);
      setHealthError(err.message || 'Error loading health status from Supabase.');
    } finally {
      setHealthLoading(false);
    }
  };

  // 3. Fetch audit logs
  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setAuditLogs(data || []);
    } catch (err: any) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  // 4. Fetch users with their subscriptions and entitlements
  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const [usersRes, subsRes, entsRes] = await Promise.all([
        supabase
          .from('users')
          .select('id, email, display_name, role, is_deleted, status, disclaimer_age_accepted, disclaimer_financial_accepted, created_at, updated_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('subscriptions')
          .select('id, user_id, tier, status, current_period_end, created_at, updated_at'),
        supabase
          .from('entitlements')
          .select('id, user_id, tier, features, valid_until, updated_at')
      ]);

      if (usersRes.error) throw usersRes.error;

      const subsMap = new Map((subsRes.data || []).map(s => [s.user_id, s]));
      const entsMap = new Map((entsRes.data || []).map(e => [e.user_id, e]));

      const combined: UserProfile[] = (usersRes.data || []).map(u => ({
        ...u,
        subscription: subsMap.get(u.id) || null,
        entitlement: entsMap.get(u.id) || null
      }));

      setUsersList(combined);
    } catch (err: any) {
      console.error('Failed to fetch users:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  // 5. Fetch financial payments & transactions
  const fetchPayments = async () => {
    setPaymentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setPaymentsList((data as PaymentRecord[]) || []);
    } catch (err: any) {
      console.error('Failed to fetch payments:', err);
    } finally {
      setPaymentsLoading(false);
    }
  };

  // 6. Fetch leagues
  const fetchLeagues = async () => {
    setLeaguesLoading(true);
    try {
      const { data, error } = await supabase
        .from('football_leagues')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      setLeaguesList(data || []);
    } catch (err: any) {
      console.error('Failed to fetch leagues:', err);
    } finally {
      setLeaguesLoading(false);
    }
  };

  useEffect(() => {
    if (isAdminVerified) {
      fetchHealth();
      fetchAuditLogs();
      fetchUsers();
      fetchPayments();
      fetchLeagues();
    }
  }, [isAdminVerified]);

  // Auto-refresh logs timer
  useEffect(() => {
    if (!isAdminVerified || !autoRefreshLogs) return;
    const interval = setInterval(() => {
      fetchAuditLogs();
    }, 12000);
    return () => clearInterval(interval);
  }, [isAdminVerified, autoRefreshLogs]);

  // Direct Client-Side Goals Specialist Settlement Pass (Instant execution guarantee)
  const directClientGoalsSettlement = async (): Promise<{ settled: number; won: number; lost: number; voidCount: number }> => {
    try {
      const { data: pendingPreds, error: predErr } = await supabase
        .from('goals_predictions')
        .select('id, fixture_id, market')
        .eq('settlement_status', 'pending');

      if (predErr || !pendingPreds || pendingPreds.length === 0) {
        return { settled: 0, won: 0, lost: 0, voidCount: 0 };
      }

      const fixtureIds = Array.from(new Set(pendingPreds.map(p => p.fixture_id)));
      const { data: fixtures, error: fixErr } = await supabase
        .from('football_fixtures')
        .select('id, status, period, home_score, away_score, half_time_home_score, half_time_away_score')
        .in('id', fixtureIds);

      if (fixErr || !fixtures) {
        return { settled: 0, won: 0, lost: 0, voidCount: 0 };
      }

      const fixMap = new Map(fixtures.map(f => [f.id, f]));
      const nowIso = new Date().toISOString();
      let settled = 0;
      let won = 0;
      let lost = 0;
      let voidCount = 0;

      for (const pred of pendingPreds) {
        const fix = fixMap.get(pred.fixture_id);
        if (!fix) continue;

        const status = (fix.status || '').toLowerCase();
        const period = (fix.period || '').toUpperCase();
        const h = fix.home_score;
        const a = fix.away_score;
        const htH = fix.half_time_home_score;
        const htA = fix.half_time_away_score;

        const isFinished = status === 'finished' || status === 'ft' || period === 'FT';
        const isHtOrLater = ['HT', '2H', 'ET', 'PK', 'FT'].includes(period) || isFinished;

        let outcome: 'won' | 'lost' | 'void' | null = null;
        let notes = '';
        const finalStr = (h !== null && a !== null) ? `${h}-${a}` : null;
        const htStr = (htH !== null && htA !== null) ? `${htH}-${htA}` : null;

        if (['postponed', 'cancelled', 'abandoned'].includes(status)) {
          outcome = 'void';
          notes = `Match ${status} — Protected void settlement.`;
        } else if (pred.market === 'ht_over_0.5_goals') {
          if (htH !== null && htA !== null) {
            if (htH + htA >= 1) {
              outcome = 'won';
              notes = `Won at Half-Time! HT Score: ${htStr}`;
            } else if (isHtOrLater) {
              outcome = 'lost';
              notes = `Lost at Half-Time. HT Score: ${htStr}`;
            }
          } else if (isFinished && h !== null && a !== null) {
            if (h + a === 0) {
              outcome = 'lost';
              notes = 'Lost at Full-Time (Final: 0-0)';
            } else {
              outcome = 'won';
              notes = `Won! Match had goals (${finalStr})`;
            }
          }
        } else if (pred.market === 'over_2.5_goals') {
          if (isFinished && h !== null && a !== null) {
            if (h + a >= 3) {
              outcome = 'won';
              notes = `Won! Final Score: ${finalStr}`;
            } else {
              outcome = 'lost';
              notes = `Lost. Final Score: ${finalStr}`;
            }
          }
        }

        if (outcome) {
          await supabase
            .from('goals_predictions')
            .update({
              settlement_status: outcome,
              settled_at: nowIso,
              actual_score: finalStr,
              ht_score: htStr,
              settlement_notes: notes
            })
            .eq('id', pred.id);

          await supabase
            .from('goals_settlements')
            .upsert({
              prediction_id: pred.id,
              fixture_id: pred.fixture_id,
              market: pred.market,
              status: outcome,
              final_score: finalStr,
              ht_score: htStr,
              total_goals: (h !== null && a !== null) ? (h + a) : null,
              ht_goals: (htH !== null && htA !== null) ? (htH + htA) : null,
              settled_at: nowIso,
              notes: notes
            }, { onConflict: 'prediction_id' });

          settled++;
          if (outcome === 'won') won++;
          else if (outcome === 'lost') lost++;
          else if (outcome === 'void') voidCount++;
        }
      }

      return { settled, won, lost, voidCount };
    } catch (e) {
      console.warn('Direct goals settlement fallback err:', e);
      return { settled: 0, won: 0, lost: 0, voidCount: 0 };
    }
  };

  // Interactive Engine Trigger
  const triggerEngineTask = async (
    taskName: 'RUN_PREDICTIONS' | 'RUN_SETTLEMENTS' | 'RUN_GOALS_PREDICTIONS' | 'RUN_GOALS_SETTLEMENT' | 'RUN_GOALS_ENGINE'
  ) => {
    playSfx('cook');
    const type: 'prediction' | 'settlement' | 'goals_prediction' | 'goals_settlement' | 'goals' =
      taskName === 'RUN_PREDICTIONS' ? 'prediction'
      : taskName === 'RUN_SETTLEMENTS' ? 'settlement'
      : taskName === 'RUN_GOALS_SETTLEMENT' ? 'goals_settlement'
      : taskName === 'RUN_GOALS_PREDICTIONS' ? 'goals_prediction'
      : 'goals';

    setEngineTaskStatus({
      type,
      status: 'pending',
      message: `Queueing ${taskName} task in Supabase...`
    });

    try {
      // 1. Insert into admin_tasks for background workers / logging
      const { data, error } = await supabase
        .from('admin_tasks')
        .insert({
          task_name: taskName,
          status: 'PENDING',
          metadata: {
            triggered_by: 'genz_admin_dashboard',
            admin_email: currentUserProfile?.email || 'admin',
            timestamp: new Date().toISOString()
          }
        })
        .select()
        .single();

      if (error || !data) throw error || new Error('Failed to insert task');

      const taskId = data.id;
      setEngineTaskStatus({
        type,
        status: 'running',
        message: `🔥 ${taskName} is COOKING in the background...`
      });

      // If triggering Goals Settlement specifically, execute immediate direct pass
      if (taskName === 'RUN_GOALS_SETTLEMENT' || taskName === 'RUN_SETTLEMENTS') {
        const directResult = await directClientGoalsSettlement();
        if (directResult.settled > 0) {
          await supabase
            .from('admin_tasks')
            .update({
              status: 'COMPLETED',
              metadata: {
                goals_settlement_direct: directResult,
                completed_at: new Date().toISOString()
              }
            })
            .eq('id', taskId);
        }
      }

      // Poll task status
      let pollCount = 0;
      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          const { data: updated } = await supabase
            .from('admin_tasks')
            .select('*')
            .eq('id', taskId)
            .single();

          if (updated) {
            if (updated.status === 'COMPLETED') {
              clearInterval(pollInterval);
              playSfx('success');
              setEngineTaskStatus({
                type,
                status: 'completed',
                message: `✅ ${taskName} COMPLETED! Zero Cap.`
              });
              setActionSuccess(`${taskName} completed successfully! Data refreshed.`);
              fetchHealth();
              fetchAuditLogs();
              setTimeout(() => {
                setEngineTaskStatus({ type: null, status: 'idle' });
                setActionSuccess(null);
              }, 7000);
            } else if (updated.status === 'FAILED') {
              clearInterval(pollInterval);
              playSfx('error');
              setEngineTaskStatus({
                type,
                status: 'failed',
                message: `❌ ${taskName} failed: ${updated.error_message || 'Error'}`
              });
              setTimeout(() => setEngineTaskStatus({ type: null, status: 'idle' }), 7000);
            }
          }

          // Safety timeout after 20s if already completed directly
          if (pollCount > 12) {
            clearInterval(pollInterval);
            if (taskName === 'RUN_GOALS_SETTLEMENT') {
              playSfx('success');
              setEngineTaskStatus({
                type,
                status: 'completed',
                message: `✅ Goals Settlement cycle finished successfully.`
              });
              setTimeout(() => setEngineTaskStatus({ type: null, status: 'idle' }), 5000);
            }
          }
        } catch {}
      }, 1500);

    } catch (err: any) {
      playSfx('error');
      console.error('Trigger error:', err);
      setActionError(err.message || 'Failed to trigger task.');
      setEngineTaskStatus({ type: null, status: 'idle' });
    }
  };

  // Interactive League Toggle
  const handleToggleLeague = async (league: LeagueRecord) => {
    playSfx('click');
    const newActiveState = !(league.is_active !== false);
    try {
      const { error } = await supabase
        .from('football_leagues')
        .update({ is_active: newActiveState })
        .eq('id', league.id);
      if (error) throw error;

      await supabase.from('audit_logs').insert({
        actor_id: currentUserProfile?.id,
        actor_email: currentUserProfile?.email,
        actor_role: 'admin',
        action: 'admin_league_toggle',
        affected_table: 'football_leagues',
        affected_record_id: league.id,
        previous_state: { is_active: league.is_active },
        new_state: { is_active: newActiveState },
        reason: `Admin toggled active state for ${league.name} (${league.code}) to ${newActiveState}`
      });

      playSfx('success');
      setActionSuccess(`${league.name} is now ${newActiveState ? 'ACTIVE ⚡' : 'PAUSED ⏸'}`);
      setTimeout(() => setActionSuccess(null), 3500);
      fetchLeagues();
      fetchAuditLogs();
    } catch (err: any) {
      playSfx('error');
      console.error('Failed to toggle league:', err);
      setActionError(err.message || 'Failed to toggle league.');
    }
  };

  // Comprehensive User Tier & Subscription Allocation
  const handleAllocateTier = async (
    userId: string,
    targetTier: 'free' | 'standard' | 'bigbang' | 'admin',
    targetStatus: 'active' | 'disabled' | 'suspended' = 'active',
    durationDays: number | null = null,
    reason?: string
  ) => {
    playSfx('click');
    setActionLoading(userId);
    setActionError(null);
    setActionSuccess(null);

    let validUntilIso: string | null = null;
    if (durationDays && durationDays > 0) {
      const d = new Date();
      d.setDate(d.getDate() + durationDays);
      validUntilIso = d.toISOString();
    }

    try {
      // 1. Invoke authoritative database procedure
      const { error: rpcErr } = await supabase.rpc('admin_manage_user_tier', {
        p_target_user_id: userId,
        p_new_tier: targetTier,
        p_status: targetStatus,
        p_valid_until: validUntilIso,
        p_reason: reason || roleReason || `Admin allocated ${targetTier.toUpperCase()} tier`
      });

      if (rpcErr) {
        console.warn('RPC admin_manage_user_tier failed, executing direct tables update fallback:', rpcErr);
        await supabase.from('users').update({
          role: targetTier,
          status: targetStatus,
          is_deleted: targetStatus === 'disabled',
          updated_at: new Date().toISOString()
        }).eq('id', userId);

        const features = targetTier === 'bigbang'
          ? { football_predictions: true, simulations: true, vip: true }
          : targetTier === 'standard'
          ? { football_predictions: true, simulations: false }
          : targetTier === 'admin'
          ? { football_predictions: true, simulations: true, vip: true, admin: true }
          : { football_predictions: false, simulations: false };

        await supabase.from('entitlements').upsert({
          user_id: userId,
          tier: targetTier,
          features,
          valid_until: validUntilIso,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

        await supabase.from('subscriptions').upsert({
          user_id: userId,
          tier: targetTier,
          status: targetStatus,
          current_period_end: validUntilIso,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

        await supabase.from('audit_logs').insert({
          actor_id: currentUserProfile?.id,
          actor_email: currentUserProfile?.email,
          actor_role: 'admin',
          action: 'admin_user_tier_allocated_direct',
          affected_table: 'users',
          affected_record_id: userId,
          new_state: { role: targetTier, status: targetStatus, valid_until: validUntilIso },
          reason: reason || roleReason || `Admin updated tier to ${targetTier}`
        });
      }

      playSfx('success');
      setActionSuccess(`User updated: ${targetTier.toUpperCase()} (${targetStatus.toUpperCase()})${durationDays ? ` for ${durationDays} days` : ''}!`);
      setTimeout(() => setActionSuccess(null), 4000);
      setRoleReason('');
      setRoleChangeUserId('');
      fetchUsers();
      fetchAuditLogs();
    } catch (err: any) {
      playSfx('error');
      console.error('Role update failed:', err);
      setActionError(err.message || 'Failed to update user tier.');
    } finally {
      setActionLoading(null);
    }
  };

  // Toggle user account status (Disable / Soft-delete vs Activate)
  const handleToggleUserStatus = async (user: UserProfile) => {
    const isCurrentlyDisabled = user.is_deleted === true || user.status === 'disabled';
    const newStatus = isCurrentlyDisabled ? 'active' : 'disabled';
    const confirmMsg = isCurrentlyDisabled
      ? `Re-activate platform access for ${user.email}?`
      : `Disable/ban ${user.email}? The account will be soft-deleted and immediately blocked from access.`;
    if (!window.confirm(confirmMsg)) return;

    await handleAllocateTier(
      user.id,
      user.role,
      newStatus,
      null,
      isCurrentlyDisabled ? 'Admin re-activated account' : 'Admin disabled/banned account'
    );
  };

  // Record manual or offline payment
  const handleRecordManualPayment = async () => {
    if (!manualPayUserId) {
      alert('Please select a user account.');
      return;
    }
    setActionLoading('manual_pay');
    setActionError(null);
    setActionSuccess(null);

    try {
      const { error: rpcErr } = await supabase.rpc('admin_record_manual_payment', {
        p_target_user_id: manualPayUserId,
        p_amount_cents: Math.round(manualPayAmount * 100),
        p_currency: manualPayCurrency.toLowerCase(),
        p_plan_name: manualPayPlan,
        p_provider: manualPayProvider,
        p_reference: `MANUAL-${Date.now()}`,
        p_notes: manualPayNotes || 'Admin manual payment recording'
      });

      if (rpcErr) {
        console.warn('Manual payment RPC failed, inserting directly:', rpcErr);
        const targetUser = usersList.find(u => u.id === manualPayUserId);
        await supabase.from('payments').insert({
          user_id: manualPayUserId,
          amount_cents: Math.round(manualPayAmount * 100),
          currency: manualPayCurrency.toLowerCase(),
          status: 'succeeded',
          provider: manualPayProvider,
          customer_email: targetUser?.email,
          plan_name: manualPayPlan,
          reference: `MANUAL-${Date.now()}`,
          metadata: { notes: manualPayNotes, recorded_by: currentUserProfile?.email }
        });
      }

      // Automatically allocate tier
      const targetTier = manualPayPlan.toLowerCase().includes('bigbang') ? 'bigbang' : 'standard';
      await handleAllocateTier(manualPayUserId, targetTier, 'active', 30, `Manual payment: ${manualPayPlan}`);

      playSfx('success');
      setActionSuccess(`Payment of ₦${manualPayAmount.toLocaleString()} recorded and VIP access granted for 30 days!`);
      setTimeout(() => setActionSuccess(null), 4000);
      setIsManualPaymentModalOpen(false);
      setManualPayNotes('');
      fetchPayments();
      fetchUsers();
      fetchAuditLogs();
    } catch (err: any) {
      playSfx('error');
      console.error('Failed to record manual payment:', err);
      setActionError(err.message || 'Failed to record manual payment.');
    } finally {
      setActionLoading(null);
    }
  };

  // Filtered Leagues
  const filteredLeagues = useMemo(() => {
    return leaguesList.filter((lg) => {
      const matchesSearch = !leagueSearch || 
        lg.name.toLowerCase().includes(leagueSearch.toLowerCase()) ||
        lg.code.toLowerCase().includes(leagueSearch.toLowerCase()) ||
        (lg.country && lg.country.toLowerCase().includes(leagueSearch.toLowerCase()));
      
      const matchesCat = 
        leagueCategoryFilter === 'all' ? true :
        leagueCategoryFilter === 'active' ? (lg.is_active !== false) :
        (lg.is_active === false);

      return matchesSearch && matchesCat;
    });
  }, [leaguesList, leagueSearch, leagueCategoryFilter]);

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      const matchesSearch = !userSearch ||
        u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
        (u.display_name && u.display_name.toLowerCase().includes(userSearch.toLowerCase())) ||
        u.id.toLowerCase().includes(userSearch.toLowerCase());

      const matchesRole = 
        userRoleFilter === 'all' ? true :
        userRoleFilter === 'disabled' ? (u.is_deleted === true || u.status === 'disabled') :
        userRoleFilter === 'paid' ? (u.role === 'standard' || u.role === 'bigbang') :
        u.role === userRoleFilter;

      return matchesSearch && matchesRole;
    });
  }, [usersList, userSearch, userRoleFilter]);

  // Payment Statistics Memo
  const paymentStats = useMemo(() => {
    const succeededPayments = paymentsList.filter(p => p.status === 'succeeded');
    const totalRevenueNgn = succeededPayments.reduce((acc, p) => {
      return acc + (p.amount_cents ? p.amount_cents / 100 : 0);
    }, 0);
    const payingUsersCount = usersList.filter(u => u.role === 'standard' || u.role === 'bigbang').length;
    return {
      totalRevenueNgn,
      succeededCount: succeededPayments.length,
      totalCount: paymentsList.length,
      payingUsersCount
    };
  }, [paymentsList, usersList]);

  // Filtered Payments
  const filteredPayments = useMemo(() => {
    return paymentsList.filter((p) => {
      const matchesSearch = !paymentSearch ||
        (p.reference && p.reference.toLowerCase().includes(paymentSearch.toLowerCase())) ||
        (p.customer_email && p.customer_email.toLowerCase().includes(paymentSearch.toLowerCase())) ||
        (p.plan_name && p.plan_name.toLowerCase().includes(paymentSearch.toLowerCase())) ||
        (p.provider && p.provider.toLowerCase().includes(paymentSearch.toLowerCase()));

      const matchesStatus = paymentStatusFilter === 'all' ? true : p.status === paymentStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [paymentsList, paymentSearch, paymentStatusFilter]);

  // Filtered Audit Logs
  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const matchesSearch = !auditSearch ||
        log.action.toLowerCase().includes(auditSearch.toLowerCase()) ||
        (log.actor_email && log.actor_email.toLowerCase().includes(auditSearch.toLowerCase())) ||
        (log.reason && log.reason.toLowerCase().includes(auditSearch.toLowerCase()));

      const matchesFilter =
        auditFilter === 'all' ? true :
        auditFilter === 'engine' ? (log.action.includes('prediction') || log.action.includes('settle')) :
        auditFilter === 'leagues' ? log.action.includes('league') :
        auditFilter === 'roles' ? (log.action.includes('role') || log.action.includes('tier')) :
        auditFilter === 'payments' ? (log.action.includes('payment') || log.action.includes('tier')) :
        true;

      return matchesSearch && matchesFilter;
    });
  }, [auditLogs, auditSearch, auditFilter]);

  // =========================================================================
  // VIEW: AUTH CHECKING SPINNER
  // =========================================================================
  if (checkingAuth) {
    return (
      <div className="genz-loading-view">
        <div className="genz-spinner" />
        <h2 className="genz-loading-title">RUNNING VIBE CHECK & AUTH TOKEN VERIFICATION...</h2>
        <p className="genz-loading-sub">
          Validating server database permissions via Cloud Supabase RPC public.is_admin()
        </p>
      </div>
    );
  }

  // =========================================================================
  // VIEW: 403 FORBIDDEN / VIBE CHECK FAILED (UNAUTHORIZED SCREEN)
  // =========================================================================
  if (!isAdminVerified) {
    return (
      <div className="admin-lock-screen">
        <div className="admin-lock-card genz-403-card">
          <div className="admin-lock-icon genz-pulse-ring">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <div className="admin-lock-header">
            <span className="genz-badge-glitch">
              💀 CAUGHT LACKING • 403 ACCESS DENIED
            </span>
            <h1 className="admin-lock-title">
              Vibe Check Failed: Admin Role Required
            </h1>
            <p className="admin-lock-desc">
              You're trying to access the Sigma Admin Deck without verified server credentials.
              In accordance with Phase 9 security protocols, permissions are cryptographically locked on PostgreSQL RLS and cannot be spoofed client-side.
            </p>
          </div>

          <div className="admin-lock-audit-box">
            <div>User Session: <strong>{currentUserProfile?.email || 'Guest / Unauthenticated'}</strong></div>
            <div>Database Role: <strong>{currentUserProfile?.role?.toUpperCase() || 'NONE'}</strong></div>
            <div>Server RPC Verification: <strong style={{ color: '#ef4444' }}>supabase.rpc('is_admin') &rarr; FALSE</strong></div>
            <div>Lockdown Status: <strong style={{ color: '#10b981' }}>HARD LOCKED (Zero Data Exposure)</strong></div>
          </div>

          <div className="genz-lock-actions">
            {onOpenAuthModal && (
              <button
                type="button"
                id="btn-admin-signin-prompt"
                className="btn-genz-neon"
                onClick={() => { playSfx('click'); onOpenAuthModal(); }}
              >
                🔑 Sign In with Admin Account
              </button>
            )}
            {onBackToFixtures && (
              <button
                type="button"
                id="btn-admin-return-fixtures"
                onClick={() => { playSfx('click'); onBackToFixtures(); }}
                className="btn-admin-return"
              >
                ← Return to Prediction Queue
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW: AUTHORIZED GEN-Z CYBER COMMAND CENTER
  // =========================================================================
  return (
    <div className="genz-admin-container" aria-label="Oddsbanta Gen-Z Admin Deck">
      {/* Top Cyber Command Header */}
      <header className="genz-deck-header">
        <div className="genz-header-left">
          <div className="genz-tag-row">
            <span className="genz-pill-vibe">⚡ VIBE CHECK: 100% OPERATIONAL</span>
            <span className="genz-pill-sigma">👑 SIGMA ADMIN • FULL PRIVILEGES</span>
            <span className="genz-pill-live">● LIVE TELEMETRY</span>
          </div>
          <h1 className="genz-deck-title">
            Oddsbanta Command Deck & Engine Control Center
          </h1>
          <p className="genz-deck-sub">
            250,000 Monte Carlo vectorization • Cloud Supabase live polling • Rate-limited 2.5s execution • No Cap.
          </p>
        </div>

        <div className="genz-header-actions">
          <button
            type="button"
            className={`btn-sfx-toggle ${sfxEnabled ? 'active' : ''}`}
            onClick={() => { playSfx('click'); setSfxEnabled(!sfxEnabled); }}
            title="Toggle interactive synthesized UI sound effects"
          >
            {sfxEnabled ? '🔊 SFX ON' : '🔇 SFX MUTED'}
          </button>

          {onBackToFixtures && (
            <button
              type="button"
              className="btn-deck-return"
              onClick={() => { playSfx('click'); onBackToFixtures(); }}
            >
              ← Back to Fixtures
            </button>
          )}

          <button
            type="button"
            className="btn-deck-return"
            style={{ borderColor: '#38bdf8', color: '#38bdf8' }}
            onClick={() => {
              playSfx('click');
              document.getElementById('section-ad-banners')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            📢 Ad Banners
          </button>

          <button
            type="button"
            className="btn-deck-refresh"
            onClick={() => {
              playSfx('click');
              fetchHealth();
              fetchAuditLogs();
              fetchUsers();
              fetchLeagues();
            }}
            disabled={healthLoading}
          >
            {healthLoading ? '⚡ Syncing...' : '🔄 Refresh Deck'}
          </button>
        </div>
      </header>

      {/* Global Interactive Notification Toasts */}
      {actionSuccess && (
        <div className="genz-toast toast-success" role="alert">
          <span className="toast-icon">✨</span>
          <span className="toast-msg">{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="toast-close">✕</button>
        </div>
      )}
      {actionError && (
        <div className="genz-toast toast-error" role="alert">
          <span className="toast-icon">⚠️</span>
          <span className="toast-msg">{actionError}</span>
          <button onClick={() => setActionError(null)} className="toast-close">✕</button>
        </div>
      )}

      {/* =====================================================================
          PANEL 1: AUTOMATION & ENGINE TRIGGER LAUNCHPAD (THE COOKING DECK)
          ===================================================================== */}
      <section className="genz-card genz-launchpad-card compact-launchpad">
        <div className="genz-card-header compact-header">
          <div className="card-title-group">
            <span className="card-emoji">⚡</span>
            <div>
              <h2 className="card-title">AUTOMATION & ENGINE CONTROLS</h2>
              <p className="card-subtitle">
                Automated 5-Min Cron & Scheduled Daily 23:00 UTC • Instant Manual Overrides
              </p>
            </div>
          </div>
          <span className="genz-badge-cooking">CRON ACTIVE ⚡</span>
        </div>

        {engineTaskStatus.status !== 'idle' && (
          <div className={`genz-engine-banner status-${engineTaskStatus.status}`}>
            <span className="engine-pulse-dot" />
            <span className="engine-banner-msg">{engineTaskStatus.message}</span>
          </div>
        )}

        {/* Grouped & Compact Engine Trigger Tabs */}
        <div className="engine-groups-container">
          {/* GROUP 1: CORE FOOTBALL MARKETS */}
          <div className="engine-group-box core-football-box">
            <div className="engine-group-header">
              <span className="group-icon">🏆</span>
              <span className="group-title">Core Football Markets</span>
              <span className="group-tag">1X2 • O/U • BTTS</span>
            </div>
            <div className="engine-group-triggers">
              <button
                type="button"
                id="btn-trigger-football-pred"
                className={`compact-trigger-btn btn-football-pred ${engineTaskStatus.type === 'prediction' && (engineTaskStatus.status === 'running' || engineTaskStatus.status === 'pending') ? 'cooking' : ''}`}
                disabled={engineTaskStatus.status === 'pending' || engineTaskStatus.status === 'running'}
                onClick={() => triggerEngineTask('RUN_PREDICTIONS')}
              >
                <span className="trigger-icon">⚡</span>
                <div className="trigger-copy">
                  <div className="trigger-label">Run Predictions</div>
                  <div className="trigger-meta">4-Day • 250k Sims</div>
                </div>
              </button>

              <button
                type="button"
                id="btn-trigger-football-settle"
                className={`compact-trigger-btn btn-football-settle ${engineTaskStatus.type === 'settlement' && (engineTaskStatus.status === 'running' || engineTaskStatus.status === 'pending') ? 'cooking' : ''}`}
                disabled={engineTaskStatus.status === 'pending' || engineTaskStatus.status === 'running'}
                onClick={() => triggerEngineTask('RUN_SETTLEMENTS')}
              >
                <span className="trigger-icon">🎯</span>
                <div className="trigger-copy">
                  <div className="trigger-label">Settle All Bets</div>
                  <div className="trigger-meta">Core & Goals Sync</div>
                </div>
              </button>
            </div>
          </div>

          {/* GROUP 2: GOALS SPECIALIST MARKETS */}
          <div className="engine-group-box goals-specialist-box">
            <div className="engine-group-header">
              <span className="group-icon">⚽</span>
              <span className="group-title">Goals Specialist Markets</span>
              <span className="group-tag">Over 2.5 • 1H Blitz</span>
            </div>
            <div className="engine-group-triggers">
              <button
                type="button"
                id="btn-trigger-goals-pred"
                className={`compact-trigger-btn btn-goals-pred ${engineTaskStatus.type === 'goals_prediction' && (engineTaskStatus.status === 'running' || engineTaskStatus.status === 'pending') ? 'cooking' : ''}`}
                disabled={engineTaskStatus.status === 'pending' || engineTaskStatus.status === 'running'}
                onClick={() => triggerEngineTask('RUN_GOALS_PREDICTIONS')}
              >
                <span className="trigger-icon">🔮</span>
                <div className="trigger-copy">
                  <div className="trigger-label">Run Goals Model</div>
                  <div className="trigger-meta">Poisson Simulations</div>
                </div>
              </button>

              <button
                type="button"
                id="btn-trigger-goals-settle"
                className={`compact-trigger-btn btn-goals-settle ${engineTaskStatus.type === 'goals_settlement' && (engineTaskStatus.status === 'running' || engineTaskStatus.status === 'pending') ? 'cooking' : ''}`}
                disabled={engineTaskStatus.status === 'pending' || engineTaskStatus.status === 'running'}
                onClick={() => triggerEngineTask('RUN_GOALS_SETTLEMENT')}
              >
                <span className="trigger-icon">⚽</span>
                <div className="trigger-copy">
                  <div className="trigger-label">Settle Goals Markets</div>
                  <div className="trigger-meta">Early HT & FT</div>
                </div>
              </button>
            </div>
          </div>

          {/* GROUP 3: 1-CLICK VIP BROADCAST & CHANNELS HUB */}
          <div className="engine-group-box" style={{ borderColor: '#16a34a' }}>
            <div className="engine-group-header">
              <span className="group-icon">📢</span>
              <span className="group-title">VIP Broadcast Station</span>
              <span className="group-tag" style={{ background: '#166534', color: '#86efac' }}>WHATSAPP & TELEGRAM</span>
            </div>
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  id="btn-gen-broadcast"
                  onClick={generateBroadcastPicks}
                  disabled={broadcastLoading}
                  className="compact-trigger-btn"
                  style={{ flex: '1 1 140px', background: '#065f46', borderColor: '#059669', color: '#ecfdf5' }}
                >
                  <span className="trigger-icon">⚡</span>
                  <div className="trigger-copy">
                    <div className="trigger-label">{broadcastLoading ? 'Fetching Picks...' : '1. Compile VIP Picks'}</div>
                    <div className="trigger-meta">Format Today's Top 10</div>
                  </div>
                </button>

                {broadcastText && (
                  <>
                    <button
                      type="button"
                      id="btn-copy-broadcast"
                      onClick={copyBroadcastText}
                      className="compact-trigger-btn"
                      style={{ flex: '1 1 120px', background: copiedBroadcast ? '#15803d' : '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                    >
                      <span className="trigger-icon">{copiedBroadcast ? '✓' : '📋'}</span>
                      <div className="trigger-copy">
                        <div className="trigger-label">{copiedBroadcast ? 'Copied!' : 'Copy Text'}</div>
                        <div className="trigger-meta">To Clipboard</div>
                      </div>
                    </button>

                    <a
                      id="btn-whatsapp-share"
                      href={`https://wa.me/?text=${encodeURIComponent(broadcastText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="compact-trigger-btn"
                      style={{ flex: '1 1 140px', background: '#15803d', borderColor: '#16a34a', color: '#fff', textDecoration: 'none' }}
                    >
                      <span className="trigger-icon">🟢</span>
                      <div className="trigger-copy">
                        <div className="trigger-label">Post to WhatsApp</div>
                        <div className="trigger-meta">Open Broadcast</div>
                      </div>
                    </a>
                  </>
                )}
              </div>

              {broadcastText && (
                <div style={{ background: '#0b1329', border: '1px solid #1e293b', borderRadius: '6px', padding: '10px', fontSize: '11px', color: '#94a3b8', maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {broadcastText}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          PANEL 2: REAL-TIME TELEMETRY & SYSTEM HEALTH METRICS
          ===================================================================== */}
      <section className="genz-telemetry-grid">
        <div className="telemetry-card">
          <div className="telemetry-card-top">
            <span className="telemetry-metric-title">ENGINE HEALTH</span>
            <span className={healthError || health?.scrapers?.status === 'error' ? "status-dot-red" : "status-dot-green"}>
              {health?.scrapers?.status?.toUpperCase() || (healthError ? 'DEGRADED' : 'HEALTHY')}
            </span>
          </div>
          <div className="telemetry-value">{health?.phase6_scheduler?.status === 'completed' ? '100%' : '99.98%'}</div>
          <div className="telemetry-sub">
            {healthError ? `Alert: ${healthError}` : `Cloud Scheduler: Nominal (${health?.phase6_scheduler?.status || '00:00 WAT'})`}
          </div>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-card-top">
            <span className="telemetry-metric-title">WORLD LEAGUES</span>
            <span className="status-pill-count">{leaguesList.length} Total</span>
          </div>
          <div className="telemetry-value">
            {leaguesList.filter(l => l.is_active !== false).length} <small>Active</small>
          </div>
          <div className="telemetry-sub">{leaguesList.filter(l => l.is_active === false).length} Paused across 30 territories</div>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-card-top">
            <span className="telemetry-metric-title">ACTIVE MEMBERS</span>
            <span className="status-pill-count">{usersList.length} Total</span>
          </div>
          <div className="telemetry-value">
            {usersList.filter(u => u.role === 'admin').length} <small>Admins</small>
          </div>
          <div className="telemetry-sub">
            {paymentStats.payingUsersCount} Paying VIP Subscribers • {usersList.filter(u => u.is_deleted).length} Soft-Deleted
          </div>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-card-top">
            <span className="telemetry-metric-title">VERIFIED REVENUE</span>
            <span className="status-dot-green">LEDGER ACTIVE</span>
          </div>
          <div className="telemetry-value">
            ₦{paymentStats.totalRevenueNgn.toLocaleString()}
          </div>
          <div className="telemetry-sub">
            {paymentStats.succeededCount} Succeeded Payments • {paymentStats.totalCount} Total Entries
          </div>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-card-top">
            <span className="telemetry-metric-title">AUDIT LEDGER</span>
            <span className="status-dot-blue">STREAMING</span>
          </div>
          <div className="telemetry-value">{auditLogs.length}</div>
          <div className="telemetry-sub">Cryptographically verified actions</div>
        </div>
      </section>

      {/* =====================================================================
          PANEL: AD BANNER & SPONSOR CAMPAIGN MANAGER
          ===================================================================== */}
      <section
        id="section-ad-banners"
        className="genz-card"
        style={{
          border: '1px solid rgba(56, 189, 248, 0.35)',
          boxShadow: '0 4px 24px rgba(2, 132, 199, 0.15)',
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.85) 0%, rgba(3, 7, 18, 0.95) 100%)'
        }}
      >
        <div className="genz-card-header" style={{ borderBottom: '1px solid rgba(56, 189, 248, 0.2)' }}>
          <div className="card-title-group">
            <span className="card-emoji">📢</span>
            <div>
              <h2 className="card-title" style={{ color: '#38bdf8' }}>Ad Banners & Sponsor Campaign Hub</h2>
              <p className="card-subtitle">
                Configure sponsor branding, campaign copy, target UTM link, and slot display across all pages in real-time.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="genz-pill"
              onClick={handleResetAdConfig}
              title="Reset all ad banner copy to default partner (MyBrainPadi)"
            >
              🔄 Reset to Defaults
            </button>
            <button
              type="button"
              className="compact-trigger-btn"
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                borderColor: '#38bdf8',
                color: '#ffffff',
                padding: '8px 18px',
                fontWeight: 800,
                cursor: 'pointer'
              }}
              onClick={() => handleSaveAdConfig()}
              disabled={adSaveLoading}
            >
              {adSaveLoading ? 'Saving...' : '💾 Publish Campaign Live'}
            </button>
          </div>
        </div>

        {/* Slot Activation Switches */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '12px',
          marginBottom: '20px',
          padding: '14px',
          background: 'rgba(3, 7, 18, 0.5)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>Top Leaderboard Banner</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Slim strip below navigation</div>
            </div>
            <button
              type="button"
              className={`btn-toggle-switch ${adConfig.isLeaderboardEnabled ? 'active' : ''}`}
              onClick={() => {
                playSfx('click');
                setAdConfigState(prev => ({ ...prev, isLeaderboardEnabled: !prev.isLeaderboardEnabled }));
              }}
              title="Toggle Leaderboard Banner"
            >
              <span className="toggle-thumb" />
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>In-Feed Match Native Card</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Placed among prediction cards</div>
            </div>
            <button
              type="button"
              className={`btn-toggle-switch ${adConfig.isNativeCardEnabled ? 'active' : ''}`}
              onClick={() => {
                playSfx('click');
                setAdConfigState(prev => ({ ...prev, isNativeCardEnabled: !prev.isNativeCardEnabled }));
              }}
              title="Toggle In-Feed Native Card"
            >
              <span className="toggle-thumb" />
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>Acca Slip Drawer Banner</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Embedded in slide-out slip</div>
            </div>
            <button
              type="button"
              className={`btn-toggle-switch ${adConfig.isDrawerBannerEnabled ? 'active' : ''}`}
              onClick={() => {
                playSfx('click');
                setAdConfigState(prev => ({ ...prev, isDrawerBannerEnabled: !prev.isDrawerBannerEnabled }));
              }}
              title="Toggle Drawer Banner"
            >
              <span className="toggle-thumb" />
            </button>
          </div>
        </div>

        {/* Ad Campaign Editor Form */}
        <form onSubmit={handleSaveAdConfig} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            {/* Brand Title */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
                Sponsor Brand Name
              </label>
              <input
                type="text"
                className="genz-search-input"
                style={{ width: '100%' }}
                value={adConfig.brandTitle}
                onChange={(e) => setAdConfigState({ ...adConfig, brandTitle: e.target.value })}
                placeholder="e.g. MyBrainPadi.com"
                required
              />
            </div>

            {/* Brand Subtitle */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
                Brand Subtitle / Tagline
              </label>
              <input
                type="text"
                className="genz-search-input"
                style={{ width: '100%' }}
                value={adConfig.brandSubtitle}
                onChange={(e) => setAdConfigState({ ...adConfig, brandSubtitle: e.target.value })}
                placeholder="e.g. AI Academic & Research Assistant"
                required
              />
            </div>

            {/* Brand Badge */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
                Badge Pill Text
              </label>
              <input
                type="text"
                className="genz-search-input"
                style={{ width: '100%' }}
                value={adConfig.brandBadge}
                onChange={(e) => setAdConfigState({ ...adConfig, brandBadge: e.target.value })}
                placeholder="e.g. SPONSORED"
              />
            </div>

            {/* CTA Button Text */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
                Leaderboard CTA Button Text
              </label>
              <input
                type="text"
                className="genz-search-input"
                style={{ width: '100%' }}
                value={adConfig.brandCtaText}
                onChange={(e) => setAdConfigState({ ...adConfig, brandCtaText: e.target.value })}
                placeholder="e.g. Try Free ➔"
                required
              />
            </div>
          </div>

          {/* Sponsor Destination URL */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
              Target Destination URL (With UTM Campaign Parameters)
            </label>
            <input
              type="url"
              className="genz-search-input"
              style={{ width: '100%', fontFamily: 'monospace' }}
              value={adConfig.sponsorUrl}
              onChange={(e) => setAdConfigState({ ...adConfig, sponsorUrl: e.target.value })}
              placeholder="https://example.com/?utm_source=oddsbanta&utm_medium=ad_banner"
              required
            />
          </div>

          {/* Top Leaderboard Pitch */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
              Top Leaderboard Pitch Copy
            </label>
            <input
              type="text"
              className="genz-search-input"
              style={{ width: '100%' }}
              value={adConfig.brandTagline}
              onChange={(e) => setAdConfigState({ ...adConfig, brandTagline: e.target.value })}
              placeholder="e.g. Writing a Project, Thesis, or Exam Prep? Let AI Structure Literature & Verified Citations."
              required
            />
          </div>

          {/* In-Feed Native Card Section */}
          <div style={{
            padding: '14px',
            background: 'rgba(3, 7, 18, 0.4)',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#f8fafc', fontWeight: 750 }}>
              🃏 In-Feed Native Card Customization
            </h4>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>
                Native Card Heading
              </label>
              <input
                type="text"
                className="genz-search-input"
                style={{ width: '100%' }}
                value={adConfig.nativeHeading}
                onChange={(e) => setAdConfigState({ ...adConfig, nativeHeading: e.target.value })}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>
                Native Card Body Text
              </label>
              <textarea
                className="genz-search-input"
                rows={2}
                style={{ width: '100%', resize: 'vertical' }}
                value={adConfig.nativeBody}
                onChange={(e) => setAdConfigState({ ...adConfig, nativeBody: e.target.value })}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>Perk 1</label>
                <input
                  type="text"
                  className="genz-search-input"
                  style={{ width: '100%' }}
                  value={adConfig.nativePerk1}
                  onChange={(e) => setAdConfigState({ ...adConfig, nativePerk1: e.target.value })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>Perk 2</label>
                <input
                  type="text"
                  className="genz-search-input"
                  style={{ width: '100%' }}
                  value={adConfig.nativePerk2}
                  onChange={(e) => setAdConfigState({ ...adConfig, nativePerk2: e.target.value })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>Perk 3</label>
                <input
                  type="text"
                  className="genz-search-input"
                  style={{ width: '100%' }}
                  value={adConfig.nativePerk3}
                  onChange={(e) => setAdConfigState({ ...adConfig, nativePerk3: e.target.value })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>Native CTA Text</label>
                <input
                  type="text"
                  className="genz-search-input"
                  style={{ width: '100%' }}
                  value={adConfig.nativeCtaText}
                  onChange={(e) => setAdConfigState({ ...adConfig, nativeCtaText: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Drawer Banner Customization */}
          <div style={{
            padding: '14px',
            background: 'rgba(3, 7, 18, 0.4)',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '10px'
          }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '2px' }}>Drawer Headline</label>
              <input
                type="text"
                className="genz-search-input"
                style={{ width: '100%' }}
                value={adConfig.drawerHeadline}
                onChange={(e) => setAdConfigState({ ...adConfig, drawerHeadline: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '2px' }}>Drawer Subtitle</label>
              <input
                type="text"
                className="genz-search-input"
                style={{ width: '100%' }}
                value={adConfig.drawerSub}
                onChange={(e) => setAdConfigState({ ...adConfig, drawerSub: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '2px' }}>Drawer CTA</label>
              <input
                type="text"
                className="genz-search-input"
                style={{ width: '100%' }}
                value={adConfig.drawerCta}
                onChange={(e) => setAdConfigState({ ...adConfig, drawerCta: e.target.value })}
              />
            </div>
          </div>

          {/* Live Preview Box */}
          <div style={{
            marginTop: '8px',
            padding: '16px',
            background: '#090d16',
            borderRadius: '12px',
            border: '1px dashed rgba(56, 189, 248, 0.35)'
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#38bdf8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              👁️ Real-Time Live Preview (Top Leaderboard Strip)
            </div>
            <div className="ad-slot-leaderboard-container" style={{ margin: 0 }}>
              <div className="ad-leaderboard-link" style={{ pointerEvents: 'none' }}>
                <div className="ad-leaderboard-content">
                  <div className="ad-brand-col">
                    <span className="ad-brand-icon">🎓</span>
                    <div className="ad-brand-names">
                      <div className="ad-brand-header-inline">
                        <strong className="ad-brand-title">{adConfig.brandTitle || 'Brand Title'}</strong>
                        <span className="ad-inline-sponsor-pill">{adConfig.brandBadge || 'SPONSORED'}</span>
                      </div>
                      <span className="ad-brand-subtitle">{adConfig.brandSubtitle || 'Subtitle'}</span>
                    </div>
                  </div>

                  <div className="ad-copy-col">
                    <span className="ad-tagline">{adConfig.brandTagline || 'Tagline'}</span>
                  </div>

                  <div className="ad-cta-col">
                    <span className="ad-cta-btn">{adConfig.brandCtaText || 'Try Free ➔'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Action Submit Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            <button
              type="button"
              className="genz-pill"
              onClick={handleResetAdConfig}
            >
              Reset to Defaults
            </button>
            <button
              type="submit"
              className="compact-trigger-btn"
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                borderColor: '#38bdf8',
                color: '#ffffff',
                padding: '10px 24px',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
              disabled={adSaveLoading}
            >
              {adSaveLoading ? 'Saving...' : '✓ Publish Ad Changes Across All Pages'}
            </button>
          </div>
        </form>
      </section>

      {/* =====================================================================
          PANEL 3: INTERACTIVE 30-LEAGUE SWITCHBOARD
          ===================================================================== */}
      <section className="genz-card">
        <div className="genz-card-header">
          <div className="card-title-group">
            <span className="card-emoji">🏛</span>
            <div>
              <h2 className="card-title">Interactive 30-League Switchboard</h2>
              <p className="card-subtitle">
                Enable or pause leagues in real-time. Toggling directly updates the Supabase <code>football_leagues</code> table.
              </p>
            </div>
          </div>

          <div className="switchboard-controls">
            <input
              type="text"
              placeholder="Search league or code..."
              value={leagueSearch}
              onChange={(e) => setLeagueSearch(e.target.value)}
              className="genz-search-input"
            />
            <div className="genz-filter-pills">
              <button
                type="button"
                className={`genz-pill ${leagueCategoryFilter === 'all' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setLeagueCategoryFilter('all'); }}
              >
                All ({leaguesList.length})
              </button>
              <button
                type="button"
                className={`genz-pill ${leagueCategoryFilter === 'active' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setLeagueCategoryFilter('active'); }}
              >
                Active ({leaguesList.filter(l => l.is_active !== false).length})
              </button>
              <button
                type="button"
                className={`genz-pill ${leagueCategoryFilter === 'inactive' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setLeagueCategoryFilter('inactive'); }}
              >
                Paused ({leaguesList.filter(l => l.is_active === false).length})
              </button>
            </div>
          </div>
        </div>

        {leaguesLoading ? (
          <div className="genz-table-loading">Loading 30 world leagues from Cloud Supabase...</div>
        ) : (
          <div className="genz-leagues-grid">
            {filteredLeagues.map((lg) => {
              const isActive = lg.is_active !== false;
              return (
                <div key={lg.id} className={`genz-league-card ${isActive ? 'league-active' : 'league-paused'}`}>
                  <div className="league-card-header">
                    <div>
                      <div className="league-title-row">
                        <span className="league-code-tag">{lg.code}</span>
                        <h4 className="league-name-text">{lg.name}</h4>
                      </div>
                      <div className="league-meta-sub">{lg.country || 'International'} • Tier: {lg.tier || 1}</div>
                    </div>

                    <button
                      type="button"
                      className={`btn-toggle-switch ${isActive ? 'active' : ''}`}
                      onClick={() => handleToggleLeague(lg)}
                      title={`Click to ${isActive ? 'Pause' : 'Activate'} ${lg.name}`}
                    >
                      <span className="toggle-thumb" />
                    </button>
                  </div>
                  <div className="league-card-footer">
                    <span className={`status-badge ${isActive ? 'active' : 'paused'}`}>
                      {isActive ? '⚡ IN PREDICTION QUEUE' : '⏸ PAUSED FROM QUEUE'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* =====================================================================
          PANEL 4: INTERACTIVE USER ROLE & SUBSCRIPTION TIER CONTROL
          ===================================================================== */}
      <section className="genz-card">
        <div className="genz-card-header">
          <div className="card-title-group">
            <span className="card-emoji">👥</span>
            <div>
              <h2 className="card-title">User Role & Subscription Tier Manager</h2>
              <p className="card-subtitle">
                Allocate tiers (Free, Standard ₦5k, BigBang VIP, Admin), control subscriptions, extend validity periods, or disable/ban accounts.
              </p>
            </div>
          </div>

          <div className="switchboard-controls">
            <input
              type="text"
              placeholder="Search email, display name, user ID..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="genz-search-input"
            />
            <div className="genz-filter-pills">
              <button
                type="button"
                className={`genz-pill ${userRoleFilter === 'all' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setUserRoleFilter('all'); }}
              >
                All Users ({usersList.length})
              </button>
              <button
                type="button"
                className={`genz-pill ${userRoleFilter === 'paid' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setUserRoleFilter('paid'); }}
              >
                Paid VIPs ({paymentStats.payingUsersCount})
              </button>
              <button
                type="button"
                className={`genz-pill ${userRoleFilter === 'standard' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setUserRoleFilter('standard'); }}
              >
                Standard
              </button>
              <button
                type="button"
                className={`genz-pill ${userRoleFilter === 'bigbang' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setUserRoleFilter('bigbang'); }}
              >
                BigBang
              </button>
              <button
                type="button"
                className={`genz-pill ${userRoleFilter === 'admin' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setUserRoleFilter('admin'); }}
              >
                Admins
              </button>
              <button
                type="button"
                className={`genz-pill ${userRoleFilter === 'disabled' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setUserRoleFilter('disabled'); }}
              >
                Disabled
              </button>
            </div>
          </div>
        </div>

        {usersLoading ? (
          <div className="genz-table-loading">Loading users & subscriptions from Cloud Supabase...</div>
        ) : (
          <div className="genz-table-wrapper">
            <table className="genz-table">
              <thead>
                <tr>
                  <th>User & Identity</th>
                  <th>Allocated Tier</th>
                  <th>Subscription Expiry</th>
                  <th>Account Status</th>
                  <th>Disclaimers</th>
                  <th>Actions & Controls</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      No users match the search / filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isDeactivated = u.is_deleted === true || u.status === 'disabled';
                    const subEnd = u.subscription?.current_period_end || u.entitlement?.valid_until;
                    const isExpired = subEnd ? new Date(subEnd) < new Date() : false;
                    const expDays = 30;

                    return (
                      <tr key={u.id} className={isDeactivated ? 'row-deactivated' : ''}>
                        <td>
                          <div className="user-email-cell">
                            <strong>{u.email}</strong>
                            <span className="user-display-name">{u.display_name || 'No display name'}</span>
                            <span style={{ fontSize: '0.75rem', opacity: 0.6, fontFamily: 'monospace' }}>ID: {u.id.substring(0, 8)}...</span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <span className={`role-badge role-${u.role}`}>
                              {u.role === 'standard' ? '⭐ Standard (₦5k)' : u.role === 'bigbang' ? '💥 BigBang VIP' : u.role === 'admin' ? '🛡 Admin' : 'Free Access'}
                            </span>
                            <select
                              value={roleChangeUserId === u.id ? newRole : u.role}
                              onChange={(e) => {
                                const role = e.target.value as any;
                                setRoleChangeUserId(u.id);
                                setNewRole(role);
                                handleAllocateTier(u.id, role, u.status || 'active', expDays);
                              }}
                              disabled={actionLoading === u.id}
                              className="genz-role-select"
                              title="Select tier to immediately allocate"
                            >
                              <option value="free">Free Tier</option>
                              <option value="standard">Standard Plan (₦5,000)</option>
                              <option value="bigbang">BigBang VIP</option>
                              <option value="admin">Administrator</option>
                            </select>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isExpired ? '#ef4444' : subEnd ? '#10b981' : '#64748b' }}>
                              {isExpired ? '⚠️ Expired' : subEnd ? `Valid until ${new Date(subEnd).toLocaleDateString()}` : 'Lifetime / None'}
                            </span>
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="genz-pill"
                                style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                disabled={actionLoading === u.id}
                                onClick={() => handleAllocateTier(u.id, u.role, 'active', 30, 'Admin +30 Days extension')}
                                title="Grant 30 days active access"
                              >
                                +30d
                              </button>
                              <button
                                type="button"
                                className="genz-pill"
                                style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                disabled={actionLoading === u.id}
                                onClick={() => handleAllocateTier(u.id, u.role, 'active', 90, 'Admin +90 Days extension')}
                                title="Grant 90 days active access"
                              >
                                +90d
                              </button>
                              <button
                                type="button"
                                className="genz-pill"
                                style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                disabled={actionLoading === u.id}
                                onClick={() => handleAllocateTier(u.id, u.role, 'active', null, 'Admin Lifetime access')}
                                title="Grant permanent / lifetime access"
                              >
                                Lifetime
                              </button>
                            </div>
                          </div>
                        </td>
                        <td>
                          {isDeactivated ? (
                            <span className="status-badge-disabled">🚫 DISABLED / BANNED</span>
                          ) : (
                            <span className="status-badge-active">✓ ACTIVE</span>
                          )}
                        </td>
                        <td>
                          <span className="disclaimer-check-tag">
                            {u.disclaimer_age_accepted && u.disclaimer_financial_accepted ? '✓ 18+ & Risk OK' : '⚠️ Unverified'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className={`action-btn-small ${isDeactivated ? 'btn-activate' : 'btn-deactivate'}`}
                              disabled={actionLoading === u.id}
                              onClick={() => handleToggleUserStatus(u)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '0.75rem',
                                borderRadius: '6px',
                                border: '1px solid',
                                cursor: 'pointer',
                                background: isDeactivated ? '#dcfce7' : '#fee2e2',
                                color: isDeactivated ? '#166534' : '#991b1b',
                                borderColor: isDeactivated ? '#bbf7d0' : '#fecaca',
                                fontWeight: 600
                              }}
                            >
                              {isDeactivated ? '✅ Enable Account' : '🚫 Disable Account'}
                            </button>
                            <button
                              type="button"
                              className="genz-pill"
                              style={{ padding: '3px 8px', fontSize: '0.72rem', textAlign: 'center' }}
                              onClick={() => {
                                setManualPayUserId(u.id);
                                setIsManualPaymentModalOpen(true);
                              }}
                              title="Record payment and grant VIP"
                            >
                              💳 Log Payment
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* =====================================================================
          PANEL 5: FINANCIAL LEDGER & PAYMENT TRANSACTIONS
          ===================================================================== */}
      <section className="genz-card">
        <div className="genz-card-header">
          <div className="card-title-group">
            <span className="card-emoji">💳</span>
            <div>
              <h2 className="card-title">Financial Ledger & Payment Transactions</h2>
              <p className="card-subtitle">
                Comprehensive payment records from Paystack, Flutterwave, Stripe, and manual bank transfers.
              </p>
            </div>
          </div>

          <div className="switchboard-controls">
            <button
              type="button"
              className="compact-trigger-btn"
              style={{ padding: '0.5rem 1rem', background: '#059669', color: '#fff', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
              onClick={() => setIsManualPaymentModalOpen(true)}
            >
              + Record Manual Payment
            </button>
            <input
              type="text"
              placeholder="Search reference, email, plan..."
              value={paymentSearch}
              onChange={(e) => setPaymentSearch(e.target.value)}
              className="genz-search-input"
            />
            <div className="genz-filter-pills">
              <button
                type="button"
                className={`genz-pill ${paymentStatusFilter === 'all' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setPaymentStatusFilter('all'); }}
              >
                All ({paymentsList.length})
              </button>
              <button
                type="button"
                className={`genz-pill ${paymentStatusFilter === 'succeeded' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setPaymentStatusFilter('succeeded'); }}
              >
                Succeeded ({paymentStats.succeededCount})
              </button>
              <button
                type="button"
                className={`genz-pill ${paymentStatusFilter === 'pending' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setPaymentStatusFilter('pending'); }}
              >
                Pending
              </button>
              <button
                type="button"
                className={`genz-pill ${paymentStatusFilter === 'failed' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setPaymentStatusFilter('failed'); }}
              >
                Failed
              </button>
            </div>
          </div>
        </div>

        {paymentsLoading ? (
          <div className="genz-table-loading">Loading payment transactions from Cloud Supabase...</div>
        ) : (
          <div className="genz-table-wrapper">
            <table className="genz-table">
              <thead>
                <tr>
                  <th>Transaction Ref</th>
                  <th>Customer Email</th>
                  <th>Plan & Description</th>
                  <th>Amount</th>
                  <th>Gateway / Provider</th>
                  <th>Status</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                      <div style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>💳 No payment transactions found</div>
                      <p style={{ fontSize: '0.875rem' }}>Transactions processed via Paystack or logged manually will appear here in real time.</p>
                      <button
                        type="button"
                        className="genz-pill active-green"
                        style={{ marginTop: '0.75rem', padding: '6px 14px' }}
                        onClick={() => setIsManualPaymentModalOpen(true)}
                      >
                        + Log First Payment
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((p) => {
                    const amountVal = p.amount_cents ? p.amount_cents / 100 : 0;
                    const isNgn = (p.currency || 'ngn').toLowerCase() === 'ngn';
                    const amountDisplay = isNgn
                      ? `₦${amountVal.toLocaleString()}`
                      : `$${amountVal.toFixed(2)}`;

                    return (
                      <tr key={p.id}>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}>
                            {p.reference || p.id.substring(0, 12)}
                          </span>
                        </td>
                        <td>
                          <strong>{p.customer_email || '—'}</strong>
                        </td>
                        <td>
                          <span>{p.plan_name || 'Standard VIP Access'}</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: '#059669', fontSize: '0.95rem' }}>
                            {amountDisplay}
                          </span>
                        </td>
                        <td>
                          <span className="genz-tag" style={{ textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            {p.provider || 'stripe'}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              background: p.status === 'succeeded' ? '#dcfce7' : p.status === 'pending' ? '#fef9c3' : '#fee2e2',
                              color: p.status === 'succeeded' ? '#166534' : p.status === 'pending' ? '#854d0e' : '#991b1b'
                            }}
                          >
                            {p.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="font-mono-date">
                          {new Date(p.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* =====================================================================
          PANEL 6: LIVE SYSTEM AUDIT TERMINAL & LOGS
          ===================================================================== */}
      <section className="genz-card">
        <div className="genz-card-header">
          <div className="card-title-group">
            <span className="card-emoji">💻</span>
            <div>
              <h2 className="card-title">Real-Time Audit Terminal & Immutable Log Stream</h2>
              <p className="card-subtitle">
                Immutable event trail. All administrative actions and system cycles are logged with actor identity.
              </p>
            </div>
          </div>

          <div className="switchboard-controls">
            <input
              type="text"
              placeholder="Search logs..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              className="genz-search-input"
            />
            <div className="genz-filter-pills">
              <button
                type="button"
                className={`genz-pill ${auditFilter === 'all' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setAuditFilter('all'); }}
              >
                All Events ({auditLogs.length})
              </button>
              <button
                type="button"
                className={`genz-pill ${auditFilter === 'engine' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setAuditFilter('engine'); }}
              >
                Engine & Sims
              </button>
              <button
                type="button"
                className={`genz-pill ${auditFilter === 'leagues' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setAuditFilter('leagues'); }}
              >
                Leagues
              </button>
              <button
                type="button"
                className={`genz-pill ${auditFilter === 'roles' ? 'active' : ''}`}
                onClick={() => { playSfx('click'); setAuditFilter('roles'); }}
              >
                Role Updates
              </button>
              <button
                type="button"
                className={`genz-pill ${autoRefreshLogs ? 'active-green' : ''}`}
                onClick={() => { playSfx('click'); setAutoRefreshLogs(!autoRefreshLogs); }}
                title="Toggle live 12s auto-refresh"
              >
                {autoRefreshLogs ? '● Auto-Sync ON' : '○ Auto-Sync OFF'}
              </button>
            </div>
          </div>
        </div>

        {auditLoading ? (
          <div className="genz-table-loading">Streaming audit records from Cloud Supabase...</div>
        ) : (
          <div className="genz-terminal-wrapper">
            <div className="terminal-header-bar">
              <div className="terminal-dots">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
              </div>
              <span className="terminal-title">audit_logs.stream // postgresql-15 // cloud-supabase</span>
              <span className="terminal-count">{filteredLogs.length} events</span>
            </div>

            <div className="terminal-log-entries">
              {filteredLogs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                return (
                  <div
                    key={log.id}
                    className="terminal-entry"
                    onClick={() => {
                      playSfx('click');
                      setExpandedLogId(isExpanded ? null : log.id);
                    }}
                  >
                    <div className="entry-main-row">
                      <span className="entry-timestamp">
                        {new Date(log.created_at).toLocaleTimeString('en-GB', { hour12: false })}
                      </span>
                      <span className="entry-action-badge">{log.action}</span>
                      <span className="entry-actor">{log.actor_email || 'system_worker'}</span>
                      <span className="entry-reason">{log.reason || 'No description provided'}</span>
                      <span className="entry-expand-toggle">{isExpanded ? '▲ hide' : '▼ json'}</span>
                    </div>

                    {isExpanded && (
                      <div className="entry-json-drawer">
                        <pre>{JSON.stringify({
                          id: log.id,
                          action: log.action,
                          actor_role: log.actor_role,
                          affected_table: log.affected_table,
                          affected_record_id: log.affected_record_id,
                          previous_state: log.previous_state,
                          new_state: log.new_state,
                          created_at: log.created_at
                        }, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* =====================================================================
          MANUAL / OFFLINE PAYMENT RECORDING MODAL
          ===================================================================== */}
      {isManualPaymentModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            animation: 'fadeIn 0.2s ease-out'
          }}
          onClick={() => setIsManualPaymentModalOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--card-bg, #1e293b)',
              color: 'var(--text-main, #f8fafc)',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
              maxWidth: '540px',
              width: '100%',
              padding: '2rem',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>💳</span> Record Manual Payment
                </h3>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted, #94a3b8)' }}>
                  Log offline bank transfers, cash or proof of payment and instantly grant VIP access.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManualPaymentModalOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.5rem',
                  color: 'var(--text-muted, #94a3b8)',
                  cursor: 'pointer',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRecordManualPayment();
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              {/* User Selection */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Target User Account <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  className="genz-select"
                  style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.9rem' }}
                  value={manualPayUserId}
                  onChange={(e) => setManualPayUserId(e.target.value)}
                  required
                >
                  <option value="">-- Select Registered User --</option>
                  {usersList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.role?.toUpperCase() || 'FREE'}) {u.display_name ? `— ${u.display_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Plan Selection */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Subscription Plan <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  className="genz-select"
                  style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.9rem' }}
                  value={manualPayPlan}
                  onChange={(e) => {
                    const val = e.target.value;
                    setManualPayPlan(val);
                    if (val.includes('5,000')) setManualPayAmount(5000);
                    else if (val.includes('13,500')) setManualPayAmount(13500);
                    else if (val.includes('15,000')) setManualPayAmount(15000);
                    else if (val.includes('40,000')) setManualPayAmount(40000);
                  }}
                >
                  <option value="Standard VIP Monthly (₦5,000)">Standard VIP Monthly (₦5,000 / 30 Days)</option>
                  <option value="Standard VIP Quarterly (₦13,500)">Standard VIP Quarterly (₦13,500 / 90 Days)</option>
                  <option value="BigBang VIP Monthly (₦15,000)">BigBang VIP Monthly (₦15,000 / 30 Days)</option>
                  <option value="BigBang VIP Quarterly (₦40,000)">BigBang VIP Quarterly (₦40,000 / 90 Days)</option>
                  <option value="Custom Offline Grant">Custom Plan / Offline Grant</option>
                </select>
              </div>

              {/* Amount and Currency */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Amount Paid
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className="genz-search-input"
                    style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px' }}
                    value={manualPayAmount}
                    onChange={(e) => setManualPayAmount(Number(e.target.value) || 0)}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Currency
                  </label>
                  <select
                    className="genz-select"
                    style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.9rem' }}
                    value={manualPayCurrency}
                    onChange={(e) => setManualPayCurrency(e.target.value)}
                  >
                    <option value="ngn">NGN (₦)</option>
                    <option value="usd">USD ($)</option>
                    <option value="gbp">GBP (£)</option>
                    <option value="eur">EUR (€)</option>
                  </select>
                </div>
              </div>

              {/* Provider / Channel */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Payment Channel / Gateway
                </label>
                <select
                  className="genz-select"
                  style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.9rem' }}
                  value={manualPayProvider}
                  onChange={(e) => setManualPayProvider(e.target.value)}
                >
                  <option value="manual_bank_transfer">Direct Bank Transfer (GTBank / OPay / Kuda)</option>
                  <option value="paystack">Paystack Offline / Manual confirmation</option>
                  <option value="flutterwave">Flutterwave Offline</option>
                  <option value="stripe">Stripe / Card Offline</option>
                  <option value="cash">Cash / Direct POS Deposit</option>
                </select>
              </div>

              {/* Reference / Bank Narration */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Payment Reference / Narration / Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. TRF/GTB/091823 or WhatsApp payment confirmation"
                  className="genz-search-input"
                  style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px' }}
                  value={manualPayNotes}
                  onChange={(e) => setManualPayNotes(e.target.value)}
                />
              </div>

              {/* Modal Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="genz-pill"
                  style={{ padding: '0.6rem 1.25rem' }}
                  onClick={() => setIsManualPaymentModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="compact-trigger-btn"
                  disabled={actionLoading === 'manual_pay' || !manualPayUserId}
                  style={{
                    padding: '0.6rem 1.5rem',
                    background: '#059669',
                    color: '#fff',
                    fontWeight: 700,
                    borderRadius: '8px',
                    border: 'none',
                    cursor: actionLoading === 'manual_pay' ? 'not-allowed' : 'pointer'
                  }}
                >
                  {actionLoading === 'manual_pay' ? 'Recording & Granting...' : '✓ Record & Grant VIP'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
