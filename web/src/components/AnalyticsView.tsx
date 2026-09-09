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
      label: '🔥 BANGER (96%–100%)',
      key: 'banger',
      color: '#e25822', // Flame
      badge: 'bg-[#fff5f0] text-[#c2410c] border-[#f97316]',
      description: 'Fireball consensus: ultra-high probability simulations (96%–100% verified Poisson/Negative Binomial consensus).',
    },
    top_pick: {
      label: 'TOP PICK (90%–95.99%)',
      key: 'top_pick',
      color: '#1e40af', // Deep Blue
      badge: 'bg-[#eff6ff] text-[#1d4ed8] border-[#3b82f6]',
      description: 'Prime market selections with 90%–95.99% calibrated probability.',
    },
    high_confidence: {
      label: 'HIGH CONFIDENCE (83%–89.99%)',
      key: 'high_confidence',
      color: '#0284c7', // Light Blue
      badge: 'bg-[#f0f9ff] text-[#0369a1] border-[#38bdf8]',
      description: 'Strong mathematical edges (83%–89.99% simulated probability).',
    },
    mid_confidence: {
      label: 'MID CONFIDENCE (70%–82.99%)',
      key: 'mid_confidence',
      color: '#ea580c', // Deep Orange
      badge: 'bg-[#fff7ed] text-[#c2410c] border-[#f97316]',
      description: 'Solid mathematical edges (70%–82.99% probability).',
    },
    low_confidence: {
      label: 'LOW CONFIDENCE (60%–69.99%)',
      key: 'low_confidence',
      color: '#f59e0b', // Light Orange
      badge: 'bg-[#fffbeb] text-[#b45309] border-[#fbbf24]',
      description: 'Slight statistical favorites (60%–69.99% probability).',
    },
    risky: {
      label: 'RISKY (45%–59.99%)',
      key: 'risky',
      color: '#ec4899', // Light Pink
      badge: 'bg-[#fdf2f8] text-[#be185d] border-[#f472b6]',
      description: 'High-variance market opportunities where odds exceed true probability.',
    },
  };

  return (
    <div className="analytics-container space-y-8 max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-300">
              Authoritative Supabase Analytics
            </span>
            <span className="text-xs text-slate-500">
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            <span>Platform Performance & Mathematical Audit</span>
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Complete transparency: verifiable win/loss metrics calculated directly by Cloud Supabase stored procedures over 250,000-simulation prediction datasets.
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
            onClick={fetchAnalytics}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 border border-slate-900 rounded-lg shadow-sm transition-all disabled:opacity-50"
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
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-3">
          <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <div className="font-semibold">Analytics Calculation Error</div>
            <div className="text-red-700 text-xs mt-1">{error}</div>
          </div>
        </div>
      )}

      {/* Main KPI Row */}
      {analytics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Win Rate Card */}
          <div className="p-5 rounded-2xl border border-emerald-200 bg-white shadow-sm relative overflow-hidden">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center justify-between">
              <span>Overall Win Rate</span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-slate-900 tracking-tight">
                {analytics.overall_win_rate_pct.toFixed(1)}%
              </span>
              <span className="text-xs text-slate-500 font-medium">
                ({analytics.total_won} / {analytics.total_decided} decided)
              </span>
            </div>
            <div className="mt-4 w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200">
              <div
                className="h-full rounded-full transition-all duration-500 bg-[#16a34a]"
                style={{ width: `${Math.min(100, Math.max(0, analytics.overall_win_rate_pct))}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>Loss Rate: {analytics.overall_loss_rate_pct.toFixed(1)}%</span>
              <span className="text-emerald-700 font-bold">{analytics.total_won} Won</span>
            </div>
          </div>

          {/* Loss Rate Card */}
          <div className="p-5 rounded-2xl border border-red-200 bg-white shadow-sm relative overflow-hidden">
            <div className="text-xs font-bold uppercase tracking-wider text-red-700 flex items-center justify-between">
              <span>Platform Loss Rate</span>
              <span className="text-xs text-slate-500">Decided Bets</span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-slate-900 tracking-tight">
                {analytics.overall_loss_rate_pct.toFixed(1)}%
              </span>
              <span className="text-xs text-slate-500 font-medium">
                ({analytics.total_lost} / {analytics.total_decided})
              </span>
            </div>
            <div className="mt-4 w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200">
              <div
                className="h-full rounded-full transition-all duration-500 bg-[#dc2626]"
                style={{ width: `${Math.min(100, Math.max(0, analytics.overall_loss_rate_pct))}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>Decided denominator</span>
              <span className="text-red-700 font-bold">{analytics.total_lost} Lost</span>
            </div>
          </div>

          {/* Pending In-Flight Card */}
          <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
              <span>Active Pending</span>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-blue-50 text-blue-700 border border-blue-200">In-Flight</span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black text-slate-900 tracking-tight">
                {analytics.total_pending}
              </span>
              <span className="text-xs text-slate-500">awaiting kickoff / FT</span>
            </div>
            <div className="mt-4 text-xs text-slate-500 leading-relaxed">
              Excluded from win rate denominator until full mathematical settlement.
            </div>
            <div className="mt-2 text-xs text-slate-700 font-semibold">
              Total Published: {analytics.total_eligible_published}
            </div>
          </div>

          {/* Voided & Quarantined Card */}
          <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
              <span>Voided & Conflicts</span>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-amber-50 text-amber-700 border border-amber-200">Protected</span>
            </div>
            <div className="mt-3 flex items-baseline gap-3">
              <div>
                <span className="text-3xl font-black text-slate-900">{analytics.total_voided}</span>
                <span className="text-xs text-slate-500 ml-1">Voided</span>
              </div>
              <div className="border-l border-slate-200 pl-3">
                <span className="text-3xl font-black text-amber-600">{analytics.total_conflict}</span>
                <span className="text-xs text-amber-600 ml-1">Conflicts</span>
              </div>
            </div>
            <div className="mt-4 text-xs text-slate-500 leading-relaxed">
              Voided matches refunded. Conflicts quarantined until multi-source audit.
            </div>
          </div>
        </div>
      )}

      {/* 6 Confidence Tier Breakdown */}
      {analytics && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>Confidence Tier Performance Breakdown</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Each prediction is classified into one of 6 strict confidence tiers based on 250,000 Monte Carlo simulations.
            </p>
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
                  className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`px-2.5 py-0.5 text-xs font-bold rounded-md border ${config.badge}`}>
                        {config.label}
                      </span>
                      <span className="text-lg font-extrabold text-slate-900">
                        {metrics.win_rate_pct.toFixed(1)}%
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed min-h-[32px] mb-3">
                      {config.description}
                    </p>

                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200 mb-3">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.max(0, metrics.win_rate_pct))}%`,
                          backgroundColor: config.color,
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-100 text-center text-xs">
                    <div className="bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                      <div className="text-[10px] text-emerald-800 uppercase font-bold">Won</div>
                      <div className="text-sm font-black text-emerald-700 mt-0.5">{metrics.won}</div>
                    </div>
                    <div className="bg-red-50 p-2 rounded-lg border border-red-200">
                      <div className="text-[10px] text-red-800 uppercase font-bold">Lost</div>
                      <div className="text-sm font-black text-red-700 mt-0.5">{metrics.lost}</div>
                    </div>
                    <div className="bg-blue-50 p-2 rounded-lg border border-blue-200">
                      <div className="text-[10px] text-blue-800 uppercase font-bold">Pending</div>
                      <div className="text-sm font-black text-blue-700 mt-0.5">{metrics.pending}</div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                      <div className="text-[10px] text-slate-700 uppercase font-bold">Decided</div>
                      <div className="text-sm font-black text-slate-800 mt-0.5">{metrics.total_decided}</div>
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
        <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                Daily Performance History (Last 30 Days)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Every settled prediction indexed by match calendar date (WAT timezone).
              </p>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {analytics.daily_performance?.length || 0} active match days recorded
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs uppercase font-bold text-slate-600 border-b border-slate-200 tracking-wider">
                <tr>
                  <th className="px-4 py-3">Match Date</th>
                  <th className="px-4 py-3 text-center">Decided</th>
                  <th className="px-4 py-3 text-center text-emerald-700">Won</th>
                  <th className="px-4 py-3 text-center text-red-700">Lost</th>
                  <th className="px-4 py-3 text-center text-blue-700">Pending</th>
                  <th className="px-4 py-3 text-center text-amber-700">Voided</th>
                  <th className="px-4 py-3 text-right">Daily Win Rate</th>
                  <th className="px-4 py-3 text-right">Daily Loss Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics.daily_performance && analytics.daily_performance.length > 0 ? (
                  analytics.daily_performance.map((day) => (
                    <tr key={day.date} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {day.date}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-800">
                        {day.decided}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-emerald-600">
                        {day.won}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-red-600">
                        {day.lost}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-blue-600">
                        {day.pending}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-amber-600">
                        {day.voided}
                      </td>
                      <td className="px-4 py-3 text-right font-black text-emerald-700">
                        {day.decided > 0 ? `${day.win_rate_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-600">
                        {day.decided > 0 ? `${day.loss_rate_pct.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400 italic">
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
        <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </span>
            <div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                Statistical Governance & Mathematical Rules
              </h3>
              <p className="text-xs text-slate-500">
                JamBets adheres to verifiable audit standards. No manipulated denominators, no hidden losses.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200">
              <div className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-1">
                1. In-Flight Pending
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {analytics.treatment_rules.pending}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200">
              <div className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-1">
                2. Voided / Cancelled
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {analytics.treatment_rules.voided_cancelled}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-red-50/60 border border-red-200">
              <div className="text-xs font-bold text-red-900 uppercase tracking-wider mb-1">
                3. Quarantined Conflicts
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {analytics.treatment_rules.conflicts}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
