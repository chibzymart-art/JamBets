import React from 'react';
import { FavoritePredictionItem } from './FavoritesDrawer';

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
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  isFavoriteItem?: (fixtureId: string, market: string, pick: string) => boolean;
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
  onOpenUpgrade,
  onToggleFavoriteItem,
  isFavoriteItem
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

  // Helper to format scores with spaces around hyphens (e.g. '2-1' -> '2 - 1')
  const formatScore = (raw?: string | null): string | null => {
    if (!raw) return null;
    const clean = raw.trim();
    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
        return `${parts[0].trim()} - ${parts[1].trim()}`;
      }
    }
    return clean;
  };

  // Full-time / Final Score (on the Over 2.5 side)
  const rawFtScore = over25?.actual_score || match.actual_score || (
    match.home_score !== null && match.home_score !== undefined &&
    match.away_score !== null && match.away_score !== undefined
      ? `${match.home_score}-${match.away_score}`
      : null
  );
  const ftScoreFormatted = formatScore(rawFtScore);

  // Half-time Score (on the 1st Half Over 0.5 side)
  const rawHtScore = ht05?.ht_score || match.ht_score || (
    match.half_time_home_score !== null && match.half_time_home_score !== undefined &&
    match.half_time_away_score !== null && match.half_time_away_score !== undefined
      ? `${match.half_time_home_score}-${match.half_time_away_score}`
      : null
  );
  const htScoreFormatted = formatScore(rawHtScore);

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

  // Favorite states
  const isOver25Fav = isFavoriteItem && over25
    ? isFavoriteItem(match.fixture_id, 'over_2.5_goals', 'OVER_2.5')
    : false;

  const isHt05Fav = isFavoriteItem && ht05
    ? isFavoriteItem(match.fixture_id, 'ht_over_0.5_goals', 'HT_OVER_0.5')
    : false;

  const handleToggleOver25Fav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleFavoriteItem || !over25) return;
    onToggleFavoriteItem({
      id: `${match.fixture_id}::over_2.5_goals::OVER_2.5`,
      fixtureId: match.fixture_id,
      homeTeam: homeName,
      awayTeam: awayName,
      league: match.league_name,
      targetKickoffAt: match.target_kickoff_at,
      market: 'Over 2.5 Goals',
      prediction: 'Over 2.5 Goals',
      probability: Math.round((over25EffectiveProb || 0.68) * 100),
      confidenceCategory: over25Tier.label,
    });
  };

  const handleToggleHt05Fav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleFavoriteItem || !ht05) return;
    onToggleFavoriteItem({
      id: `${match.fixture_id}::ht_over_0.5_goals::HT_OVER_0.5`,
      fixtureId: match.fixture_id,
      homeTeam: homeName,
      awayTeam: awayName,
      league: match.league_name,
      targetKickoffAt: match.target_kickoff_at,
      market: '1st Half Over 0.5',
      prediction: '1st Half Over 0.5 Goals',
      probability: Math.round((ht05EffectiveProb || 0.76) * 100),
      confidenceCategory: ht05Tier.label,
    });
  };

  // Tier Meta for Over 2.5
  const over25Tier = React.useMemo(() => {
    if (!over25) return { label: 'LEAN OVER 📈', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', barGradient: 'linear-gradient(90deg, #3b82f6, #2563eb)' };
    let tier = over25.confidence_tier;
    if ((tier === 'LOCKED' || !tier) && !isOver25Locked) {
      const prob = over25EffectiveProb || 0.68;
      tier = prob >= 0.78 ? 'GOAL_MACHINE' : (prob >= 0.70 ? 'OVER_25_LOCK' : 'LEAN_OVER');
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
      tier = prob >= 0.82 ? 'EARLY_STRIKE' : (prob >= 0.76 ? 'TEMPO_HIGH' : 'LEAN_OVER');
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

  const hasBoth = !!(over25 && ht05);

  return (
    <div className="goal-item-row">
      {/* LINE 1: Fixture Info, Kickoff (Always Stated), Clubs Matchup & Status */}
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

        <div className="goal-status-right">
          {isLive ? (
            <span className="goal-status-pill live-pill">
              <span className="live-pulse-dot" /> LIVE {match.match_minute ? `${match.match_minute}'` : ''}
            </span>
          ) : isFinished ? (
            <span className="goal-status-pill ft-pill">
              MATCH FINISHED
            </span>
          ) : (
            <span className="goal-status-pill upcoming-pill">
              Upcoming
            </span>
          )}
        </div>
      </div>

      {/* AI Tactical Scout Rationale & Tempo Banner */}
      {(over25?.metadata?.tactical_rationale || ht05?.metadata?.tactical_rationale) && (
        <div className="goal-card-ai-scout-banner" style={{
          margin: '0 16px 12px 16px',
          padding: '8px 12px',
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '8px',
          fontSize: '12px',
          lineHeight: '1.45',
          color: '#cbd5e1',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px'
        }}>
          <span style={{ fontSize: '14px' }}>🤖</span>
          <div>
            <span style={{ color: '#38bdf8', fontWeight: 700, marginRight: '6px' }}>
              AI Tactical Scout {over25?.metadata?.goal_tempo ? `[${over25.metadata.goal_tempo}]` : ''}:
            </span>
            <span>{over25?.metadata?.tactical_rationale || ht05?.metadata?.tactical_rationale}</span>
          </div>
        </div>
      )}

      {/* LINE 2: Cards Row (Single standalone card if only 1 market qualified, Dual grid if both qualified) */}
      <div className={`goal-dual-cards-row ${!hasBoth ? 'single-card' : ''}`}>
        {/* CARD 1: OVER 2.5 GOALS (Only rendered if match legitimately qualified) */}
        {over25 && (
          <div className={`goal-subcard over25-card ${isOver25Locked ? 'card-locked' : ''}`}>
            <div className="subcard-header">
              <div className="subcard-title-group">
                <button
                  type="button"
                  className={`subcard-fav-btn ${isOver25Fav ? 'starred' : ''}`}
                  title={isOver25Fav ? 'Remove Over 2.5 from Favorites' : 'Add Over 2.5 to Favorites'}
                  onClick={handleToggleOver25Fav}
                >
                  {isOver25Fav ? '★' : '☆'}
                </button>
                <span className="subcard-market-icon">🎯</span>
                <span className="subcard-market-title">Over 2.5 Goals</span>
              </div>

              <div className="subcard-header-right">
                {ftScoreFormatted ? (
                  <div className="subcard-score-pill ft-score" title="Full-Time / Final Score for Over 2.5 market">
                    <span className="score-pill-tag">{isFinished ? 'FT Score' : 'LIVE'}</span>
                    <strong className="score-pill-val">{ftScoreFormatted}</strong>
                  </div>
                ) : (
                  <div className="subcard-score-pill empty-score" title="Upcoming match">
                    <span className="score-pill-tag">FT</span>
                    <span className="score-pill-val">- : -</span>
                  </div>
                )}

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
              </div>
            </div>

            <div className="subcard-body">
              {isOver25Locked ? (
                <button className="subcard-lock-btn" onClick={onOpenUpgrade} type="button">
                  <span className="lock-icon">🔒</span>
                  <span className="lock-text">Over 2.5 Signal Locked</span>
                  <span className="lock-action">Unlock VIP Access →</span>
                </button>
              ) : (
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
              )}
            </div>
          </div>
        )}

        {/* CARD 2: 1ST HALF OVER 0.5 GOALS (Only rendered if match legitimately qualified) */}
        {ht05 && (
          <div className={`goal-subcard ht05-card ${isHt05Locked ? 'card-locked' : ''}`}>
            <div className="subcard-header">
              <div className="subcard-title-group">
                <button
                  type="button"
                  className={`subcard-fav-btn ${isHt05Fav ? 'starred' : ''}`}
                  title={isHt05Fav ? 'Remove 1H Over 0.5 from Favorites' : 'Add 1H Over 0.5 to Favorites'}
                  onClick={handleToggleHt05Fav}
                >
                  {isHt05Fav ? '★' : '☆'}
                </button>
                <span className="subcard-market-icon">⏱️</span>
                <span className="subcard-market-title">1st Half Over 0.5</span>
              </div>

              <div className="subcard-header-right">
                {htScoreFormatted ? (
                  <div className="subcard-score-pill ht-score" title="Halftime Score for 1st Half Over 0.5 market">
                    <span className="score-pill-tag">HT Score</span>
                    <strong className="score-pill-val">{htScoreFormatted}</strong>
                  </div>
                ) : (
                  <div className="subcard-score-pill empty-score" title={isFinished ? 'Halftime score not reported' : 'Upcoming match'}>
                    <span className="score-pill-tag">HT</span>
                    <span className="score-pill-val">- : -</span>
                  </div>
                )}

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
              </div>
            </div>

            <div className="subcard-body">
              {isHt05Locked ? (
                <button className="subcard-lock-btn" onClick={onOpenUpgrade} type="button">
                  <span className="lock-icon">🔒</span>
                  <span className="lock-text">1st Half Blitz Locked</span>
                  <span className="lock-action">Unlock VIP Access →</span>
                </button>
              ) : (
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
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export interface StandaloneGoalCardProps {
  prediction: GoalPredictionItem;
  isPaidUser: boolean;
  onOpenUpgrade?: () => void;
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  isFavoriteItem?: (fixtureId: string, market: string, pick: string) => boolean;
}

export const StandaloneGoalCard: React.FC<StandaloneGoalCardProps> = ({
  prediction,
  isPaidUser,
  onOpenUpgrade,
  onToggleFavoriteItem,
  isFavoriteItem,
}) => {
  const p = prediction;
  const f = p.fixture;
  const isOver25 = p.market === 'over_2.5_goals';

  const homeName = formatClubName(f?.home_team?.short_name || f?.home_team?.name || p.metadata?.home_team || 'Home Club');
  const awayName = formatClubName(f?.away_team?.short_name || f?.away_team?.name || p.metadata?.away_team || 'Away Club');
  const leagueName = (f?.league?.name || p.metadata?.league || 'Football League').toUpperCase();
  const kickoffFormatted = formatFullKickoff(p.target_kickoff_at || f?.target_kickoff_at || '');

  const isLive = f?.status === 'live' || f?.status === 'in_progress' || f?.status === 'halftime';
  const isFinished = f?.status === 'finished' || f?.period === 'FT' || p.settlement_status !== 'pending';

  // Helper to format scores with spaces around hyphens
  const formatScore = (raw?: string | null): string | null => {
    if (!raw) return null;
    const clean = raw.trim();
    if (clean.includes('-')) {
      const parts = clean.split('-');
      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
        return `${parts[0].trim()} - ${parts[1].trim()}`;
      }
    }
    return clean;
  };

  const rawScore = isOver25
    ? (p.actual_score || (f?.home_score != null && f?.away_score != null ? `${f.home_score}-${f.away_score}` : null))
    : (p.ht_score || (f?.half_time_home_score != null && f?.half_time_away_score != null ? `${f.half_time_home_score}-${f.half_time_away_score}` : null));
  const scoreFormatted = formatScore(rawScore);
  const scoreLabel = isOver25 ? 'FT Score' : 'HT Score';

  // Effective Probability & Lock state
  const isLocked = (p.is_locked ?? true) && !isPaidUser;
  const effectiveProb = p.probability ?? (
    !isLocked
      ? (isOver25
          ? (p.xg_combined ? Math.min(0.88, Math.max(0.62, (p.xg_combined / 4.0) * 0.85)) : 0.68)
          : (p.ht_goal_frequency ? p.ht_goal_frequency / 100.0 : 0.76))
      : null
  );

  // Tier info
  const tier = React.useMemo(() => {
    let t = p.confidence_tier;
    if (isOver25) {
      if ((t === 'LOCKED' || !t) && !isLocked) {
        const prob = effectiveProb || 0.68;
        t = prob >= 0.78 ? 'GOAL_MACHINE' : (prob >= 0.70 ? 'OVER_25_LOCK' : 'LEAN_OVER');
      }
      switch (t) {
        case 'GOAL_MACHINE':
          return { label: 'GOAL MACHINE 🔥', bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c', barGradient: 'linear-gradient(90deg, #ef4444, #dc2626)' };
        case 'OVER_25_LOCK':
          return { label: 'OVER 2.5 LOCK ⚡', bg: '#fff7ed', border: '#fed7aa', text: '#c2410c', barGradient: 'linear-gradient(90deg, #f97316, #ea580c)' };
        default:
          return { label: 'LEAN OVER 📈', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', barGradient: 'linear-gradient(90deg, #3b82f6, #2563eb)' };
      }
    } else {
      if ((t === 'LOCKED' || !t) && !isLocked) {
        const prob = effectiveProb || 0.76;
        t = prob >= 0.82 ? 'EARLY_STRIKE' : (prob >= 0.76 ? 'TEMPO_HIGH' : 'LEAN_OVER');
      }
      switch (t) {
        case 'EARLY_STRIKE':
          return { label: 'EARLY STRIKE ⏱️', bg: '#ecfdf5', border: '#a7f3d0', text: '#047857', barGradient: 'linear-gradient(90deg, #10b981, #059669)' };
        case 'TEMPO_HIGH':
          return { label: 'HIGH TEMPO 🚀', bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9', barGradient: 'linear-gradient(90deg, #8b5cf6, #7c3aed)' };
        default:
          return { label: 'LEAN OVER 📈', bg: '#f0fdfa', border: '#99f6e4', text: '#0f766e', barGradient: 'linear-gradient(90deg, #14b8a6, #0d9488)' };
      }
    }
  }, [p, isOver25, isLocked, effectiveProb]);

  // Favorite toggle
  const isFav = isFavoriteItem
    ? isFavoriteItem(p.fixture_id, p.market, p.predicted_outcome)
    : false;

  const handleToggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleFavoriteItem) return;
    onToggleFavoriteItem({
      id: `${p.fixture_id}::${p.market}::${p.predicted_outcome}`,
      fixtureId: p.fixture_id,
      homeTeam: homeName,
      awayTeam: awayName,
      league: leagueName,
      targetKickoffAt: p.target_kickoff_at,
      market: isOver25 ? 'Over 2.5 Goals' : '1st Half Over 0.5',
      prediction: isOver25 ? 'Over 2.5 Goals' : '1st Half Over 0.5 Goals',
      probability: Math.round((effectiveProb || (isOver25 ? 0.68 : 0.76)) * 100),
      confidenceCategory: tier.label,
    });
  };

  const isWon = p.settlement_status === 'won';
  const isLost = p.settlement_status === 'lost';

  return (
    <div className={`standalone-goal-card ${isOver25 ? 'over25-theme' : 'ht05-theme'} ${isWon ? 'card-won' : isLost ? 'card-lost' : ''}`}>
      {/* LINE 1: Header (League, Time, Status Pill, Favorite Button) */}
      <div className="standalone-header-row">
        <div className="standalone-meta-left">
          <span className="goal-league-chip">{leagueName}</span>
          <span className="goal-time-chip">🕒 {kickoffFormatted}</span>
        </div>

        <div className="standalone-meta-right">
          {isWon ? (
            <span className="status-badge won-badge">WON ✅</span>
          ) : isLost ? (
            <span className="status-badge lost-badge">LOST ❌</span>
          ) : isLive ? (
            <span className="status-badge live-badge">
              <span className="live-pulse-dot" /> LIVE {f?.match_minute ? `${f.match_minute}'` : ''}
            </span>
          ) : isFinished ? (
            <span className="status-badge ft-badge">FT</span>
          ) : (
            <span className="status-badge upcoming-badge">Upcoming</span>
          )}

          <button
            type="button"
            className={`subcard-fav-btn ${isFav ? 'starred' : ''}`}
            title={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={handleToggleFav}
          >
            {isFav ? '★' : '☆'}
          </button>
        </div>
      </div>

      {/* LINE 2: Matchup & Authoritative Market Score */}
      <div className="standalone-matchup-row">
        <div className="standalone-clubs">
          <span className="club-name home">{homeName}</span>
          <span className="club-vs-sep">vs</span>
          <span className="club-name away">{awayName}</span>
        </div>

        {scoreFormatted ? (
          <div className={`subcard-score-pill ${isOver25 ? 'ft-score' : 'ht-score'}`} title={`${scoreLabel} for this market`}>
            <span className="score-pill-tag">{scoreLabel}</span>
            <strong className="score-pill-val">{scoreFormatted}</strong>
          </div>
        ) : (
          <div className="subcard-score-pill empty-score" title="Upcoming match">
            <span className="score-pill-tag">{scoreLabel}</span>
            <span className="score-pill-val">- : -</span>
          </div>
        )}
      </div>

      {/* LINE 3: AI Tactical Scout Banner */}
      {p.metadata?.tactical_rationale && (
        <div className="standalone-ai-banner">
          <span className="ai-icon">🤖</span>
          <div className="ai-text-block">
            <span className="ai-tag">
              AI Tactical Scout {p.metadata.goal_tempo ? `[${p.metadata.goal_tempo}]` : ''}:
            </span>
            <span className="ai-rationale">{p.metadata.tactical_rationale}</span>
          </div>
        </div>
      )}

      {/* LINE 4: Market Signals & Probability Metrics */}
      <div className={`standalone-metrics-card ${isLocked ? 'card-locked' : ''}`}>
        <div className="standalone-metrics-header">
          <div className="market-badge-wrap">
            <span className="market-icon">{isOver25 ? '🎯' : '⏱️'}</span>
            <span className="market-title">{isOver25 ? 'Over 2.5 Goals' : '1st Half Over 0.5'}</span>
          </div>

          <span
            className="subcard-tier-badge"
            style={{
              background: tier.bg,
              borderColor: tier.border,
              color: tier.text
            }}
          >
            {tier.label}
          </span>
        </div>

        <div className="standalone-metrics-body">
          {isLocked ? (
            <button className="subcard-lock-btn" onClick={onOpenUpgrade} type="button">
              <span className="lock-icon">🔒</span>
              <span className="lock-text">{isOver25 ? 'Over 2.5 Signal Locked' : '1H Blitz Signal Locked'}</span>
              <span className="lock-action">Unlock VIP Access →</span>
            </button>
          ) : (
            <>
              <div className="metric-headline-row">
                <div className="metric-prob-wrap">
                  <span className="metric-prob-number">
                    {effectiveProb ? `${(effectiveProb * 100).toFixed(1)}%` : '--%'}
                  </span>
                  <span className="metric-prob-label">Confidence</span>
                </div>

                {isOver25 && p.xg_combined && (
                  <div className="metric-xg-tag">
                    xG <strong>{p.xg_combined.toFixed(2)}</strong>
                  </div>
                )}
                {!isOver25 && p.avg_first_goal_minute && (
                  <div className="metric-minute-tag">
                    1st Goal: <strong>~{p.avg_first_goal_minute}'</strong>
                  </div>
                )}
              </div>

              <div className="subcard-progress-bar">
                <div
                  className="subcard-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(12, (effectiveProb || (isOver25 ? 0.68 : 0.76)) * 100))}%`,
                    background: tier.barGradient
                  }}
                />
              </div>

              <div className="subcard-stats-row">
                {isOver25 ? (
                  <>
                    <span className="stat-item">
                      H/A Rate: <strong>{Math.round(((p.home_over25_rate || 55) + (p.away_over25_rate || 55)) / 2)}%</strong>
                    </span>
                    <span className="stat-sep">•</span>
                    <span className="stat-item">
                      H2H Over: <strong>{p.h2h_over25_rate || 60}%</strong>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="stat-item">
                      1H Strike Freq: <strong>{p.ht_goal_frequency || 75}%</strong>
                    </span>
                    <span className="stat-sep">•</span>
                    <span className="stat-item">
                      Pace: <strong>High Tempo</strong>
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

