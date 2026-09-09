import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PlatformAnalytics, TierPerformanceMetrics } from '../types';

interface AnalyticsViewProps {
  onBackToFixtures?: () => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ onBackToFixtures }) => {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_platform_analytics');
      if (rpcErr) {
        throw new Error(rpcErr.message);
      }
      setAnalytics(data as PlatformAnalytics);
      setLastRefreshed(new Date());
    } catch (err: any) {
      console.error('Failed to fetch platform analytics:', err);
      setError(err.message || 'Failed to load platform analytics from Supabase.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const tierConfig: Record<
    string,
    { label: string; key: keyof PlatformAnalytics['tier_performance']; color: string; badge: string; description: string }
  > = {
    banger: {
      label: 'BANGER (90%+ Prob)',
      key: 'banger',
      color: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40',
      description: 'Ultra-high probability simulations (≥90% verified Poisson/Negative Binomial consensus).',
    },
    top_pick: {
      label: 'TOP PICK (80%–89%)',
      key: 'top_pick',
      color: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
      badge: 'bg-blue-950/80 text-blue-300 border-blue-500/40',
      description: 'Prime market selections with 80%–89% calibrated probability.',
    },
    high_confidence: {
      label: 'HIGH CONFIDENCE (70%–79%)',
      key: 'high_confidence',
      color: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
      badge: 'bg-purple-950/80 text-purple-300 border-purple-500/40',
      description: 'Strong mathematical edges (70%–79% simulated probability).',
    },
    mid_confidence: {
      label: 'MID CONFIDENCE (60%–69%)',
      key: 'mid_confidence',
      color: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      badge: 'bg-amber-950/80 text-amber-300 border-amber-500/40',
      description: 'Moderate probabilistic edges (60%–69% probability).',
    },
    low_confidence: {
      label: 'LOW CONFIDENCE (50%–59%)',
      key: 'low_confidence',
      color: 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
      badge: 'bg-slate-900/80 text-slate-300 border-slate-600/40',
      description: 'Slight statistical favorite (50%–59% probability).',
    },
    risky: {
      label: 'RISKY (<50% Value)',
      key: 'risky',
      color: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
      badge: 'bg-red-950/80 text-red-300 border-red-500/40',
      description: 'High-variance market opportunities where odds exceed true probability.',
    },
  };

  return (
    <div className="analytics-container space-y-8 max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Authoritative Supabase Analytics
            </span>
            <span className="text-xs text-slate-400">
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <span>Platform Performance & Mathematical Audit</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Complete transparency: verifiable win/loss metrics calculated directly by Cloud Supabase stored procedures over 250,000-simulation prediction datasets.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onBackToFixtures && (
            <button
              onClick={onBackToFixtures}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
            >
              ← Back to Fixtures
            </button>
          )}
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/40 rounded-lg shadow-sm transition-all disabled:opacity-50"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{loading ? 'Refreshing...' : 'Refresh Stats'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-sm flex items-start gap-3">
          <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <div className="font-semibold">Analytics Calculation Error</div>
            <div className="text-slate-300 text-xs mt-1">{error}</div>
          </div>
        </div>
      )}

      {/* Main KPI Row */}
      {analytics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Win Rate Card */}
          <div className="glass-panel p-5 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-slate-900/60 to-black/80 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center justify-between">
              <span>Overall Win Rate</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-white tracking-tight">
                {analytics.overall_win_rate_pct.toFixed(1)}%
              </span>
              <span className="text-xs text-slate-400 font-medium">
                ({analytics.total_won} / {analytics.total_decided} decided)
              </span>
            </div>
            <div className="mt-4 w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/10">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, analytics.overall_win_rate_pct))}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>Loss Rate: {analytics.overall_loss_rate_pct.toFixed(1)}%</span>
              <span className="text-emerald-400 font-semibold">{analytics.total_won} Won</span>
            </div>
          </div>

          {/* Loss Rate Card */}
          <div className="glass-panel p-5 rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-950/30 via-slate-900/60 to-black/80 relative overflow-hidden">
            <div className="text-xs font-bold uppercase tracking-wider text-red-400 flex items-center justify-between">
              <span>Platform Loss Rate</span>
              <span className="text-xs text-slate-500">Decided Bets</span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-white tracking-tight">
                {analytics.overall_loss_rate_pct.toFixed(1)}%
              </span>
              <span className="text-xs text-slate-400 font-medium">
                ({analytics.total_lost} / {analytics.total_decided})
              </span>
            </div>
            <div className="mt-4 w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/10">
              <div
                className="bg-gradient-to-r from-red-500 to-rose-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, analytics.overall_loss_rate_pct))}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>Decided denominator</span>
              <span className="text-red-400 font-semibold">{analytics.total_lost} Lost</span>
            </div>
          </div>

          {/* Pending In-Flight Card */}
          <div className="glass-panel p-5 rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-950/30 via-slate-900/60 to-black/80">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center justify-between">
              <span>Active Pending</span>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-300">In-Flight</span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-white tracking-tight">
                {analytics.total_pending}
              </span>
              <span className="text-xs text-slate-400">awaiting kickoff / FT</span>
            </div>
            <div className="mt-4 text-xs text-slate-400 leading-relaxed">
              Excluded from win rate denominator until full mathematical settlement.
            </div>
            <div className="mt-2 text-xs text-blue-300 font-medium">
              Total Published: {analytics.total_eligible_published}
            </div>
          </div>

          {/* Voided & Quarantined Card */}
          <div className="glass-panel p-5 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/30 via-slate-900/60 to-black/80">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center justify-between">
              <span>Voided & Conflicts</span>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300">Protected</span>
            </div>
            <div className="mt-3 flex items-baseline gap-3">
              <div>
                <span className="text-3xl font-black text-white">{analytics.total_voided}</span>
                <span className="text-xs text-slate-400 ml-1">Voided</span>
              </div>
              <div className="border-l border-white/10 pl-3">
                <span className="text-3xl font-black text-amber-300">{analytics.total_conflict}</span>
                <span className="text-xs text-amber-400/80 ml-1">Conflicts</span>
              </div>
            </div>
            <div className="mt-4 text-xs text-slate-400 leading-relaxed">
              Voided matches refunded. Conflicts quarantined until multi-source audit.
            </div>
          </div>
        </div>
      )}

      {/* 6 Confidence Tier Breakdown */}
      {analytics && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>Confidence Tier Performance Breakdown</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Each prediction is classified into one of 6 strict confidence tiers based on 250,000 Monte Carlo simulations.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(tierConfig).map(([tierKey, config]) => {
              const metrics: TierPerformanceMetrics =
                analytics.tier_performance[config.key] || {
                  total_decided: 0,
                  won: 0,
                  lost: 0,
                  pending: 0,
                  voided: 0,
                  conflict: 0,
                  win_rate_pct: 0,
                };

              return (
                <div
                  key={tierKey}
                  className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 hover:border-white/20 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-md border ${config.badge}`}>
                        {config.label}
                      </span>
                      <span className="text-lg font-extrabold text-white">
                        {metrics.win_rate_pct.toFixed(1)}%
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed min-h-[32px] mb-3">
                      {config.description}
                    </p>

                    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/10 mb-3">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.max(0, metrics.win_rate_pct))}%`,
                          background: config.color,
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 pt-3 border-t border-white/5 text-center text-xs">
                    <div className="bg-emerald-950/30 p-2 rounded-lg border border-emerald-500/20">
                      <div className="text-[10px] text-emerald-400 uppercase font-semibold">Won</div>
                      <div className="text-sm font-bold text-white mt-0.5">{metrics.won}</div>
                    </div>
                    <div className="bg-red-950/30 p-2 rounded-lg border border-red-500/20">
                      <div className="text-[10px] text-red-400 uppercase font-semibold">Lost</div>
                      <div className="text-sm font-bold text-white mt-0.5">{metrics.lost}</div>
                    </div>
                    <div className="bg-blue-950/30 p-2 rounded-lg border border-blue-500/20">
                      <div className="text-[10px] text-blue-400 uppercase font-semibold">Pending</div>
                      <div className="text-sm font-bold text-white mt-0.5">{metrics.pending}</div>
                    </div>
                    <div className="bg-slate-800/40 p-2 rounded-lg border border-white/10">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Decided</div>
                      <div className="text-sm font-bold text-slate-200 mt-0.5">{metrics.total_decided}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily Performance History Table */}
      {analytics && (
        <div className="glass-panel p-6 rounded-2xl border border-white/10 bg-slate-900/60 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Daily Performance History (Last 30 Days)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Every settled prediction indexed by match calendar date (WAT timezone).
              </p>
            </div>
            <span className="text-xs text-slate-400">
              {analytics.daily_performance?.length || 0} active match days recorded
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-white/5 text-xs uppercase font-bold text-slate-400 border-b border-white/10 tracking-wider">
                <tr>
                  <th className="px-4 py-3">Match Date</th>
                  <th className="px-4 py-3 text-center">Decided</th>
                  <th className="px-4 py-3 text-center text-emerald-400">Won</th>
                  <th className="px-4 py-3 text-center text-red-400">Lost</th>
                  <th className="px-4 py-3 text-center text-blue-400">Pending</th>
                  <th className="px-4 py-3 text-center text-amber-400">Voided</th>
                  <th className="px-4 py-3 text-right">Daily Win Rate</th>
                  <th className="px-4 py-3 text-right">Daily Loss Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {analytics.daily_performance && analytics.daily_performance.length > 0 ? (
                  analytics.daily_performance.map((day) => (
                    <tr key={day.date} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 font-semibold text-white">
                        {day.date}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-200">
                        {day.decided}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-emerald-400">
                        {day.won}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-red-400">
                        {day.lost}
                      </td>
                      <td className="px-4 py-3 text-center text-blue-400">
                        {day.pending}
                      </td>
                      <td className="px-4 py-3 text-center text-amber-400">
                        {day.voided}
                      </td>
                      <td className="px-4 py-3 text-right font-black text-emerald-400">
                        {day.decided > 0 ? `${day.win_rate_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-400">
                        {day.decided > 0 ? `${day.loss_rate_pct.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500 italic">
                      No settled fixtures in the last 30 days yet. Historical dates populate as Phase 7 settlements execute.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Explicit Mathematical Treatment Rules Legend */}
      {analytics && analytics.treatment_rules && (
        <div className="glass-panel p-6 rounded-2xl border border-white/10 bg-slate-900/60 space-y-4">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </span>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                Statistical Governance & Mathematical Rules
              </h3>
              <p className="text-xs text-slate-400">
                JamBets adheres to verifiable audit standards. No manipulated denominators, no hidden losses.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/20">
              <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">
                1. In-Flight Pending
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {analytics.treatment_rules.pending}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/20">
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">
                2. Voided / Cancelled
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {analytics.treatment_rules.voided_cancelled}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/20">
              <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1">
                3. Quarantined Conflicts
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {analytics.treatment_rules.conflicts}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
