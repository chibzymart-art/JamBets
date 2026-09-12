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
    home_team?: { name: string };
    away_team?: { name: string };
  };
}

interface GoalCardProps {
  prediction: GoalPredictionItem;
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
  'sion': 'FC Sion'
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

  const rawHome = f?.home_team?.name || f?.home_team_name || (prediction.metadata as any)?.home_team || 'Home Club';
  const rawAway = f?.away_team?.name || f?.away_team_name || (prediction.metadata as any)?.away_team || 'Away Club';
  const rawLeague = f?.league?.name || f?.league_name || (prediction.metadata as any)?.league || 'World Football';

  const homeName = formatClubName(rawHome);
  const awayName = formatClubName(rawAway);
  const leagueName = rawLeague.toUpperCase();

  const isLive = f?.status === 'live' || f?.status === 'in_progress' || f?.status === 'halftime';
  const isFinished = f?.status === 'finished' || f?.period === 'FT' || prediction.settlement_status !== 'pending';

  // Tier Color Config (Maintains all rankings)
  const tierMeta = React.useMemo(() => {
    let tier = prediction.confidence_tier;
    if ((tier === 'LOCKED' || !tier) && !isLocked) {
      const prob = prediction.probability || 0.70;
      tier = prob >= 0.80 ? (isOver25 ? 'GOAL_MACHINE' : 'EARLY_STRIKE') : (prob >= 0.70 ? (isOver25 ? 'OVER_25_LOCK' : 'TEMPO_HIGH') : 'LEAN_OVER');
    }

    switch (tier) {
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
  }, [prediction.confidence_tier, isLocked, prediction.probability, isOver25]);

  const effectiveProbability = prediction.probability ?? (
    !isLocked && prediction.xg_combined ? Math.min(0.88, Math.max(0.62, (prediction.xg_combined / 4.0) * 0.85)) : null
  );
  const probPercent = effectiveProbability ? `${(effectiveProbability * 100).toFixed(1)}%` : '--%';

  // Score display (no Won or Lose, just the score)
  const scoreDisplay = prediction.actual_score || (f && f.home_score !== null && f.home_score !== undefined && f.away_score !== null && f.away_score !== undefined ? `${f.home_score} - ${f.away_score}` : null);

  return (
    <div className={`goal-item-row ${isLocked ? 'goal-item-locked' : ''}`}>
      {/* LINE 1: Fixture Matchup, League & Time/Live/Score */}
      <div className="goal-row-line-1">
        <div className="goal-meta-left">
          <span className="goal-league-chip">{leagueName}</span>
          <span className="goal-time-chip">
            {isLive ? (
              <span className="goal-live-badge">
                <span className="live-pulse-dot" /> LIVE {f?.match_minute ? `${f.match_minute}'` : ''}
              </span>
            ) : isFinished ? (
              <span className="goal-ft-badge">FT</span>
            ) : (
              `🕒 ${kickoffStr} WAT`
            )}
          </span>
        </div>

        <div className="goal-clubs-matchup">
          <span className="club-name home">{homeName}</span>
          <span className="club-vs-sep">vs</span>
          <span className="club-name away">{awayName}</span>
        </div>

        <div className="goal-score-right">
          {scoreDisplay && (
            <span className="goal-score-pill">
              Score: <strong>{scoreDisplay}</strong>
            </span>
          )}
        </div>
      </div>

      {/* LINE 2: Market, Rating Ranking, Confidence %, and Settlement (Score Only) */}
      <div className="goal-row-line-2">
        <div className="goal-pred-left">
          <span className="goal-market-pill">
            {isOver25 ? '🎯 Over 2.5 Goals' : '⏱️ 1st Half Over 0.5'}
          </span>

          {isLocked ? (
            <span className="goal-locked-pill" onClick={onOpenUpgrade}>
              🔒 VIP Access Required • Tap to Unlock
            </span>
          ) : (
            <>
              <span className="goal-confidence-pill">
                <strong>{probPercent}</strong> Confidence
              </span>

              <span
                className="goal-tier-badge"
                style={{
                  background: tierMeta.bg,
                  borderColor: tierMeta.border,
                  color: tierMeta.text
                }}
              >
                {tierMeta.label}
              </span>

              {prediction.xg_combined && (
                <span className="goal-xg-pill">
                  xG {prediction.xg_combined.toFixed(2)}
                </span>
              )}
            </>
          )}
        </div>

        {/* Settlement: Just the score, NO won/lose */}
        {prediction.settlement_status !== 'pending' && (
          <div className="goal-settlement-inline">
            <span className="settlement-score-label">
              Result Score: <strong>{scoreDisplay || 'Awaiting Score'}</strong>
            </span>
            {prediction.ht_score && isOver25 && (
              <span className="settlement-ht-note">(HT: {prediction.ht_score})</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
