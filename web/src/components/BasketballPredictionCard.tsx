/**
 * Oddsbanta — Autonomous Basketball Prediction Card
 * Phase 5: Precision Card Component with Dean Oliver Four Factors & 250k Monte Carlo
 */

import React, { useState } from 'react';
import { BasketballPrediction } from '../types/basketball';
import { getTierConfig } from './FixtureCard';
import { FavoritePredictionItem } from './FavoritesDrawer';

export interface BasketballPredictionCardProps {
  prediction: BasketballPrediction;
  isSubscriber: boolean;
  isAdmin?: boolean;
  canViewPredictions?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (item: FavoritePredictionItem) => void;
  onOpenUpgrade?: () => void;
  onOpenAuth?: (mode: 'signin' | 'register') => void;
}

export const BasketballPredictionCard: React.FC<BasketballPredictionCardProps> = ({
  prediction,
  isSubscriber,
  isAdmin = false,
  canViewPredictions = false,
  isFavorite = false,
  onToggleFavorite,
  onOpenUpgrade,
  onOpenAuth,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { fixture, is_locked } = prediction;
  const league = fixture?.league;
  const homeTeam = fixture?.home_team;
  const awayTeam = fixture?.away_team;

  const isFinished = fixture?.status === 'finished';
  const isLive = fixture?.status === 'live';
  const isWon = prediction.settlement_status === 'won';
  const isLost = prediction.settlement_status === 'lost';
  const isVoid = prediction.settlement_status === 'void';

  // Entitlement: Admins, paid subscribers, or settled/finished matches are unlocked
  const isUserEntitled = Boolean(isAdmin || canViewPredictions || isSubscriber);
  const isLocked = !isUserEntitled && (is_locked || !(isWon || isLost || isVoid || isFinished));

  // Kickoff formatting in Lagos WAT (UTC+1)
  const kickoffDate = new Date(prediction.target_kickoff_at || fixture?.target_kickoff_at || Date.now());
  const formattedDateTime = kickoffDate.toLocaleDateString('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }) + ', ' + kickoffDate.toLocaleTimeString('en-US', {
    timeZone: 'Africa/Lagos',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Confidence Tier Configuration
  const effectiveCategory = isLocked ? 'LOCKED' : (prediction.confidence_category || 'TOP PICK');
  const tierConfig = getTierConfig(effectiveCategory);
  const cleanTierLabel = (tierConfig.label || '').replace(/\s*\([^)]*\)/g, '').trim();

  const probPct = prediction.probability != null
    ? ((prediction.probability <= 1 ? prediction.probability * 100 : prediction.probability)).toFixed(1)
    : null;

  const homeName = homeTeam?.canonical_name || 'Home Team';
  const awayName = awayTeam?.canonical_name || 'Away Team';
  const leagueCode = league?.code || 'NBA';
  const leagueName = league?.name || 'Basketball';

  // Four Factors Data
  const homeFF = homeTeam?.four_factors || { efg_pct: 0.535, tov_pct: 0.125, orb_pct: 0.250, ftr: 0.220 };
  const awayFF = awayTeam?.four_factors || { efg_pct: 0.535, tov_pct: 0.125, orb_pct: 0.250, ftr: 0.220 };

  const simulation = prediction.metadata?.simulation;
  const expectedPace = simulation?.expected_pace || (league?.default_pace || 99.5);
  const altitudeBonus = homeTeam?.altitude_ft && homeTeam.altitude_ft >= 4000;

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleFavorite) return;
    const favoriteItem: FavoritePredictionItem = {
      id: `${prediction.fixture_id}::${prediction.market || 'Spread'}::${prediction.prediction}`,
      fixtureId: prediction.fixture_id,
      homeTeam: homeName,
      awayTeam: awayName,
      league: `${leagueName} (${leagueCode})`,
      targetKickoffAt: prediction.target_kickoff_at || fixture?.target_kickoff_at || new Date().toISOString(),
      market: prediction.market === 'point_spread' ? 'Point Spread' : prediction.market === 'game_total_over_under' ? 'Game Totals' : 'Moneyline',
      prediction: prediction.prediction,
      probability: (probPct ? Number(probPct) / 100 : prediction.probability) || 0.72,
      confidenceCategory: prediction.confidence_category,
    };
    onToggleFavorite(favoriteItem);
  };

  return (
    <div
      id={`bball-fixture-${prediction.id}`}
      className={`bball-card ${isWon ? 'card-won' : isLost ? 'card-lost' : isVoid ? 'card-void' : ''}`}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {/* 1. TOP META BAR */}
      <div className="bball-card-meta">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="bball-card-league-badge">
            🏀 {leagueCode}
          </span>
          <span className="bball-card-time">
            📅 {formattedDateTime}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {altitudeBonus && (
            <span className="bball-altitude-badge" title="Mile-High Altitude Advantage">
              🏔️ {homeTeam.city} (+{(simulation?.altitude_hca_bonus || 4.15).toFixed(1)} HCA)
            </span>
          )}
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
            ⚡ Pace: {expectedPace.toFixed(1)} Poss
          </span>
        </div>
      </div>

      {/* 2. MATCHUP TEAMS ROW */}
      <div className="bball-matchup-row">
        {/* Home Team */}
        <div className="bball-team-col">
          {homeTeam?.logo_url ? (
            <img src={homeTeam.logo_url} alt={homeName} className="bball-team-logo" />
          ) : (
            <div className="bball-hero-icon-ring" style={{ width: 34, height: 34, fontSize: 16 }}>
              🏠
            </div>
          )}
          <div className="bball-team-info">
            <span className="bball-team-name">{homeName}</span>
            <div className="bball-team-tags">
              <span className="bball-rest-tag">
                {fixture?.home_rest_days != null ? `${fixture.home_rest_days}d Rest` : 'Normal Rest'}
              </span>
              {fixture?.is_home_b2b && (
                <span className="bball-b2b-tag">⚠️ B2B Game</span>
              )}
            </div>
          </div>
        </div>

        <span className="bball-vs-badge">VS</span>

        {/* Away Team */}
        <div className="bball-team-col away">
          <div className="bball-team-info">
            <span className="bball-team-name">{awayName}</span>
            <div className="bball-team-tags away">
              {fixture?.is_away_b2b && (
                <span className="bball-b2b-tag">⚠️ B2B Game</span>
              )}
              <span className="bball-rest-tag">
                {fixture?.away_rest_days != null ? `${fixture.away_rest_days}d Rest` : 'Normal Rest'}
              </span>
            </div>
          </div>
          {awayTeam?.logo_url ? (
            <img src={awayTeam.logo_url} alt={awayName} className="bball-team-logo" />
          ) : (
            <div className="bball-hero-icon-ring" style={{ width: 34, height: 34, fontSize: 16, background: '#1e293b' }}>
              ✈️
            </div>
          )}
        </div>
      </div>

      {/* 3. PRIMARY BANKER SELECTION BOX */}
      <div className="bball-banker-box">
        <div className="bball-banker-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="bball-market-label">
              {prediction.market === 'point_spread'
                ? '⭐ Primary Point Spread Banker'
                : prediction.market === 'game_total_over_under'
                ? '⭐ Primary Total Points Pick'
                : '⭐ Primary Moneyline Banker'}
            </span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 800,
                padding: '2px 6px',
                borderRadius: '4px',
                background: tierConfig.bgColor,
                color: tierConfig.textColor,
              }}
            >
              {cleanTierLabel}
            </span>
          </div>

          <div className="bball-prediction-text">
            {isLocked ? (
              <span style={{ color: '#94a3b8' }}>🔒 VIP Locked Prediction</span>
            ) : (
              <span>{prediction.prediction}</span>
            )}
          </div>
        </div>

        <div className="bball-banker-right">
          {isLocked ? (
            <button
              type="button"
              className="bball-add-slip-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenUpgrade ? onOpenUpgrade() : onOpenAuth ? onOpenAuth('signin') : null;
              }}
            >
              👑 Unlock Pick
            </button>
          ) : (
            <>
              {probPct && (
                <div className="bball-prob-pill">
                  <span>{probPct}%</span>
                  <span className="bball-prob-sub">Win Prob</span>
                </div>
              )}

              {prediction.edge_percentage != null && prediction.edge_percentage > 0 && (
                <div className="bball-edge-pill">
                  +{prediction.edge_percentage.toFixed(1)}% Edge
                </div>
              )}

              <button
                type="button"
                className={`bball-add-slip-btn ${isFavorite ? 'in-slip' : ''}`}
                onClick={handleFavoriteClick}
                title={isFavorite ? 'In Accumulator Slip' : 'Add to Accumulator Slip'}
              >
                {isFavorite ? '✓ In Slip' : '+ Add Slip'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 4. SETTLEMENT RESULT (IF SETTLED) */}
      {(isWon || isLost || isVoid) && (
        <div className={`bball-settled-bar ${isWon ? 'won' : isLost ? 'lost' : 'void'}`}>
          <span>
            {isWon ? '🏆 WON' : isLost ? '❌ LOST' : '⚖️ VOID (PUSH)'}: {prediction.actual_result || prediction.settlement_notes}
          </span>
          <span style={{ opacity: 0.8, fontSize: '11px' }}>
            Settled via JamBets Engine
          </span>
        </div>
      )}

      {/* 5. IN-PLAY SCORE (IF LIVE) */}
      {isLive && (
        <div style={{ background: '#7f1d1d', color: '#fecaca', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
            LIVE IN-PLAY: {homeName} {fixture?.home_score} - {fixture?.away_score} {awayName}
          </span>
          <span>{fixture?.current_period || 'LIVE'}</span>
        </div>
      )}

      {/* 6. EXPANDABLE 250,000 SIMULATION & FOUR FACTORS DRAWER */}
      {isExpanded && !isLocked && (
        <div className="bball-four-factors-wrap" onClick={(e) => e.stopPropagation()}>
          <div className="bball-ff-header">
            <span>Dean Oliver Four Factors Breakdown</span>
            <span style={{ color: '#94a3b8' }}>250k Monte Carlo Simulated Pace</span>
          </div>

          {/* eFG% */}
          <div className="bball-ff-label">Effective Field Goal % (eFG% — 40% Weight)</div>
          <div className="bball-ff-row">
            <span style={{ color: '#f97316', fontWeight: 700 }}>{(homeFF.efg_pct * 100).toFixed(1)}%</span>
            <div className="bball-ff-bar-wrap">
              <div className="bball-ff-bar-home" style={{ width: `${(homeFF.efg_pct / (homeFF.efg_pct + awayFF.efg_pct)) * 100}%` }} />
              <div className="bball-ff-bar-away" style={{ width: `${(awayFF.efg_pct / (homeFF.efg_pct + awayFF.efg_pct)) * 100}%` }} />
            </div>
            <span style={{ color: '#38bdf8', fontWeight: 700, textAlign: 'right' }}>{(awayFF.efg_pct * 100).toFixed(1)}%</span>
          </div>

          {/* TOV% */}
          <div className="bball-ff-label">Turnover % (TOV% — Lower is better — 25% Weight)</div>
          <div className="bball-ff-row">
            <span style={{ color: '#f97316', fontWeight: 700 }}>{(homeFF.tov_pct * 100).toFixed(1)}%</span>
            <div className="bball-ff-bar-wrap">
              <div className="bball-ff-bar-home" style={{ width: `${(homeFF.tov_pct / (homeFF.tov_pct + awayFF.tov_pct)) * 100}%` }} />
              <div className="bball-ff-bar-away" style={{ width: `${(awayFF.tov_pct / (homeFF.tov_pct + awayFF.tov_pct)) * 100}%` }} />
            </div>
            <span style={{ color: '#38bdf8', fontWeight: 700, textAlign: 'right' }}>{(awayFF.tov_pct * 100).toFixed(1)}%</span>
          </div>

          {/* ORB% */}
          <div className="bball-ff-label">Offensive Rebounding % (ORB% — 20% Weight)</div>
          <div className="bball-ff-row">
            <span style={{ color: '#f97316', fontWeight: 700 }}>{(homeFF.orb_pct * 100).toFixed(1)}%</span>
            <div className="bball-ff-bar-wrap">
              <div className="bball-ff-bar-home" style={{ width: `${(homeFF.orb_pct / (homeFF.orb_pct + awayFF.orb_pct)) * 100}%` }} />
              <div className="bball-ff-bar-away" style={{ width: `${(awayFF.orb_pct / (homeFF.orb_pct + awayFF.orb_pct)) * 100}%` }} />
            </div>
            <span style={{ color: '#38bdf8', fontWeight: 700, textAlign: 'right' }}>{(awayFF.orb_pct * 100).toFixed(1)}%</span>
          </div>

          {/* FTR */}
          <div className="bball-ff-label">Free Throw Rate (FTR — 15% Weight)</div>
          <div className="bball-ff-row">
            <span style={{ color: '#f97316', fontWeight: 700 }}>{(homeFF.ftr * 100).toFixed(1)}%</span>
            <div className="bball-ff-bar-wrap">
              <div className="bball-ff-bar-home" style={{ width: `${(homeFF.ftr / (homeFF.ftr + awayFF.ftr)) * 100}%` }} />
              <div className="bball-ff-bar-away" style={{ width: `${(awayFF.ftr / (homeFF.ftr + awayFF.ftr)) * 100}%` }} />
            </div>
            <span style={{ color: '#38bdf8', fontWeight: 700, textAlign: 'right' }}>{(awayFF.ftr * 100).toFixed(1)}%</span>
          </div>

          {/* Projected Score & Percentiles */}
          {prediction.simulated_home_score != null && prediction.simulated_away_score != null && (
            <div style={{ display: 'flex', justifyContent: 'space-around', background: 'rgba(255,255,255,0.04)', padding: '10px', borderRadius: '8px', marginTop: '12px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>250k Sim Home Score</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#f97316' }}>{prediction.simulated_home_score.toFixed(1)}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Projected Total</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>
                  {(prediction.simulated_home_score + prediction.simulated_away_score).toFixed(1)}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>250k Sim Away Score</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8' }}>{prediction.simulated_away_score.toFixed(1)}</div>
              </div>
            </div>
          )}

          {/* AI Tactical Analysis Narrative */}
          {prediction.metadata?.ai_tactical_analysis && (
            <div className="bball-tactical-box">
              <div className="bball-tactical-title">
                <span>🤖 AI Tactical Matchup Analysis</span>
              </div>
              <div>{prediction.metadata.ai_tactical_analysis}</div>
            </div>
          )}

          {/* Secondary Predictions Grid */}
          {prediction.secondary_predictions && prediction.secondary_predictions.length > 0 && (
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 }}>
                Secondary Market Leans
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {prediction.secondary_predictions.map((sp, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span style={{ color: '#f8fafc', fontWeight: 600 }}>{sp.pick}</span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>{(sp.probability * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accordion toggle prompt */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
          {isExpanded ? '▲ Hide Four Factors Breakdown' : '▼ View 250k Monte Carlo & Four Factors Breakdown'}
        </span>
      </div>
    </div>
  );
};
