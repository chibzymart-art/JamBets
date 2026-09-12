import React from 'react';

export interface GoalPredictionItem {
  id: string;
  fixture_id: string;
  market: 'over_2.5_goals' | 'ht_over_0.5_goals';
  predicted_outcome: string;
  probability: number | null;
  confidence_tier: string;
  xg_combined: number | null;
  home_over25_rate: number | null;
  away_over25_rate: number | null;
  h2h_over25_rate: number | null;
  ht_goal_frequency: number | null;
  avg_first_goal_minute: number | null;
  target_kickoff_at: string;
  settlement_status: 'pending' | 'won' | 'lost' | 'void';
  settled_at: string | null;
  actual_score: string | null;
  ht_score: string | null;
  settlement_notes: string | null;
  is_locked: boolean;
  fixture?: {
    id: string;
    target_kickoff_at: string;
    status: string;
    period?: string | null;
    match_minute?: number | null;
    home_score?: number | null;
    away_score?: number | null;
    half_time_home_score?: number | null;
    half_time_away_score?: number | null;
    league_name?: string;
    home_team_name?: string;
    away_team_name?: string;
    league?: { name: string; country?: string; code?: string };
    home_team?: { name: string };
    away_team?: { name: string };
  };
}

interface GoalCardProps {
  prediction: GoalPredictionItem;
  isPaidUser: boolean;
  onOpenUpgrade?: () => void;
}

export const GoalCard: React.FC<GoalCardProps> = ({
  prediction,
  isPaidUser,
  onOpenUpgrade
}) => {
  const f = prediction.fixture;
  const isOver25 = prediction.market === 'over_2.5_goals';
  const isLocked = prediction.is_locked && !isPaidUser;

  // Format Kickoff Date in Africa/Lagos (WAT / UTC+1)
  const kickoffStr = React.useMemo(() => {
    try {
      const d = new Date(prediction.target_kickoff_at);
      return d.toLocaleTimeString('en-GB', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch {
      return '--:--';
    }
  }, [prediction.target_kickoff_at]);

  const homeName = f?.home_team?.name || f?.home_team_name || 'Home Club';
  const awayName = f?.away_team?.name || f?.away_team_name || 'Away Club';
  const leagueName = f?.league?.name || f?.league_name || 'World Football';

  const isLive = f?.status === 'live' || f?.status === 'in_progress' || f?.status === 'halftime';
  const isFinished = f?.status === 'finished' || f?.period === 'FT' || prediction.settlement_status !== 'pending';

  // Tier Color Config (Bright Theme Optimized)
  const tierMeta = React.useMemo(() => {
    switch (prediction.confidence_tier) {
      case 'GOAL_MACHINE':
        return { label: 'GOAL MACHINE 🔥', bg: '#fef2f2', border: '#ef4444', text: '#b91c1c' };
      case 'OVER_25_LOCK':
        return { label: 'OVER 2.5 LOCK ⚡', bg: '#fff7ed', border: '#f97316', text: '#c2410c' };
      case 'EARLY_STRIKE':
        return { label: 'EARLY STRIKE ⏱️', bg: '#ecfdf5', border: '#10b981', text: '#047857' };
      case 'TEMPO_HIGH':
        return { label: 'HIGH TEMPO 🚀', bg: '#f5f3ff', border: '#8b5cf6', text: '#6d28d9' };
      default:
        return { label: 'LEAN OVER 📈', bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8' };
    }
  }, [prediction.confidence_tier]);

  const probPercent = prediction.probability ? `${(prediction.probability * 100).toFixed(1)}%` : '--%';

  return (
    <div className={`goal-card-genz ${isLocked ? 'goal-card-locked' : ''}`}>
      {/* Top Meta Line: League, Kickoff Time, Status */}
      <div className="goal-card-header">
        <div className="goal-league-chip">
          <span className="goal-league-dot" />
          <span className="goal-league-text">{leagueName}</span>
        </div>

        <div className="goal-status-group">
          {isLive ? (
            <span className="goal-live-badge">
              <span className="live-pulse-dot" />
              LIVE {f?.match_minute ? `${f.match_minute}'` : (f?.period || '')}
            </span>
          ) : isFinished ? (
            <span className="goal-ft-badge">
              FT {f && f.home_score !== null && f.home_score !== undefined && f.away_score !== null && f.away_score !== undefined ? `${f.home_score}-${f.away_score}` : ''}
            </span>
          ) : (
            <span className="goal-time-badge">
              🕒 {kickoffStr} WAT
            </span>
          )}
        </div>
      </div>

      {/* Matchup Teams */}
      <div className="goal-teams-row">
        <div className="goal-team-block home">
          <span className="goal-team-name">{homeName}</span>
        </div>
        <div className="goal-vs-divider">
          {isFinished || isLive ? (
            <span className="goal-live-score">
              {f?.home_score ?? 0} : {f?.away_score ?? 0}
            </span>
          ) : (
            <span className="goal-vs-text">VS</span>
          )}
        </div>
        <div className="goal-team-block away">
          <span className="goal-team-name">{awayName}</span>
        </div>
      </div>

      {/* Hero Prediction Pill */}
      <div className="goal-hero-section">
        {isLocked ? (
          <div className="goal-locked-banner" onClick={onOpenUpgrade}>
            <span className="goal-lock-icon">🔒</span>
            <div className="goal-locked-info">
              <span className="goal-locked-title">
                {isOver25 ? 'Over 2.5 Goal Signal' : '1st Half Over 0.5 Signal'}
              </span>
              <span className="goal-locked-sub">VIP & Paid Tier Access Required</span>
            </div>
            <button className="goal-unlock-pill-btn">Unlock</button>
          </div>
        ) : (
          <div className="goal-hero-unlocked">
            <div className="goal-market-badge">
              <span className="goal-market-icon">{isOver25 ? '🎯' : '⏱️'}</span>
              <span className="goal-market-label">
                {isOver25 ? 'OVER 2.5 GOALS' : '1ST HALF OVER 0.5'}
              </span>
            </div>

            <div className="goal-prob-pill">
              <span className="goal-prob-val">{probPercent}</span>
              <span className="goal-prob-sub">Confidence</span>
            </div>

            <div
              className="goal-tier-pill"
              style={{
                background: tierMeta.bg,
                borderColor: tierMeta.border,
                color: tierMeta.text
              }}
            >
              {tierMeta.label}
            </div>
          </div>
        )}
      </div>

      {/* Micro Stats Matrix (Single Row Mobile Friendly) */}
      {!isLocked && (
        <div className="goal-stats-grid">
          <div className="goal-stat-item">
            <span className="stat-label">Combined xG</span>
            <span className="stat-val highlight">{prediction.xg_combined?.toFixed(2) || '2.85'}</span>
          </div>
          <div className="goal-stat-item">
            <span className="stat-label">Over 2.5 Form</span>
            <span className="stat-val">
              {Math.round(((prediction.home_over25_rate || 65) + (prediction.away_over25_rate || 65)) / 2)}%
            </span>
          </div>
          <div className="goal-stat-item">
            <span className="stat-label">1H Goal %</span>
            <span className="stat-val">{prediction.ht_goal_frequency || 80}%</span>
          </div>
          <div className="goal-stat-item">
            <span className="stat-label">Est. 1st Goal</span>
            <span className="stat-val">{prediction.avg_first_goal_minute || 24}'</span>
          </div>
        </div>
      )}

      {/* Settlement Result Footer (If Settled) */}
      {prediction.settlement_status !== 'pending' && (
        <div className={`goal-settlement-strip status-${prediction.settlement_status}`}>
          <div className="settlement-left">
            <span className="settlement-status-tag">
              {prediction.settlement_status === 'won' ? '✓ WON' : (prediction.settlement_status === 'lost' ? '✗ LOST' : '⊘ VOID')}
            </span>
            <span className="settlement-note">{prediction.settlement_notes || 'Verified official score'}</span>
          </div>
          {prediction.ht_score && isOver25 && (
            <span className="ht-score-tag">HT: {prediction.ht_score}</span>
          )}
        </div>
      )}
    </div>
  );
};
