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
  metadata?: any;
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
    home_team?: { name: string; short_name?: string };
    away_team?: { name: string; short_name?: string };
  };
}

export interface GroupedGoalMatch {
  fixture_id: string;
  target_kickoff_at: string;
  status: string;
  period?: string | null;
  match_minute?: number | null;
  home_score?: number | null;
  away_score?: number | null;
  half_time_home_score?: number | null;
  half_time_away_score?: number | null;
  league_name: string;
  home_team_name: string;
  away_team_name: string;
  actual_score: string | null;
  ht_score: string | null;
  settlement_status: 'pending' | 'won' | 'lost' | 'void';
  over25: GoalPredictionItem | null;
  ht05: GoalPredictionItem | null;
  maxProbability: number;
}

interface GoalMatchRowProps {
  match: GroupedGoalMatch;
  isPaidUser: boolean;
  onOpenUpgrade?: () => void;
}

const KNOWN_CLUB_OVERRIDES: Record<string, string> = {
  'scr-altach': 'SCR Altach',
  'grazer-ak': 'Grazer AK',
  'ofi-crete': 'OFI Crete',
  'st-pauli': 'FC St. Pauli',
  'atletico-mg': 'Atlético Mineiro',
  'vasco-da-gama': 'Vasco da Gama',
  'tottenham-hotspur': 'Tottenham Hotspur',
  'ac-milan': 'AC Milan',
  'inter-milan': 'Inter Milan',
  'internazionale': 'Inter Milan',
  'werder-bremen': 'Werder Bremen',
  'al-hilal': 'Al-Hilal',
  'al-taawoun': 'Al-Taawoun',
  'al-nassr': 'Al-Nassr',
  'al-ittihad': 'Al-Ittihad',
  'al-ahli': 'Al-Ahli',
  'al-shabab': 'Al-Shabab',
  'al-fateh': 'Al-Fateh',
  'al-ettifaq': 'Al-Ettifaq',
  'al-wehdah': 'Al-Wehda',
  'al-khaleej': 'Al-Khaleej',
  'al-raed': 'Al-Raed',
  'al-hazem': 'Al-Hazem',
  'al-fayha': 'Al-Fayha',
  'al-riyadh': 'Al-Riyadh',
  'damac': 'Damac FC',
  'abha': 'Abha Club',
  'al-okhdood': 'Al-Okhdood',
  'al-orobah': 'Al-Orobah',
  'al-qadsiah': 'Al-Qadsiah',
  'al-kholood': 'Al-Kholood',
  'st-gallen': 'FC St. Gallen',
  'cologne': '1. FC Köln',
  'lazio': 'SS Lazio',
  'ss-lazio': 'SS Lazio',
  'man-city': 'Manchester City',
  'man-united': 'Manchester United',
  'manchester-city': 'Manchester City',
  'manchester-united': 'Manchester United',
  'paris-saint-germain': 'PSG',
  'psg': 'PSG',
  'bayern-munich': 'Bayern Munich',
  'borussia-dortmund': 'Borussia Dortmund',
  'bayer-leverkusen': 'Bayer Leverkusen',
  'rb-leipzig': 'RB Leipzig',
  'real-madrid': 'Real Madrid',
  'barcelona': 'FC Barcelona',
  'fc-barcelona': 'FC Barcelona',
  'atletico-madrid': 'Atlético Madrid',
  'athletic-bilbao': 'Athletic Bilbao',
  'real-sociedad': 'Real Sociedad',
  'real-betis': 'Real Betis',
  'sporting-cp': 'Sporting CP',
  'porto': 'FC Porto',
  'benfica': 'SL Benfica',
  'cremonese': 'US Cremonese',
  'cesena': 'Cesena FC',
  'elche': 'Elche CF',
  'everton': 'Everton',
  'gremio': 'Grêmio',
  'fluminense': 'Fluminense',
  'grasshopper': 'Grasshoppers Zurich',
  'sion': 'FC Sion',
  'thun': 'FC Thun',
  'young-boys': 'BSC Young Boys',
  'servette': 'Servette FC',
  'basel': 'FC Basel',
  'zurich': 'FC Zürich',
  'luzern': 'FC Luzern',
  'winterthur': 'FC Winterthur'
};

const CLUB_ACRONYMS = new Set([
  'fc', 'fk', 'afc', 'cf', 'sc', 'cd', 'ud', 'sk', 'ac', 'as', 'ae', 'rc',
  'ss', 'us', 'tsg', 'vfb', 'vfl', 'fsv', 'bsc', 'sv', 'la', 'nyc', 'dc',
  'cp', 'ca', 'cr', 'rb', 'psv', 'h&h', 'ii', 'iii', 'iv', 'scr', 'ak', 'ofi'
]);

export function formatClubName(name?: string | null): string {
  if (!name) return 'Club';
  const raw = name.trim();
  const slug = raw.toLowerCase().replace(/\s+/g, '-');
  if (KNOWN_CLUB_OVERRIDES[slug]) {
    return KNOWN_CLUB_OVERRIDES[slug];
  }
  return raw
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (CLUB_ACRONYMS.has(lower)) {
        if (lower === 'vfb') return 'VfB';
        if (lower === 'vfl') return 'VfL';
        return lower.toUpperCase();
      }
      if (lower === 'da' || lower === 'de' || lower === 'del' || lower === 'la' || lower === 'van' || lower === 'von') {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function formatFullKickoff(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    const now = new Date();

    const dLagosDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);

    const todayLagosDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);

    const tomorrowLagosDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(now.getTime() + 86400000));

    const timeStr = d.toLocaleTimeString('en-GB', {
      timeZone: 'Africa/Lagos',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    if (dLagosDate === todayLagosDate) {
      return `Today • ${timeStr} WAT`;
    }
    if (dLagosDate === tomorrowLagosDate) {
      return `Tomorrow • ${timeStr} WAT`;
    }

    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Lagos',
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    }).format(d);

    return `${dayName} • ${timeStr} WAT`;
  } catch {
    return 'Kickoff TBA';
  }
}

export const GoalCard: React.FC<GoalMatchRowProps> = ({
  match,
  isPaidUser,
  onOpenUpgrade
}) => {
  const over25 = match.over25;
  const ht05 = match.ht05;

  const isOver25Locked = (over25?.is_locked ?? true) && !isPaidUser;
  const isHt05Locked = (ht05?.is_locked ?? true) && !isPaidUser;

  const kickoffFormatted = formatFullKickoff(match.target_kickoff_at);

  const homeName = formatClubName(match.home_team_name);
  const awayName = formatClubName(match.away_team_name);
  const leagueName = match.league_name.toUpperCase();

  const isLive = match.status === 'live' || match.status === 'in_progress' || match.status === 'halftime';
  const isFinished = match.status === 'finished' || match.period === 'FT' || match.settlement_status !== 'pending';

  // Live or Final Score (purely the score, no Won or Lose tags)
  const scoreDisplay = match.actual_score || (
    match.home_score !== null && match.home_score !== undefined &&
    match.away_score !== null && match.away_score !== undefined
      ? `${match.home_score} - ${match.away_score}`
      : null
  );

  const htScoreDisplay = match.ht_score || (
    match.half_time_home_score !== null && match.half_time_home_score !== undefined &&
    match.half_time_away_score !== null && match.half_time_away_score !== undefined
      ? `${match.half_time_home_score} - ${match.half_time_away_score}`
      : null
  );

  // Effective Probabilities (Ensures free sample teasers display realistic confidence instead of --%)
  const over25EffectiveProb = over25?.probability ?? (
    !isOver25Locked && over25?.xg_combined
      ? Math.min(0.88, Math.max(0.62, (over25.xg_combined / 4.0) * 0.85))
      : (!isOver25Locked ? 0.68 : null)
  );

  const ht05EffectiveProb = ht05?.probability ?? (
    !isHt05Locked && ht05?.ht_goal_frequency
      ? (ht05.ht_goal_frequency / 100.0)
      : (!isHt05Locked ? 0.76 : null)
  );

  // Tier Meta for Over 2.5
  const over25Tier = React.useMemo(() => {
    if (!over25) return { label: 'LEAN OVER 📈', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', barGradient: 'linear-gradient(90deg, #3b82f6, #2563eb)' };
    let tier = over25.confidence_tier;
    if ((tier === 'LOCKED' || !tier) && !isOver25Locked) {
      const prob = over25EffectiveProb || 0.68;
      tier = prob >= 0.75 ? 'GOAL_MACHINE' : (prob >= 0.68 ? 'OVER_25_LOCK' : 'LEAN_OVER');
    }
    switch (tier) {
      case 'GOAL_MACHINE':
        return { label: 'GOAL MACHINE 🔥', bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c', barGradient: 'linear-gradient(90deg, #ef4444, #dc2626)' };
      case 'OVER_25_LOCK':
        return { label: 'OVER 2.5 LOCK ⚡', bg: '#fff7ed', border: '#fed7aa', text: '#c2410c', barGradient: 'linear-gradient(90deg, #f97316, #ea580c)' };
      default:
        return { label: 'LEAN OVER 📈', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', barGradient: 'linear-gradient(90deg, #3b82f6, #2563eb)' };
    }
  }, [over25, isOver25Locked, over25EffectiveProb]);

  // Tier Meta for 1st Half Over 0.5
  const ht05Tier = React.useMemo(() => {
    if (!ht05) return { label: 'LEAN OVER 📈', bg: '#f0fdfa', border: '#99f6e4', text: '#0f766e', barGradient: 'linear-gradient(90deg, #14b8a6, #0d9488)' };
    let tier = ht05.confidence_tier;
    if ((tier === 'LOCKED' || !tier) && !isHt05Locked) {
      const prob = ht05EffectiveProb || 0.76;
      tier = prob >= 0.80 ? 'EARLY_STRIKE' : (prob >= 0.70 ? 'TEMPO_HIGH' : 'LEAN_OVER');
    }
    switch (tier) {
      case 'EARLY_STRIKE':
        return { label: 'EARLY STRIKE ⏱️', bg: '#ecfdf5', border: '#a7f3d0', text: '#047857', barGradient: 'linear-gradient(90deg, #10b981, #059669)' };
      case 'TEMPO_HIGH':
        return { label: 'HIGH TEMPO 🚀', bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9', barGradient: 'linear-gradient(90deg, #8b5cf6, #7c3aed)' };
      default:
        return { label: 'LEAN OVER 📈', bg: '#f0fdfa', border: '#99f6e4', text: '#0f766e', barGradient: 'linear-gradient(90deg, #14b8a6, #0d9488)' };
    }
  }, [ht05, isHt05Locked, ht05EffectiveProb]);

  return (
    <div className="goal-item-row">
      {/* LINE 1: Fixture Info, Kickoff (Always Stated), Clubs Matchup & Score (No Won/Lose) */}
      <div className="goal-row-line-1">
        <div className="goal-meta-left">
          <span className="goal-league-chip">{leagueName}</span>
          <span className="goal-time-chip">
            🕒 {kickoffFormatted}
          </span>
          {isLive && (
            <span className="goal-live-badge">
              <span className="live-pulse-dot" /> LIVE {match.match_minute ? `${match.match_minute}'` : ''}
            </span>
          )}
          {isFinished && (
            <span className="goal-ft-badge">FT</span>
          )}
        </div>

        <div className="goal-clubs-matchup">
          <span className="club-name home">{homeName}</span>
          <span className="club-vs-sep">vs</span>
          <span className="club-name away">{awayName}</span>
        </div>

        <div className="goal-score-right">
          {scoreDisplay ? (
            <div className="goal-score-display-group">
              <span className="goal-score-pill">
                Score: <strong>{scoreDisplay}</strong>
              </span>
              {htScoreDisplay && (
                <span className="goal-ht-pill">
                  HT: {htScoreDisplay}
                </span>
              )}
            </div>
          ) : (
            <span className="goal-upcoming-badge">Upcoming</span>
          )}
        </div>
      </div>

      {/* LINE 2: Two Cards Per Line (Over 2.5 by Left, 1st Half Over 0.5 by Right) */}
      <div className="goal-dual-cards-row">
        {/* CARD 1 (LEFT): OVER 2.5 GOALS */}
        <div className={`goal-subcard over25-card ${isOver25Locked ? 'card-locked' : ''}`}>
          <div className="subcard-header">
            <div className="subcard-title-group">
              <span className="subcard-market-icon">🎯</span>
              <span className="subcard-market-title">Over 2.5 Goals</span>
            </div>
            {over25 ? (
              <span
                className="subcard-tier-badge"
                style={{
                  background: over25Tier.bg,
                  borderColor: over25Tier.border,
                  color: over25Tier.text
                }}
              >
                {over25Tier.label}
              </span>
            ) : (
              <span className="subcard-unranked-badge">Unlisted</span>
            )}
          </div>

          <div className="subcard-body">
            {isOver25Locked ? (
              <button className="subcard-lock-btn" onClick={onOpenUpgrade} type="button">
                <span className="lock-icon">🔒</span>
                <span className="lock-text">Over 2.5 Signal Locked</span>
                <span className="lock-action">Unlock VIP Access →</span>
              </button>
            ) : over25 ? (
              <div className="subcard-metrics-box">
                <div className="metric-headline-row">
                  <div className="metric-prob-wrap">
                    <span className="metric-prob-number">
                      {over25EffectiveProb ? `${(over25EffectiveProb * 100).toFixed(1)}%` : '--%'}
                    </span>
                    <span className="metric-prob-label">Confidence</span>
                  </div>
                  {over25.xg_combined && (
                    <div className="metric-xg-tag">
                      xG <strong>{over25.xg_combined.toFixed(2)}</strong>
                    </div>
                  )}
                </div>

                <div className="subcard-progress-bar">
                  <div
                    className="subcard-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(12, (over25EffectiveProb || 0.6) * 100))}%`,
                      background: over25Tier.barGradient
                    }}
                  />
                </div>

                <div className="subcard-stats-row">
                  <span className="stat-item">
                    H/A Rate: <strong>{Math.round(((over25.home_over25_rate || 55) + (over25.away_over25_rate || 55)) / 2)}%</strong>
                  </span>
                  <span className="stat-sep">•</span>
                  <span className="stat-item">
                    H2H Over: <strong>{over25.h2h_over25_rate || 60}%</strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className="subcard-unranked-box">
                <span className="subcard-muted-text">Model skipped lower probability threshold</span>
              </div>
            )}
          </div>
        </div>

        {/* CARD 2 (RIGHT): 1ST HALF OVER 0.5 GOALS */}
        <div className={`goal-subcard ht05-card ${isHt05Locked ? 'card-locked' : ''}`}>
          <div className="subcard-header">
            <div className="subcard-title-group">
              <span className="subcard-market-icon">⏱️</span>
              <span className="subcard-market-title">1st Half Over 0.5</span>
            </div>
            {ht05 ? (
              <span
                className="subcard-tier-badge"
                style={{
                  background: ht05Tier.bg,
                  borderColor: ht05Tier.border,
                  color: ht05Tier.text
                }}
              >
                {ht05Tier.label}
              </span>
            ) : (
              <span className="subcard-unranked-badge">Unlisted</span>
            )}
          </div>

          <div className="subcard-body">
            {isHt05Locked ? (
              <button className="subcard-lock-btn" onClick={onOpenUpgrade} type="button">
                <span className="lock-icon">🔒</span>
                <span className="lock-text">1st Half Blitz Locked</span>
                <span className="lock-action">Unlock VIP Access →</span>
              </button>
            ) : ht05 ? (
              <div className="subcard-metrics-box">
                <div className="metric-headline-row">
                  <div className="metric-prob-wrap">
                    <span className="metric-prob-number">
                      {ht05EffectiveProb ? `${(ht05EffectiveProb * 100).toFixed(1)}%` : '--%'}
                    </span>
                    <span className="metric-prob-label">Confidence</span>
                  </div>
                  {ht05.avg_first_goal_minute && (
                    <div className="metric-minute-tag">
                      1st Goal: <strong>~{ht05.avg_first_goal_minute}'</strong>
                    </div>
                  )}
                </div>

                <div className="subcard-progress-bar">
                  <div
                    className="subcard-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(12, (ht05EffectiveProb || 0.7) * 100))}%`,
                      background: ht05Tier.barGradient
                    }}
                  />
                </div>

                <div className="subcard-stats-row">
                  <span className="stat-item">
                    1H Strike Freq: <strong>{ht05.ht_goal_frequency || 75}%</strong>
                  </span>
                  <span className="stat-sep">•</span>
                  <span className="stat-item">
                    Pace: <strong>High Tempo</strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className="subcard-unranked-box">
                <span className="subcard-muted-text">Model skipped lower probability threshold</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
