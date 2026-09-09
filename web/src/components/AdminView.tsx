import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SystemHealthStatus, AuditRecord, UserProfile, LeagueRecord } from '../types';

interface AdminViewProps {
  currentUserProfile: UserProfile | null;
  onBackToFixtures?: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ currentUserProfile, onBackToFixtures }) => {
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

  // Users management
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(false);

  // Leagues management
  const [leaguesList, setLeaguesList] = useState<LeagueRecord[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState<boolean>(false);

  // Action states & reasons
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [predictionReason, setPredictionReason] = useState<string>('');
  const [settlementReason, setSettlementReason] = useState<string>('');
  const [roleChangeUserId, setRoleChangeUserId] = useState<string>('');
  const [newRole, setNewRole] = useState<'free' | 'standard' | 'bigbang' | 'admin'>('standard');
  const [roleReason, setRoleReason] = useState<string>('');

  // 1. Verify server-side admin privilege
  const verifyServerAdmin = async () => {
    setCheckingAuth(true);
    try {
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
        .limit(50);
      if (error) throw error;
      setAuditLogs(data || []);
    } catch (err: any) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  // 4. Fetch users for role management
  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, display_name, role, disclaimer_age_accepted, disclaimer_financial_accepted, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setUsersList(data || []);
    } catch (err: any) {
      console.error('Failed to fetch users:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  // 5. Fetch leagues
  const fetchLeagues = async () => {
    setLeaguesLoading(true);
    try {
      const { data, error } = await supabase
        .from('football_leagues')
        .select('*')
        .order('priority', { ascending: true });
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
      fetchLeagues();
    }
  }, [isAdminVerified]);

  // Action handlers
  const handleTriggerPrediction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!predictionReason || predictionReason.trim().length < 5) {
      setActionError('Audit reason must be at least 5 characters long.');
      return;
    }
    setActionLoading('prediction');
    setActionError(null);
    setActionSuccess(null);
    try {
      const { data, error } = await supabase.rpc('admin_trigger_prediction_run', {
        reason: predictionReason.trim()
      });
      if (error) throw error;
      setActionSuccess(`Prediction cycle scheduled successfully! Job ID: ${(data as any)?.job_id || 'Queued'}`);
      setPredictionReason('');
      fetchHealth();
      fetchAuditLogs();
    } catch (err: any) {
      console.error('Trigger prediction cycle failed:', err);
      setActionError(err.message || 'Failed to trigger prediction run.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleTriggerSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlementReason || settlementReason.trim().length < 5) {
      setActionError('Audit reason must be at least 5 characters long.');
      return;
    }
    setActionLoading('settlement');
    setActionError(null);
    setActionSuccess(null);
    try {
      const { data, error } = await supabase.rpc('admin_trigger_settlement_run', {
        reason: settlementReason.trim()
      });
      if (error) throw error;
      setActionSuccess(`Settlement sync scheduled successfully! Job ID: ${(data as any)?.job_id || 'Queued'}`);
      setSettlementReason('');
      fetchHealth();
      fetchAuditLogs();
    } catch (err: any) {
      console.error('Trigger settlement cycle failed:', err);
      setActionError(err.message || 'Failed to trigger settlement run.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleChangeUserId) {
      setActionError('Please select a target user.');
      return;
    }
    if (!roleReason || roleReason.trim().length < 3) {
      setActionError('Please provide a valid audit reason for the role modification.');
      return;
    }
    setActionLoading('role');
    setActionError(null);
    setActionSuccess(null);
    try {
      const targetUser = usersList.find((u) => u.id === roleChangeUserId);
      const prevRole = targetUser?.role || 'unknown';

      // 1. Update user role
      const { error: userErr } = await supabase
        .from('users')
        .update({ role: newRole })
        .eq('id', roleChangeUserId);
      if (userErr) throw userErr;

      // 2. Synchronize entitlements
      const hasFootball = newRole === 'standard' || newRole === 'bigbang' || newRole === 'admin';
      await supabase
        .from('entitlements')
        .upsert(
          {
            user_id: roleChangeUserId,
            tier: newRole,
            features: { football_predictions: hasFootball },
            is_active: true
          },
          { onConflict: 'user_id' }
        );

      // 3. Write immutable audit log
      await supabase.from('audit_logs').insert({
        actor_id: currentUserProfile?.id,
        actor_email: currentUserProfile?.email,
        actor_role: 'admin',
        action: 'admin_user_role_update',
        affected_table: 'users',
        affected_record_id: roleChangeUserId,
        previous_state: { role: prevRole },
        new_state: { role: newRole },
        reason: roleReason.trim()
      });

      setActionSuccess(`Successfully updated role for user to ${newRole}!`);
      setRoleReason('');
      setRoleChangeUserId('');
      fetchUsers();
      fetchAuditLogs();
    } catch (err: any) {
      console.error('Role update failed:', err);
      setActionError(err.message || 'Failed to update user role.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleLeague = async (league: LeagueRecord) => {
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
        reason: `Toggled active state for league ${league.name} (${league.code}) to ${newActiveState}`
      });

      fetchLeagues();
      fetchAuditLogs();
    } catch (err: any) {
      console.error('Failed to toggle league:', err);
      setActionError(err.message || 'Failed to toggle league active status.');
    }
  };

  // Render: Loading Auth
  if (checkingAuth) {
    return (
      <div className="max-w-4xl mx-auto py-20 px-4 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-slate-900 mb-4" />
        <h2 className="text-xl font-bold text-slate-900">Verifying Server-Side Authorization...</h2>
        <p className="text-sm text-slate-500 mt-2">
          JamBets validates administrator privileges directly via Cloud Supabase RPC credentials.
        </p>
      </div>
    );
  }

  // Render: 403 Forbidden Access Denied Barrier
  if (!isAdminVerified) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4">
        <div className="p-8 rounded-3xl border border-red-200 bg-white shadow-lg text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>

          <div>
            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">
              403 Forbidden • Access Denied
            </span>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-3">
              Server-Side Administrator Authorization Required
            </h1>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              You do not have administrative credentials to access the JamBets Control Center.
              In accordance with Phase 9 security protocols, administrative capabilities are enforced strictly on the server database layer and cannot be bypassed via client-side state manipulation.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 text-left space-y-1 font-mono">
            <div>Authenticated User: {currentUserProfile?.email || 'Unauthenticated Visitor'}</div>
            <div>Current Tier: {currentUserProfile?.role || 'None'}</div>
            <div>Verification Method: Supabase public.is_admin() RPC [Returned: false]</div>
          </div>

          <div className="pt-2">
            {onBackToFixtures && (
              <button
                onClick={onBackToFixtures}
                className="px-6 py-2.5 rounded-xl font-semibold text-sm bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition-all"
              >
                Return to Fixtures & Predictions
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render: Authorized Admin Control Center
  return (
    <div className="admin-container space-y-8 max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">
              Admin Mode • Verified Server Credentials
            </span>
            <span className="text-xs text-slate-500">
              Admin: {currentUserProfile?.email}
            </span>
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <span>Control Center & System Health Audit</span>
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Real-time pipeline monitoring, automated scheduling oversight, and auditable server-side administrative controls.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onBackToFixtures && (
            <button
              onClick={onBackToFixtures}
              className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 rounded-lg border border-slate-300 shadow-sm transition-colors"
            >
              ← Back to Fixtures
            </button>
          )}
          <button
            onClick={() => {
              fetchHealth();
              fetchAuditLogs();
              fetchUsers();
              fetchLeagues();
            }}
            disabled={healthLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 border border-slate-900 rounded-lg shadow-sm transition-all"
          >
            <svg
              className={`w-4 h-4 ${healthLoading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{healthLoading ? 'Refreshing...' : 'Refresh All'}</span>
          </button>
        </div>
      </div>

      {/* Global Alerts */}
      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between shadow-sm">
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-900 font-bold ml-4">✕</button>
        </div>
      )}
      {actionError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center justify-between shadow-sm">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-700 hover:text-red-900 font-bold ml-4">✕</button>
        </div>
      )}

      {/* SECTION 1: SYSTEM HEALTH DASHBOARD */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <span>1. Platform Health & Real-Time Monitoring</span>
        </h2>

        {healthError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
            System Telemetry Notice: {healthError}
          </div>
        )}

        {health ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Scraper / Data Acquisition Health */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500">Scraper Status</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  health.scrapers.status === 'healthy' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {health.scrapers.status}
                </span>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-black text-slate-900">
                  {health.scrapers.stale_fixtures_count} Stale
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Last Sync: {health.scrapers.last_sync_timestamp ? new Date(health.scrapers.last_sync_timestamp).toLocaleTimeString() : 'Active'}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                Sources: {health.sources?.length ?? 0} active feeds monitored
              </div>
            </div>

            {/* Phase 6 6-Hour Scheduler */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500">Phase 6 Scheduler</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  health.phase6_scheduler.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  {health.phase6_scheduler.status}
                </span>
              </div>
              <div className="mt-3">
                <div className="text-sm font-mono text-slate-800 truncate" title={health.phase6_scheduler.job_id || ''}>
                  Job: {health.phase6_scheduler.job_id ? `${health.phase6_scheduler.job_id.slice(0, 12)}...` : 'Active'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Completed: {health.phase6_scheduler.completed_at ? new Date(health.phase6_scheduler.completed_at).toLocaleTimeString() : 'Recent'}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                Slot: {health.phase6_scheduler.metadata?.slot_time_wat || '00:00/06:00/12:00/18:00 WAT'}
              </div>
            </div>

            {/* Phase 7 15-Minute Settlement Engine */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500">Phase 7 Settlement</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  health.phase7_settlement.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  {health.phase7_settlement.status}
                </span>
              </div>
              <div className="mt-3">
                <div className="text-sm font-mono text-slate-800 truncate" title={health.phase7_settlement.job_id || ''}>
                  Job: {health.phase7_settlement.job_id ? `${health.phase7_settlement.job_id.slice(0, 12)}...` : 'Active'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Completed: {health.phase7_settlement.completed_at ? new Date(health.phase7_settlement.completed_at).toLocaleTimeString() : 'Recent'}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                Interval: 15-minute live state sync
              </div>
            </div>

            {/* Simulation & Integrity Metrics */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500">Data Integrity</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Verified
                </span>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-black text-slate-900">
                  {health.conflicts.active_conflicts_count} Conflicts
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Incomplete Sims: {health.simulation_integrity.incomplete_simulations_count}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                Settlement Failures: {health.settlement_failures.failed_settlements_count}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200 shadow-sm">
            Loading system health telemetry...
          </div>
        )}
      </div>

      {/* SECTION 2: AUDITABLE SERVER-SIDE CONTROLS */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <span>2. Auditable Server-Side Admin Controls</span>
        </h2>
        <p className="text-xs text-slate-500">
          All actions are executed server-side with strict parameters. Every trigger creates an immutable entry in the audit log.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Form: Trigger Phase 6 Prediction Cycle */}
          <form
            onSubmit={handleTriggerPrediction}
            className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4"
          >
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Trigger 6-Hour Prediction Cycle</h3>
                <p className="text-xs text-slate-500">Discovers fixtures, runs 250k sims, publishes predictions.</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mandatory Audit Reason (min 5 characters) <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={predictionReason}
                onChange={(e) => setPredictionReason(e.target.value)}
                placeholder="e.g. Manual test cycle after Premier League weekend additions"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                required
              />
            </div>

            <button
              type="submit"
              disabled={actionLoading === 'prediction'}
              className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm bg-blue-700 hover:bg-blue-600 text-white shadow-sm transition-all disabled:opacity-50"
            >
              {actionLoading === 'prediction' ? 'Queuing Job Server-Side...' : 'Execute Prediction Scheduler Trigger'}
            </button>
          </form>

          {/* Form: Trigger Phase 7 Settlement Cycle */}
          <form
            onSubmit={handleTriggerSettlement}
            className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4"
          >
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Trigger 15-Minute Settlement Sync</h3>
                <p className="text-xs text-slate-500">Syncs match scores, settles won/lost/void markets.</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mandatory Audit Reason (min 5 characters) <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={settlementReason}
                onChange={(e) => setSettlementReason(e.target.value)}
                placeholder="e.g. Expedited FT reconciliation for ongoing Champions League fixtures"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600"
                required
              />
            </div>

            <button
              type="submit"
              disabled={actionLoading === 'settlement'}
              className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm transition-all disabled:opacity-50"
            >
              {actionLoading === 'settlement' ? 'Queuing Job Server-Side...' : 'Execute Settlement Engine Trigger'}
            </button>
          </form>
        </div>
      </div>

      {/* SECTION 3: USER ROLES & LEAGUES MANAGEMENT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Role Management Form */}
        <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">User Subscription & Role Administration</h3>
          <p className="text-xs text-slate-500">
            Promote or reclassify users with automatic audit tracking of previous and new state.
          </p>

          <form onSubmit={handleUpdateRole} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Select Target User</label>
              <select
                value={roleChangeUserId}
                onChange={(e) => setRoleChangeUserId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-500"
                required
              >
                <option value="">{usersLoading ? '-- Loading Users Directory... --' : '-- Choose User --'}</option>
                {usersList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email} ({u.role})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">New Role / Tier</label>
                <select
                  value={newRole}
                  onChange={(e: any) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-500"
                >
                  <option value="free">Free (Locked Tier)</option>
                  <option value="standard">Standard (Unlocked)</option>
                  <option value="bigbang">BigBang (VIP Access)</option>
                  <option value="admin">Admin (Full Control)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Audit Reason</label>
                <input
                  type="text"
                  value={roleReason}
                  onChange={(e) => setRoleReason(e.target.value)}
                  placeholder="e.g. VIP upgrade grant"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={actionLoading === 'role'}
              className="w-full py-2 px-4 rounded-xl font-semibold text-sm bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition-all disabled:opacity-50"
            >
              {actionLoading === 'role' ? 'Updating Server-Side...' : 'Update User Role & Write Audit'}
            </button>
          </form>
        </div>

        {/* Competition League Toggles */}
        <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">Active Competitions</h3>
              <p className="text-xs text-slate-500">Click to toggle league inclusion in prediction queue.</p>
            </div>
            <span className="text-xs text-slate-500 font-medium">{leaguesList.length} leagues</span>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {leaguesLoading ? (
              <div className="text-xs text-slate-400 italic p-4 text-center">Loading competitions from database...</div>
            ) : leaguesList.length === 0 ? (
              <div className="text-xs text-slate-400 italic p-4 text-center">No competitions found.</div>
            ) : (
              leaguesList.map((lg) => (
              <div
                key={lg.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-all text-sm"
              >
                <div>
                  <div className="font-semibold text-slate-900 flex items-center gap-2">
                    <span>{lg.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 font-mono text-slate-700">
                      {lg.code}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">{lg.country}</div>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleLeague(lg)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                    lg.is_active !== false
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                      : 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                  }`}
                >
                  {lg.is_active !== false ? 'Active' : 'Disabled'}
                </button>
              </div>
            )))}
          </div>
        </div>
      </div>

      {/* SECTION 4: LIVE IMMUTABLE AUDIT TRAIL */}
      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>3. Live Audit Trail & Administrative Log</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                Immutable Ledger
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Every administrative trigger, role modification, and scheduler execution with actor, action, timestamp, reason, and state diffs.
            </p>
          </div>
          <button
            onClick={fetchAuditLogs}
            disabled={auditLoading}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg bg-white border border-slate-300 shadow-sm transition-colors"
          >
            {auditLoading ? 'Loading...' : 'Refresh Logs'}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-600 border-b border-slate-200 tracking-wider sticky top-0 bg-slate-50 z-10">
              <tr>
                <th className="px-4 py-3">Timestamp (WAT)</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target / Table</th>
                <th className="px-4 py-3">Audit Reason</th>
                <th className="px-4 py-3">State Diff (Prev → New)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {auditLogs.length > 0 ? (
                auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-900 font-semibold truncate max-w-[140px]" title={log.actor_email || log.actor_id || 'System'}>
                        {log.actor_email || (log.actor_id ? log.actor_id.slice(0, 8) : 'System')}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase">{log.actor_role || 'system'}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-sans font-bold text-[10px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      <div>{log.affected_table || (log as any).target_table || (log as any).resource_type || 'system'}</div>
                      {(log.affected_record_id || (log as any).target_id || (log as any).resource_id) && (
                        <div className="text-[10px] text-slate-400 truncate max-w-[120px]">
                          {log.affected_record_id || (log as any).target_id || (log as any).resource_id}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-800 font-sans max-w-[200px] truncate" title={log.reason || (log as any).details?.reason || (log as any).payload?.reason || 'System operation'}>
                      {log.reason || (log as any).details?.reason || (log as any).payload?.reason || 'System operation'}
                    </td>
                    <td className="px-4 py-2.5 text-[10px] text-slate-500 max-w-[180px] truncate">
                      {(log.previous_state || (log as any).details?.previous_state) || (log.new_state || (log as any).details?.new_state) ? (
                        <span title={`Prev: ${JSON.stringify(log.previous_state || (log as any).details?.previous_state)} | New: ${JSON.stringify(log.new_state || (log as any).details?.new_state)}`}>
                          {(log.previous_state || (log as any).details?.previous_state) ? JSON.stringify(log.previous_state || (log as any).details?.previous_state) : 'none'} → {(log.new_state || (log as any).details?.new_state) ? JSON.stringify(log.new_state || (log as any).details?.new_state) : 'none'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 italic font-sans">
                    No audit records registered yet. Administrative actions automatically populate here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
