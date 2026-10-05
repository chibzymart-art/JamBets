/**
 * Oddsbanta — Autonomous Basketball Prediction Card
 * Phase 5: Precision Card Component with Dean Oliver Four Factors & 250k Monte Carlo
 * Dynamic Primary and Secondary Market Predictions (Strictly Deduplicated)
 */

import React, { useState, useMemo } from 'react';
import { BasketballPrediction } from '../types/basketball';
import { getTierConfig } from './FixtureCard';
import { FavoritePredictionItem } from './FavoritesDrawer';

export interface BasketballPredictionCardProps {
  prediction: BasketballPrediction;
  isSubscriber: boolean;
  isAdmin?: boolean;
  canViewPredictions?: boolean;
  isFavorite?: boolean;
  isFavoriteItem?: (fixtureId: string, market: string, pick: string) => boolean;
  onToggleFavorite?: (item: FavoritePredictionItem) => void;
  onOpenUpgrade?: () => void;
  onOpenAuth?: (mode: 'signin' | 'register') => void;
}

export const BasketballPredictionCard: React.FC<BasketballPredictionCardProps> = ({
  prediction,
  isSubscriber,
  isAdmin = false,
  canViewPredictions = false,
  isFavorite: isFavoriteProp = false,
  isFavoriteItem,
  onToggleFavorite,
  onOpenUpgrade,
  onOpenAuth,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { fixture } = prediction;
  const league = fixture?.league;
  const homeTeam = fixture?.home_team;
  const awayTeam = fixture?.away_team;

  const isFinished = fixture?.status === 'finished' || Boolean(prediction.settled_at);
  const isLive = fixture?.status === 'live';

  // Entitlement: Admins or entitled subscribers have full access
  const isUserEntitled = Boolean(isAdmin || canViewPredictions || isSubscriber);

  // Settlement indicators are strictly VIP-only
  const isWon = isUserEntitled && (prediction.settlement_status === 'won' || prediction.settlement_status === 'half_won');
  const isLost = isUserEntitled && (prediction.settlement_status === 'lost' || prediction.settlement_status === 'half_lost');
  const isVoid = isUserEntitled && ((prediction.settlement_status as string) === 'void' || (prediction.settlement_status as string) === 'voided');

  // Categorize tier: High Confidence, Top Picks, Bangers are strictly VIP tiers
  const cat = (prediction.confidence_category || '').toUpperCase().replace(/[\s-]+/g, '_');
  let prob = prediction.probability;
  if (prob != null && typeof prob === 'number' && prob > 1) prob = prob / 100;

  // Multi-Sport VIP Shield: All basketball predictions are locked teasers for visitors
  const isLocked = !isUserEntitled;

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
  const effectiveCategory = isLocked
    ? (prediction.confidence_category && prediction.confidence_category !== 'LOCKED' ? prediction.confidence_category : 'TOP PICK')
    : (prediction.confidence_category && prediction.confidence_category !== 'LOCKED' ? prediction.confidence_category : 'MID CONFIDENCE');
  const tierConfig = getTierConfig(effectiveCategory);
  const cleanTierLabel = (tierConfig.label || '').replace(/\s*\([^)]*\)/g, '').trim();

  const probPct = prediction.probability != null
    ? ((prediction.probability <= 1 ? prediction.probability * 100 : prediction.probability)).toFixed(1)
    : null;

  const homeName = homeTeam?.canonical_name || 'Home Team';
  const awayName = awayTeam?.canonical_name || 'Away Team';

  const displayedPrediction = isLocked
    ? '🔒 BigBang VIP Pick'
    : ((prediction.prediction?.includes('🔒') || prediction.prediction === 'LOCKED')
      ? (prediction.market === 'moneyline' ? `${homeName} Win` : `${homeName} +2.5`)
      : prediction.prediction);
  const leagueCode = league?.code || 'NBA';
  const leagueName = league?.name || 'Basketball';

  const isNoBanker =
    cat === 'NO_SAFE_BANKER' ||
    cat === 'NOSAFEBANKER' ||
    cat.includes('NO_SAFE') ||
    cat.includes('NOSAFE') ||
    (prediction.market || '').toUpperCase() === 'NO_SAFE_BANKER' ||
    (prediction.prediction || '').toUpperCase() === 'SKIP';

  const isSettledOrFinished = isFinished || Boolean(prediction.settled_at) || (Boolean(prediction.settlement_status) && prediction.settlement_status !== 'pending');

  const isSecondaryRedacted = !isUserEntitled && !isWon && isNoBanker && !isSettledOrFinished;

  // Strictly filter out primary market to guarantee non-duplication
  const displayedSecondaryPreds = useMemo(() => {
    if (isSecondaryRedacted || isLocked) return [];
    const list = prediction.secondary_predictions || [];
    let arr: any[] = [];
    if (Array.isArray(list)) {
      arr = list;
    } else if (typeof list === 'string') {
      try {
        arr = JSON.parse(list);
      } catch {
        arr = [];
      }
    }
    const primaryMarket = (prediction.market || '').toLowerCase();
    return arr.filter((sec: any) => {
      const secMarket = (sec.market || '').toLowerCase();
      return secMarket !== primaryMarket;
    });
  }, [prediction.secondary_predictions, prediction.market, isSecondaryRedacted, isLocked]);

  // Four Factors Data
  const homeFF = homeTeam?.four_factors || { efg_pct: 0.535, tov_pct: 0.125, orb_pct: 0.250, ftr: 0.220 };
  const awayFF = awayTeam?.four_factors || { efg_pct: 0.535, tov_pct: 0.125, orb_pct: 0.250, ftr: 0.220 };

  const simulation = prediction.metadata?.simulation;
  const expectedPace = simulation?.expected_pace || (league?.default_pace || 99.5);
  const altitudeBonus = homeTeam?.altitude_ft && homeTeam.altitude_ft >= 4000;

  const primaryMarketStandard = useMemo(() => {
    const m = (prediction.market || '').toLowerCase();
    if (m.includes('spread')) return 'Point Spread';
    if (m.includes('total') || m.includes('over') || m.includes('under')) return 'Game Totals';
    return 'Moneyline';
  }, [prediction.market]);

  const isFavorite = Boolean(
    isFavoriteItem
      ? isFavoriteItem(prediction.fixture_id, primaryMarketStandard, prediction.prediction)
      : isFavoriteProp
  );

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleFavorite) return;
    const favoriteItem: FavoritePredictionItem = {
      id: `${prediction.fixture_id}::${primaryMarketStandard}::${prediction.prediction}`,
      fixtureId: prediction.fixture_id,
      homeTeam: homeName,
      awayTeam: awayName,
      league: `${leagueName} (${leagueCode})`,
      targetKickoffAt: prediction.target_kickoff_at || fixture?.target_kickoff_at || new Date().toISOString(),
      market: primaryMarketStandard,
      prediction: prediction.prediction,
      probability: (probPct ? Number(probPct) / 100 : prediction.probability) || 0.72,
      confidenceCategory: prediction.confidence_category,
    };
    onToggleFavorite(favoriteItem);
  };

  const handleSecondaryFavoriteToggle = (
    e: React.MouseEvent,
    sec: any,
    secMarket: string,
    secPick: string,
    secProb: number | null
  ) => {
    e.stopPropagation();
    if (!onToggleFavorite) return;
    const favoriteItem: FavoritePredictionItem = {
      id: `${prediction.fixture_id}::${secMarket}::${secPick}`,
      fixtureId: prediction.fixture_id,
      homeTeam: homeName,
      awayTeam: awayName,
      league: `${leagueName} (${leagueCode})`,
      targetKickoffAt: prediction.target_kickoff_at || fixture?.target_kickoff_at || new Date().toISOString(),
      market: secMarket,
      prediction: secPick,
      probability: secProb != null ? secProb : 65,
      confidenceCategory: sec.tier || 'HIGH CONFIDENCE',
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
          {onToggleFavorite && (
            <button
              type="button"
              className={`glance-favorite-btn ${isFavorite ? 'starred' : ''}`}
              title={isFavorite ? 'Remove from Acca Slip' : 'Add to Acca Slip'}
              onClick={(e) => {
                e.stopPropagation();
                handleFavoriteClick(e);
              }}
            >
              {isFavorite ? '✓ IN SLIP' : '+ ADD TO SLIP'}
            </button>
          )}
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

      {/* 2.5 250k MONTE CARLO SIMULATED SCORELINE RIBBON */}
      {!isLocked && prediction.simulated_home_score != null && prediction.simulated_away_score != null && (
        <div
          style={{
            background: 'linear-gradient(90deg, #fff7ed 0%, #ffedd5 50%, #fff7ed 100%)',
            border: '1px solid #fed7aa',
            borderRadius: 7,
            padding: '4px 10px',
            margin: '4px 0 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 6,
            fontSize: '11px',
            color: '#7c2d12',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
            <span>📊 250k Sims Projected Score:</span>
            <span style={{ fontSize: '12.5px', fontWeight: 900, color: '#c2410c' }}>
              {prediction.simulated_home_score} - {prediction.simulated_away_score}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '10.5px', fontWeight: 700, color: '#9a3412' }}>
            <span>
              Margin: {(prediction.simulated_home_score - prediction.simulated_away_score > 0 ? '+' : '') + (prediction.simulated_home_score - prediction.simulated_away_score).toFixed(1)} pts
            </span>
            <span>•</span>
            <span>
              Total: {(prediction.simulated_home_score + prediction.simulated_away_score).toFixed(1)} pts
            </span>
          </div>
        </div>
      )}

      {/* 3. PRIMARY SUPER BANKER SELECTION BOX */}
      <div className={`bball-banker-box ${isWon ? 'box-won' : isLost ? 'box-lost' : isVoid ? 'box-void' : ''}`}>
        <div className="bball-banker-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 900,
                padding: '2px 7px',
                borderRadius: '4px',
                background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
                color: '#ffffff',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                boxShadow: '0 1px 3px rgba(234, 88, 12, 0.3)',
              }}
            >
              🔥 PRIMARY BANKER
            </span>
            <span className="bball-market-label">
              {prediction.market === 'point_spread'
                ? 'Point Spread (Handicap)'
                : prediction.market === 'game_total_over_under'
                ? 'Game Totals (Over/Under)'
                : 'Moneyline Winner'}
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

          <div className="bball-prediction-text" style={{ marginTop: 4 }}>
            {isLocked ? (
              <div>
                <span style={{ color: '#ea580c', fontWeight: 700 }}>🔒 BigBang VIP Pick</span>
                <div style={{ fontSize: 11, color: '#b45309', marginTop: 2, fontWeight: 500 }}>
                  250,000 Monte Carlo simulations &amp; Four Factors reserved for BigBang VIP.
                </div>
              </div>
            ) : (
              <span>{displayedPrediction}</span>
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
              👑 Unlock BigBang VIP (₦10,000/mo) →
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
                {isFavorite ? '✓ IN SLIP' : '+ ADD TO SLIP'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 3.5 DYNAMIC SECONDARY PREDICTIONS OR ANTI-LOSS VIP TEASER */}
      {isSecondaryRedacted ? (
        <div
          className="bball-anti-loss-teaser-box"
          style={{
            marginTop: 10,
            marginBottom: 12,
            padding: '14px 16px',
            background: 'linear-gradient(135deg, rgba(248, 250, 252, 0.98), rgba(241, 245, 249, 0.95))',
            border: '1.5px dashed #fed7aa',
            borderRadius: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>🔒</span>
              <span style={{ fontSize: 11.5, fontWeight: 900, color: '#9a3412', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                VIP Secondary Markets Detected
              </span>
            </div>
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              color: '#c2410c',
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              padding: '2px 8px',
              borderRadius: 9999,
              textTransform: 'uppercase',
            }}>
              Anti-Loss Toss-Up
            </span>
          </div>

          <p style={{ fontSize: 12, color: '#475569', lineHeight: 1.5, margin: '0 0 10px 0' }}>
            Moneyline is too volatile for a safe banker pick. Our engine identified <strong>qualifying derivative edges</strong> (Point Spread &amp; Game Totals). Upgrade to VIP to reveal all secondary basketball models.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, filter: 'blur(3.5px)', opacity: 0.65, userSelect: 'none', pointerEvents: 'none', marginBottom: 10 }}>
            <div style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #fed7aa' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#9a3412' }}>⚡ POINT SPREAD</div>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>+X.5 • 7X.X%</div>
            </div>
            <div style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #fed7aa' }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#9a3412' }}>📊 GAME TOTALS</div>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>Over 2XX.5 • 7X.X%</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
              ⚡ Instant access to basketball spreads &amp; totals
            </span>
            <button
              type="button"
              className="btn-paywall-unlock-prominent"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'linear-gradient(135deg, #f97316, #ea580c)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 11.5,
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(234, 88, 12, 0.25)',
              }}
              onClick={() => {
                if (onOpenUpgrade) onOpenUpgrade();
                else if (onOpenAuth) onOpenAuth('register');
              }}
            >
              ⚡ Unlock BigBang VIP (₦10,000/mo) →
            </button>
          </div>
        </div>
      ) : !isLocked && displayedSecondaryPreds.length > 0 ? (
        <div
          className="bball-secondary-section"
          style={{ marginTop: 10, marginBottom: 12 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
              ⚡ Secondary Market Leans
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8' }}>
              Distinct Derivative Markets
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 10 }}>
            {displayedSecondaryPreds.map((sec: any, idx: number) => {
              const secMarket = sec.market || 'Market';
              const displayMarketTitle = (() => {
                const m = secMarket.toLowerCase();
                if (m.includes('spread') || m.includes('point_spread')) return '⚡ Point Spread (Handicap)';
                if (m.includes('total') || m.includes('over')) return '📊 Total Points (Over/Under)';
                if (m.includes('moneyline') || m.includes('winner')) return '🏆 Moneyline Lean';
                return secMarket.replace(/_/g, ' ').toUpperCase();
              })();

              const marketName = (() => {
                const m = secMarket.toLowerCase();
                if (m.includes('spread')) return 'Point Spread';
                if (m.includes('total')) return 'Game Totals';
                return 'Moneyline';
              })();

              const isSecLocked = Boolean(isLocked || sec.locked || sec.probability == null || sec.probability === 0);
              const pickVal = isSecLocked ? '••••••••' : (sec.pick || sec.prediction || 'Pick');
              const probNum = sec.probability != null && sec.probability > 0
                ? Math.round(sec.probability <= 1 ? sec.probability * 100 : sec.probability)
                : null;

              const isSecFav = Boolean(
                isFavoriteItem ? isFavoriteItem(prediction.fixture_id, marketName, pickVal) : false
              );

              const secSettlement = (sec as any).settlement_status as string | undefined;
              const isSecWon = isUserEntitled && (secSettlement === 'won' || secSettlement === 'half_won');
              const isSecLost = isUserEntitled && (secSettlement === 'lost' || secSettlement === 'half_lost');
              const isSecVoid = isUserEntitled && (secSettlement === 'void' || secSettlement === 'voided');

              return (
                <div
                  key={idx}
                  className="bball-secondary-tile"
                  style={{
                    background: '#ffffff',
                    border: isSecFav ? '1.5px solid #10b981' : isSecWon ? '1.5px solid #86efac' : isSecLost ? '1.5px solid #fca5a5' : '1.5px solid #fed7aa',
                    borderRadius: 10,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: isSecFav ? '0 2px 8px rgba(16, 185, 129, 0.15)' : '0 1px 3px rgba(0, 0, 0, 0.03)',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: '#9a3412', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                      {displayMarketTitle}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isSecWon && (
                        <span style={{ fontSize: 9.5, fontWeight: 900, color: '#ffffff', background: '#16a34a', padding: '1px 6px', borderRadius: 4 }}>
                          ✓ WON
                        </span>
                      )}
                      {isSecLost && (
                        <span style={{ fontSize: 9.5, fontWeight: 900, color: '#ffffff', background: '#dc2626', padding: '1px 6px', borderRadius: 4 }}>
                          ✗ LOST
                        </span>
                      )}
                      {isSecVoid && (
                        <span style={{ fontSize: 9.5, fontWeight: 900, color: '#475569', background: '#e2e8f0', padding: '1px 6px', borderRadius: 4 }}>
                          ⊘ VOID
                        </span>
                      )}
                      {probNum != null ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: probNum >= 65 ? '#ecfdf5' : '#eff6ff', border: `1px solid ${probNum >= 65 ? '#a7f3d0' : '#bfdbfe'}`, padding: '1px 6px', borderRadius: 5 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 900, color: probNum >= 65 ? '#15803d' : '#1d4ed8' }}>
                            {probNum}%
                          </span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: probNum >= 65 ? '#166534' : '#1e40af' }}>
                            Prob
                          </span>
                        </div>
                      ) : isSecLocked ? (
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#d97706', background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>
                          🔒 Locked
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0f172a', wordBreak: 'break-word', whiteSpace: 'normal', flex: 1 }}>
                      {pickVal}
                    </div>

                    {onToggleFavorite && !isSecLocked && (
                      <button
                        type="button"
                        className={`bball-secondary-slip-btn ${isSecFav ? 'active' : ''}`}
                        onClick={(e) => handleSecondaryFavoriteToggle(e, sec, marketName, pickVal, probNum)}
                        title={isSecFav ? 'In Accumulator Slip' : 'Add to Accumulator Slip'}
                        style={{
                          background: isSecFav ? '#10b981' : '#ffffff',
                          color: isSecFav ? '#ffffff' : '#ea580c',
                          border: isSecFav ? '1px solid #10b981' : '1px solid #ea580c',
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: '10.5px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {isSecFav ? '✓ IN SLIP' : '+ ADD TO SLIP'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

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
        <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
            LIVE IN-PLAY: {homeName} {fixture?.home_score} - {fixture?.away_score} {awayName}
          </span>
          <span>{fixture?.current_period || 'LIVE'}</span>
        </div>
      )}

      {/* 6. EXPANDABLE PAYWALL LOCK DRAWER FOR VISITORS */}
      {isExpanded && isLocked && (
        <div
          className="paywall-lock-container"
          style={{
            margin: '14px 0',
            padding: '24px 20px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(254, 243, 199, 0.5), rgba(255, 237, 213, 0.4))',
            border: '1.5px solid #fed7aa',
            textAlign: 'center',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="paywall-lock-icon" style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
            Oddsbanta BigBang VIP Basketball Analytics
          </h4>
          <p style={{ margin: '0 0 16px 0', fontSize: 12.5, color: '#475569', lineHeight: 1.5, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
            Autonomous Monte Carlo simulations, Dean Oliver Four Factors, point spreads, game totals, and possession pace models are reserved for BigBang VIP members.
          </p>
          <button
            type="button"
            className="btn-paywall-unlock-prominent"
            style={{
              background: 'linear-gradient(135deg, #f97316, #ea580c)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: 13,
              padding: '10px 22px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(234, 88, 12, 0.25)',
            }}
            onClick={() => {
              if (onOpenUpgrade) onOpenUpgrade();
              else if (onOpenAuth) onOpenAuth('register');
            }}
          >
            👑 Unlock BigBang VIP (₦10,000/mo) →
          </button>
        </div>
      )}

      {/* 6.5 EXPANDABLE 250,000 SIMULATION & FOUR FACTORS DRAWER FOR SUBSCRIBERS */}
      {isExpanded && !isLocked && !isSecondaryRedacted && (
        <div className="bball-four-factors-wrap" onClick={(e) => e.stopPropagation()}>
          <div className="bball-ff-header">
            <span>Dean Oliver Four Factors Breakdown</span>
            <span style={{ color: '#64748b' }}>Possessions &amp; Simulated Pace</span>
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
          {!isLocked && prediction.simulated_home_score != null && prediction.simulated_away_score != null && (
            <div style={{ display: 'flex', justifyContent: 'space-around', background: '#ffffff', border: '1px solid #e2e8f0', padding: '10px', borderRadius: '8px', marginTop: '12px', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Expected Home Score</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#ea580c' }}>{prediction.simulated_home_score.toFixed(1)}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Projected Total</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                  {(prediction.simulated_home_score + prediction.simulated_away_score).toFixed(1)}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Expected Away Score</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0284c7' }}>{prediction.simulated_away_score.toFixed(1)}</div>
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
        </div>
      )}

      {/* Accordion toggle prompt - BOLD & EYE CATCHING CLICK TO VIEW MORE */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
        <button
          type="button"
          className={`bball-view-more-btn ${isExpanded ? 'expanded' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          aria-expanded={isExpanded}
          title={isExpanded ? 'Click to collapse breakdown' : 'Click to view Dean Oliver Four Factors Breakdown'}
        >
          {isExpanded ? (
            <>
              <span>▲ CLICK TO COLLAPSE</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: '14px' }}>🔥</span>
              <span>CLICK TO VIEW MORE</span>
              <span style={{ fontSize: '11px' }}>▼</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
