import React, { useState, useMemo } from 'react';
import { TennisPrediction, TennisSurface } from '../types/tennis';
import { getTierConfig } from './FixtureCard';
import { FavoritePredictionItem } from './FavoritesDrawer';

export interface TennisPredictionCardProps {
  prediction: TennisPrediction;
  isSubscriber: boolean;
  isAdmin?: boolean;
  canViewPredictions?: boolean;
  isFavorite?: boolean;
  isFavoriteItem?: (fixtureId: string, market: string, pick: string) => boolean;
  onToggleFavorite?: (item: FavoritePredictionItem) => void;
  onOpenUpgrade?: () => void;
  onOpenAuth?: (mode: 'signin' | 'register') => void;
}

export const TennisPredictionCard: React.FC<TennisPredictionCardProps> = ({
  prediction,
  isSubscriber,
  isAdmin = false,
  canViewPredictions = false,
  isFavorite = false,
  isFavoriteItem,
  onToggleFavorite,
  onOpenUpgrade,
  onOpenAuth,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { fixture } = prediction;
  const tournament = fixture?.tournament;
  const player1 = fixture?.player1;
  const player2 = fixture?.player2;

  const tour = (tournament?.tour || 'ATP').toUpperCase();
  const surface: TennisSurface = tournament?.surface || 'hard_outdoor';
  const cpi = tournament?.court_pace_index ?? 35;

  // Surface label and icon
  const surfaceMeta = (() => {
    switch (surface) {
      case 'clay':
        return { label: 'Clay Court', icon: '🧱' };
      case 'grass':
        return { label: 'Grass Court', icon: '🌱' };
      case 'hard_indoor':
        return { label: 'Indoor Hard', icon: '🏟️' };
      case 'hard_outdoor':
      default:
        return { label: 'Hard Court', icon: '🏢' };
    }
  })();

  // Surface-specific ELO
  const getSurfaceElo = (player: typeof player1) => {
    if (!player) return 1500;
    if (surface === 'clay') return player.clay_elo || 1500;
    if (surface === 'grass') return player.grass_elo || 1500;
    if (surface === 'hard_indoor') return player.indoor_elo || 1500;
    return player.hard_elo || 1500;
  };

  const p1Elo = getSurfaceElo(player1);
  const p2Elo = getSurfaceElo(player2);
  const eloDiff = p1Elo - p2Elo;
  const absDiff = Math.abs(eloDiff);
  const leaderName = eloDiff >= 0 ? (player1?.display_name || 'Player 1') : (player2?.display_name || 'Player 2');

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

  const isFinished = fixture?.status === 'finished' || fixture?.status === 'retired' || Boolean(prediction.settled_at);
  const isLive = fixture?.status === 'live';

  // Entitlement: Admins or entitled subscribers have full access
  const isUserEntitled = Boolean(isAdmin || canViewPredictions || isSubscriber);

  // Settlement indicators are strictly for paid VIP users. Free users & visitors never see won/lost/void.
  const isWon = isUserEntitled && (prediction.settlement_status === 'won' || prediction.settlement_status === 'half_won');
  const isLost = isUserEntitled && (prediction.settlement_status === 'lost' || prediction.settlement_status === 'half_lost');
  const isVoid = isUserEntitled && ((prediction.settlement_status as string) === 'void' || (prediction.settlement_status as string) === 'voided');

  // Categorize tier: High Confidence, Top Picks, Bangers are strictly VIP tiers
  const cat = (prediction.confidence_category || '').toUpperCase().replace(/[\s-]+/g, '_');
  let prob = prediction.probability;
  if (prob != null && typeof prob === 'number' && prob > 1) prob = prob / 100;

  // Multi-Sport VIP Shield: ALL tennis predictions (including settled ones) are locked for non-VIP visitors as teasers.
  const isLocked = !isUserEntitled;

  // Confidence tier configuration (matching Football FixtureCard exactly)
  const effectiveCategory = isLocked
    ? (prediction.confidence_category && prediction.confidence_category !== 'LOCKED' ? prediction.confidence_category : 'TOP PICK')
    : (prediction.confidence_category && prediction.confidence_category !== 'LOCKED' ? prediction.confidence_category : 'MID CONFIDENCE');
  const tierConfig = getTierConfig(effectiveCategory);
  const cleanTierLabel = (tierConfig.label || '').replace(/\s*\([^)]*\)/g, '').trim();

  const displayedPrediction = isLocked
    ? '🔒 BigBang VIP Pick'
    : (prediction.prediction === '🔒 Subscriber Only' ? `${leaderName} Win` : prediction.prediction);

  const probPct = prediction.probability != null
    ? ((prediction.probability <= 1 ? prediction.probability * 100 : prediction.probability)).toFixed(1)
    : null;
  const probNum = prediction.probability != null
    ? (prediction.probability <= 1 ? prediction.probability * 100 : prediction.probability)
    : null;
  const scoreRating = probNum != null ? (probNum / 10).toFixed(1) : null;

  const isNoBanker =
    cat === 'NO_SAFE_BANKER' ||
    cat === 'NOSAFEBANKER' ||
    cat.includes('NO_SAFE') ||
    cat.includes('NOSAFE') ||
    (prediction.market || '').toUpperCase() === 'NO_SAFE_BANKER' ||
    (prediction.prediction || '').toUpperCase() === 'SKIP';

  const isSettledOrFinished = isFinished || Boolean(prediction.settled_at) || (Boolean(prediction.settlement_status) && prediction.settlement_status !== 'pending');

  // Secondary predictions are only redacted for active/unsettled matches for non-subscribers
  const isSecondaryRedacted = !isUserEntitled && !isWon && isNoBanker && !isSettledOrFinished;

  // Resolve secondary predictions from dynamic database record or empty array
  // Filter out legacy match_winner so secondary grid is strictly distinct derivative markets
  const displayedSecondaryPreds = useMemo(() => {
    if (isSecondaryRedacted || isLocked) return [];
    const list = prediction.secondary_predictions || [];
    return list.filter(sec => {
      const m = (sec.market || '').toLowerCase();
      return m !== 'match_winner';
    });
  }, [prediction.secondary_predictions, isSecondaryRedacted, isLocked]);

  const category = (tournament?.category || '250').toUpperCase();
  const round = fixture?.round;

  const roundName = (() => {
    switch (round) {
      case 'F': return 'Final';
      case 'SF': return 'Semifinal';
      case 'QF': return 'Quarterfinal';
      case 'R16': return 'Round of 16';
      case 'R32': return 'Round of 32';
      case 'R64': return 'Round of 64';
      case 'R128': return 'Round of 128';
      case 'QUAL': return 'Qualifying';
      default: return null;
    }
  })();

  const tourTag = (() => {
    if (category === 'CH' || tour === 'CHALLENGER') return '⚡ CHALLENGER';
    if (tour === 'TEAM' || category === 'CUP') return '🏆 TEAM CUP';
    if (category === 'GS') return '👑 GRAND SLAM';
    if (tour === 'WTA') return '🟣 WTA';
    return '🔵 ATP';
  })();

  const tourPillStyle = (() => {
    if (category === 'CH' || tour === 'CHALLENGER') {
      return { background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' };
    }
    if (tour === 'TEAM' || category === 'CUP') {
      return { background: '#fff1f2', borderColor: '#fecdd3', color: '#9f1239' };
    }
    if (category === 'GS') {
      return { background: '#fefce8', borderColor: '#fde047', color: '#854d0e' };
    }
    if (tour === 'WTA') {
      return { background: '#faf5ff', borderColor: '#e9d5ff', color: '#6b21a8' };
    }
    return { background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' };
  })();

  const tournamentDisplay = `${tourTag} • ${tournament?.name || 'World Tour'}`;
  const locationText = `${tournament?.city || tournament?.country || 'Official Court'}`;
  const eloDiffText = absDiff > 0 ? `Δ +${absDiff} ELO (${leaderName.split(' ').pop()})` : 'Even Matchup';

  const p1DisplayName = player1?.display_name || 'Player 1';
  const p2DisplayName = player2?.display_name || 'Player 2';
  const p1RankText = player1?.current_rank ? ` #${player1.current_rank}` : '';
  const p2RankText = player2?.current_rank ? ` #${player2.current_rank}` : '';

  const markov = prediction.metadata?.markov;
  const p1HoldRate = markov?.p_hold_player1 ?? (prediction.metadata?.p1_hold_rate != null ? Number(prediction.metadata.p1_hold_rate) : null);
  const p2HoldRate = markov?.p_hold_player2 ?? (prediction.metadata?.p2_hold_rate != null ? Number(prediction.metadata.p2_hold_rate) : null);
  const drP1 = markov?.dominance_ratio_player1 ?? (prediction.metadata?.dominance_ratio_player1 != null ? Number(prediction.metadata.dominance_ratio_player1) : null);
  const drP2 = markov?.dominance_ratio_player2 ?? (prediction.metadata?.dominance_ratio_player2 != null ? Number(prediction.metadata.dominance_ratio_player2) : null);

  const dominanceRatioText = (() => {
    if (drP1 != null && drP2 != null) {
      return `${drP1.toFixed(2)} vs ${drP2.toFixed(2)}`;
    }
    if (p1HoldRate != null && p2HoldRate != null && p2HoldRate > 0) {
      const ratio = p1HoldRate / p2HoldRate;
      return `${ratio.toFixed(2)} vs ${(1 / ratio).toFixed(2)}`;
    }
    return '-- vs --';
  })();

  const tacticalAnalysis = prediction.metadata?.ai_tactical_analysis || prediction.metadata?.tactical_reasoning;
  const expectedTotalGames = prediction.metadata?.expected_total_games;
  const expectedGameMargin = prediction.metadata?.expected_game_margin;

  const primaryMarket = 'Match Winner';
  const primaryPick = displayedPrediction || prediction.prediction;

  const isPrimaryFav = Boolean(
    isFavoriteItem
      ? isFavoriteItem(prediction.fixture_id, primaryMarket, primaryPick)
      : isFavorite
  );

  const handlePrimaryFavoriteToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleFavorite) return;
    const favoriteItem: FavoritePredictionItem = {
      id: `${prediction.fixture_id}::${primaryMarket}::${primaryPick}`,
      fixtureId: prediction.fixture_id,
      homeTeam: p1DisplayName,
      awayTeam: p2DisplayName,
      league: tournament?.name || `${tour} Tour`,
      targetKickoffAt: prediction.target_kickoff_at || fixture?.target_kickoff_at || new Date().toISOString(),
      market: primaryMarket,
      prediction: primaryPick,
      probability: probNum ? Math.round(probNum) : 75,
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
      homeTeam: p1DisplayName,
      awayTeam: p2DisplayName,
      league: tournament?.name || `${tour} Tour`,
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
      id={`fixture-${prediction.id}`}
      className={`fixture-card glance-fixture-box ${isWon ? 'card-state-won' : isLost ? 'card-state-lost' : 'card-state-default'}`}
      onClick={() => setIsExpanded(!isExpanded)}
      style={{ cursor: 'pointer', marginBottom: 12 }}
    >
      {/* 1. TOP META ROW: TOURNAMENT, TIME, SURFACE & CPI */}
      <div className="glance-top-row">
        {onToggleFavorite && (
          <button
            type="button"
            className={`glance-favorite-btn ${isPrimaryFav ? 'starred' : ''}`}
            title={isPrimaryFav ? 'Remove from Acca Slip' : 'Add to Acca Slip'}
            onClick={handlePrimaryFavoriteToggle}
          >
            {isPrimaryFav ? '✓ IN SLIP' : '+ ADD TO SLIP'}
          </button>
        )}

        <span className="glance-league-pill" title={tournamentDisplay} style={tourPillStyle}>
          {tournamentDisplay}
        </span>

        {roundName && (
          <span className="glance-round-pill">
            🎯 {roundName}
          </span>
        )}

        <span className="glance-time-pill">
          📅 {formattedDateTime}
        </span>

        <span className="glance-time-pill" style={{ background: '#f8fafc', borderColor: '#e2e8f0', color: '#475569' }}>
          {surfaceMeta.icon} {surfaceMeta.label} • CPI {cpi}
        </span>

        {isLive && (
          <div className="glance-live-badge">
            <span className="glance-live-tag">⚡ LIVE</span>
            <span className="glance-live-score-pill">
              {fixture?.score_p1_sets ?? 0} - {fixture?.score_p2_sets ?? 0} Sets
            </span>
          </div>
        )}

        {isFinished && (
          <div className="glance-finished-badge">
            <span className="glance-ft-tag">FINAL</span>
            <span className="glance-ft-score-pill">
              {fixture?.score_p1_sets ?? 0} - {fixture?.score_p2_sets ?? 0} Sets
            </span>
          </div>
        )}
      </div>

      {/* 2. MIDDLE ROW: CONFIDENCE, MATCHUP & PROMINENT KEY SIM PICK */}
      <div className="glance-middle-row">
        {/* Left Col: Confidence Badge, Players & Location */}
        <div className="glance-left-col">
          <div className="glance-confidence-row">
            <span
              className={`glance-conf-pill ${tierConfig.badgeClass}`}
              style={{ color: tierConfig.textColor, borderColor: tierConfig.borderColor, background: tierConfig.bgColor }}
            >
              <span className="glance-conf-bullet" style={{ background: tierConfig.textColor }} />
              {cleanTierLabel}
            </span>

            {scoreRating && !isLocked && (
              <span className="glance-score-pill">
                Score: {scoreRating} / 10
              </span>
            )}

            {isWon && (
              <span className="glance-settle-pill">
                <span style={{ color: '#16a34a', fontWeight: 800 }}>✓ WON</span>
              </span>
            )}
            {isLost && (
              <span className="glance-settle-pill">
                <span style={{ color: '#dc2626', fontWeight: 800 }}>✗ LOST</span>
              </span>
            )}
            {isVoid && (
              <span className="glance-settle-pill">
                <span style={{ color: '#64748b', fontWeight: 800 }}>⊘ VOID</span>
              </span>
            )}
          </div>

          <div className="glance-teams-row">
            <span className="glance-team-name">
              {p1DisplayName}{p1RankText}
            </span>
            {isLive || isFinished ? (
              <span className={`glance-live-match-score ${isLive ? 'in-play' : 'final'}`}>
                {fixture?.score_p1_sets ?? 0} - {fixture?.score_p2_sets ?? 0}
              </span>
            ) : (
              <span className="glance-vs-pill">vs</span>
            )}
            <span className="glance-team-name">
              {p2DisplayName}{p2RankText}
            </span>
          </div>

          <div className="glance-venue-row">
            <span className="glance-venue-icon">📍</span>
            <span className="glance-venue-text">
              {locationText} • {surfaceMeta.label} • {eloDiffText}
            </span>
          </div>
        </div>

        {/* Right Col: Exact Football Key 250,000 Sim Pick Card + Favorite Button + Chevron */}
        <div className="glance-right-col">
          {onToggleFavorite && (
            <button
              type="button"
              className={`tennis-add-slip-btn ${isPrimaryFav ? 'in-slip' : ''}`}
              onClick={handlePrimaryFavoriteToggle}
              title={isPrimaryFav ? 'Remove from Acca Slip' : 'Add to Acca Slip'}
              aria-label={isPrimaryFav ? 'Remove from Acca Slip' : 'Add to Acca Slip'}
            >
              {isPrimaryFav ? '✓ IN SLIP' : '+ ADD TO SLIP'}
            </button>
          )}

          {isLocked ? (
            <div className="glance-key-pick-card locked" onClick={() => setIsExpanded(!isExpanded)}>
              <div className="key-pick-badge">
                <span className="key-pick-spark">✨</span>
                <span>KEY MODEL PICK</span>
              </div>
              <div className="key-pick-outcome locked-blur">
                🔒 BigBang VIP Pick
              </div>
              <button
                type="button"
                className="key-pick-unlock-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenUpgrade) onOpenUpgrade();
                  else if (onOpenAuth) onOpenAuth('register');
                }}
              >
                Unlock BigBang VIP (₦10,000/mo) →
              </button>
            </div>
          ) : (
            <div
              className="glance-key-pick-card"
              onClick={() => setIsExpanded(!isExpanded)}
              title="Click to expand calibrated model probability & Markov breakdown"
            >
              <div className="key-pick-badge">
                <span className="key-pick-spark">✨</span>
                <span>KEY MODEL PICK</span>
                {isWon && (
                  <span style={{ marginLeft: 6, padding: '1px 6px', background: '#16a34a', color: '#fff', borderRadius: 4, fontSize: 10, fontWeight: 900 }}>
                    ✓ WON
                  </span>
                )}
                {isLost && (
                  <span style={{ marginLeft: 6, padding: '1px 6px', background: '#dc2626', color: '#fff', borderRadius: 4, fontSize: 10, fontWeight: 900 }}>
                    ✗ LOST
                  </span>
                )}
              </div>
              <div className="key-pick-outcome">
                {displayedPrediction}
              </div>
              <div className="key-pick-prob">
                {probPct ? `${probPct}% Probability` : 'Simulated'}
              </div>
              <div className={`key-pick-view-more-tag ${isExpanded ? 'is-expanded' : ''}`}>
                {isExpanded ? '▴ Hide Details' : '▾ Click to View More'}
              </div>
            </div>
          )}

          <button
            type="button"
            className={`glance-chevron-btn ${isExpanded ? 'expanded' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            title={isExpanded ? 'Hide Simulation Breakdown' : 'Expand Simulation Breakdown'}
          >
            {isExpanded ? '⌃' : '⌄'}
          </button>
        </div>
      </div>

      {/* 2.5 EXPLICIT CLICK TO VIEW MORE CALL-TO-ACTION (Overs, Handicaps & Simulation Breakdown) */}
      <div
        className={`tennis-card-expand-bar ${isExpanded ? 'is-expanded' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        title="Click to view more: Over/Under total games, set handicaps, dominance ratios and AI analysis"
      >
        <div className="tennis-expand-teaser">
          <span className="tennis-expand-teaser-dot">⚡</span>
          <span className="tennis-expand-teaser-text">
            Secondary Markets: <strong>Game Spread</strong> • <strong>1st Set</strong> • <strong>Set Handicap</strong> • <strong>Total Games</strong>
          </span>
        </div>
        <div className="tennis-expand-cta-btn">
          <span>{isExpanded ? '▴ HIDE DETAILS' : '▾ CLICK TO VIEW MORE (OVERS & STATS)'}</span>
        </div>
      </div>

      {/* 3. EXPANDABLE BREAKDOWN BODY (MATCHING PRODUCTION VERSION 1 CARD EXACTLY) */}
      {isExpanded && (
        <div className="expanded-breakdown-body" onClick={(e) => e.stopPropagation()}>
          {isLocked ? (
            /* PAYWALL UI BLURRED LOCK STATE */
            <div className="paywall-lock-container">
              <div className="paywall-blurred-backdrop">
                <div className="sniper-primary-card dummy-placeholder">
                  <div className="sniper-primary-badge-row">
                    <span className="sniper-primary-title">🎯 TOP PICK (RESTRICTED)</span>
                  </div>
                  <div className="sniper-primary-main">
                    <div className="sniper-market-outcome">
                      <span className="sniper-market-name">Market: ••••••••••••••••</span>
                      <span className="sniper-outcome-val">Outcome: ••••••••</span>
                    </div>
                    <div className="sniper-prob-group">
                      <span className="sniper-prob-val">8X.X%</span>
                      <span className="sniper-prob-label">Simulated Probability</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="paywall-overlay-prompt">
                <div className="paywall-lock-icon">🔒</div>
                <h4>Oddsbanta BigBang VIP Tennis Match Radar</h4>
                <p>
                  ATP &amp; WTA match predictions, Markov probability models, game spreads, and set totals are reserved exclusively for BigBang VIP members.
                </p>
                <button
                  type="button"
                  className="btn-paywall-unlock-prominent"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (onOpenUpgrade) onOpenUpgrade();
                    else if (onOpenAuth) onOpenAuth('register');
                  }}
                >
                  ⚡ Unlock BigBang VIP (₦10,000/mo) →
                </button>
              </div>
            </div>
          ) : (
            <div className="prediction-panel">
              <div className="prediction-panel-header">
                <div className="sim-verified-pill">
                  <span className="dot" />
                  <span>Markov Hold/Break Probability Model • Tennis Engine</span>
                </div>
                <span className="model-tag">
                  PCG64 • Barnett-Clarke Markov Chain
                </span>
              </div>

              {/* Primary Prediction Card */}
              <div className="sniper-primary-card">
                <div className="sniper-primary-badge-row">
                  <span className="sniper-primary-title">
                    🎯 PRIMARY PREDICTION (TOP BANKER)
                  </span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {isWon && <span className="badge-settled-won">✓ WON</span>}
                    {isLost && <span className="badge-settled-lost">✗ LOST</span>}
                    {isVoid && <span className="badge-settled-void">⊘ VOID</span>}
                    <span
                      className={`tier-badge ${tierConfig.badgeClass}`}
                      style={{ color: tierConfig.textColor, borderColor: tierConfig.borderColor, background: tierConfig.bgColor }}
                    >
                      {tierConfig.icon} {cleanTierLabel}
                    </span>
                    {onToggleFavorite && (
                      <button
                        type="button"
                        className={`secondary-card-fav-btn ${isPrimaryFav ? 'active' : ''}`}
                        onClick={handlePrimaryFavoriteToggle}
                        title={isPrimaryFav ? 'Remove prediction from slip' : 'Add primary pick to favorites slip'}
                      >
                        {isPrimaryFav ? '✓ IN SLIP' : '+ ADD TO SLIP'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="sniper-primary-main">
                  <div className="sniper-market-outcome">
                    <span className="sniper-market-name">
                      {primaryMarket.toUpperCase()}
                    </span>
                    <span className="sniper-outcome-val">
                      {primaryPick}
                    </span>
                  </div>
                  <div className="sniper-prob-group">
                    <span className="sniper-prob-val">{probPct ? `${probPct}%` : '--'}</span>
                    <span className="sniper-prob-label">Simulated Probability</span>
                  </div>
                </div>
              </div>

              {/* If isSecondaryRedacted (No Safe Banker for non-subscribers): Render Anti-Loss VIP Derivative Markets Teaser */}
              {isSecondaryRedacted ? (
                <div
                  className="tennis-anti-loss-teaser-box"
                  style={{
                    marginTop: 14,
                    padding: '16px 18px',
                    background: 'linear-gradient(135deg, rgba(248, 250, 252, 0.98), rgba(241, 245, 249, 0.95))',
                    border: '1.5px dashed #cbd5e1',
                    borderRadius: 12,
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 15 }}>🔒</span>
                      <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                        VIP Derivative Markets Detected
                      </span>
                    </div>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: '#b45309',
                      background: '#fef3c7',
                      border: '1px solid #fde68a',
                      padding: '2px 8px',
                      borderRadius: 9999,
                      textTransform: 'uppercase',
                    }}>
                      Volatile Match Protection
                    </span>
                  </div>

                  <p style={{ fontSize: 12, color: '#475569', lineHeight: 1.5, margin: '0 0 12px 0' }}>
                    Match winner volatility is high. Our Markov engine identified <strong>qualifying derivative edges</strong> (Game Handicap, 1st Set Winner, and Total Games). Upgrade to VIP to reveal all derivative market lines and probabilities.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, filter: 'blur(3.5px)', opacity: 0.65, userSelect: 'none', pointerEvents: 'none', marginBottom: 12 }}>
                    <div style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: '#64748b' }}>⚡ GAME HANDICAP</div>
                      <div style={{ fontSize: 12, fontWeight: 900, color: '#1e293b' }}>+3.5 Games • 7X.X%</div>
                    </div>
                    <div style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: '#64748b' }}>🥇 1ST SET WINNER</div>
                      <div style={{ fontSize: 12, fontWeight: 900, color: '#1e293b' }}>Player 1 • 7X.X%</div>
                    </div>
                    <div style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: '#64748b' }}>📊 TOTAL GAMES</div>
                      <div style={{ fontSize: 12, fontWeight: 900, color: '#1e293b' }}>Over 21.5 • 7X.X%</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                      ⚡ Reveal Markov game handicap &amp; set totals
                    </span>
                    <button
                      type="button"
                      className="btn-paywall-unlock-prominent"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        color: '#ffffff',
                        fontWeight: 800,
                        fontSize: 12,
                        padding: '6px 14px',
                        borderRadius: 6,
                        border: 'none',
                        cursor: 'pointer',
                        boxShadow: '0 2px 6px rgba(217, 119, 6, 0.25)',
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
              ) : (
                /* Secondary Markets Grid (Game Spread, 1st Set, Set Handicap, Total Games) */
                !isLocked && displayedSecondaryPreds && displayedSecondaryPreds.length > 0 && (
                  <div className="tennis-secondary-markets-section" style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>📊</span> SECONDARY PREDICTIONS & MARKETS (SPREAD / OVERS / HANDICAPS)
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '1px 8px', borderRadius: 9999, border: '1px solid #a7f3d0' }}>
                        Markov Calibrated
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
                      {displayedSecondaryPreds.map((sec, idx) => {
                        const marketName = (() => {
                          const m = (sec.market || '').toLowerCase();
                          if (m.includes('game_handicap')) return 'Game Handicap';
                          if (m.includes('first_set') || m.includes('1st_set')) return '1st Set Winner';
                          if (m.includes('set_handicap')) return 'Set Handicap';
                          if (m.includes('total_games') || m.includes('over')) return 'Total Games';
                          if (m.includes('match_winner')) return 'Match Winner';
                          if (m.includes('correct_set')) return 'Correct Score';
                          return (sec.market || 'Market').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                        })();

                        const displayMarketTitle = (() => {
                          const m = (sec.market || '').toLowerCase();
                          if (m.includes('game_handicap')) return '⚡ Game Handicap (Spread)';
                          if (m.includes('first_set') || m.includes('1st_set')) return '🥇 1st Set Winner';
                          if (m.includes('set_handicap')) return '🎾 Set Handicap';
                          if (m.includes('total_games') || m.includes('over')) return '📊 Total Games';
                          if (m.includes('match_winner')) return '🏆 Match Winner';
                          if (m.includes('correct_set')) return '🎯 Correct Score';
                          return (sec.market || 'Market').replace(/_/g, ' ').toUpperCase();
                        })();

                        const isSecLocked = Boolean((sec as any).locked || sec.probability == null);
                        const pickVal = (sec as any).prediction || sec.pick || 'Pick';
                        const probVal = sec.probability != null
                          ? Math.round(sec.probability <= 1 ? sec.probability * 100 : sec.probability)
                          : null;

                        const secSettlement = (sec as any).settlement_status as string | undefined;
                        const isSecWon = secSettlement === 'won' || secSettlement === 'half_won';
                        const isSecLost = secSettlement === 'lost' || secSettlement === 'half_lost';
                        const isSecVoid = secSettlement === 'void' || secSettlement === 'voided';

                        const isSecFav = Boolean(
                          isFavoriteItem ? isFavoriteItem(prediction.fixture_id, marketName, pickVal) : false
                        );

                        return (
                          <div
                            key={idx}
                            className="tennis-secondary-pred-tile"
                            style={{
                              background: '#ffffff',
                              border: isSecFav ? '1.5px solid #10b981' : isSecWon ? '1.5px solid #86efac' : isSecLost ? '1.5px solid #fca5a5' : '1.5px solid #e2e8f0',
                              borderRadius: 10,
                              padding: '12px 14px',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              boxShadow: isSecFav ? '0 2px 8px rgba(16, 185, 129, 0.15)' : '0 1px 3px rgba(0,0,0,0.03)',
                              transition: 'all 0.15s ease',
                              gap: 8,
                            }}
                          >
                            {/* Top Header: Market Title on Left, Settlement / Probability Badge on Right */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.25px', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {displayMarketTitle}
                              </span>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                                {isSecWon && (
                                  <span style={{ fontSize: 10, fontWeight: 900, color: '#ffffff', background: '#16a34a', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                    ✓ WON
                                  </span>
                                )}
                                {isSecLost && (
                                  <span style={{ fontSize: 10, fontWeight: 900, color: '#ffffff', background: '#dc2626', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                    ✗ LOST
                                  </span>
                                )}
                                {isSecVoid && (
                                  <span style={{ fontSize: 10, fontWeight: 900, color: '#475569', background: '#e2e8f0', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                    ⊘ VOID
                                  </span>
                                )}

                                {probVal != null ? (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: probVal >= 75 ? '#ecfdf5' : '#eff6ff', border: `1px solid ${probVal >= 75 ? '#a7f3d0' : '#bfdbfe'}`, padding: '2px 8px', borderRadius: 6, flexShrink: 0 }}>
                                    <span style={{ fontSize: 12, fontWeight: 900, color: probVal >= 75 ? '#15803d' : '#1d4ed8' }}>
                                      {probVal}%
                                    </span>
                                    <span style={{ fontSize: 9.5, fontWeight: 700, color: probVal >= 75 ? '#166534' : '#1e40af' }}>
                                      Prob
                                    </span>
                                  </div>
                                ) : isSecLocked ? (
                                  <div style={{ fontSize: 11, fontWeight: 800, color: '#d97706', background: '#fef3c7', padding: '2px 8px', borderRadius: 6, border: '1px solid #fde68a', flexShrink: 0 }}>
                                    🔒 VIP Lock
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {/* Bottom Row: Full Pick Name & Line in Bold without any Truncation + Add to Slip */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 }}>
                              <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a', lineHeight: 1.35, wordBreak: 'break-word', whiteSpace: 'normal', flex: 1 }}>
                                {pickVal}
                              </div>

                              {onToggleFavorite && !isSecLocked && (
                                <button
                                  type="button"
                                  className={`secondary-card-fav-btn ${isSecFav ? 'active' : ''}`}
                                  onClick={(e) => handleSecondaryFavoriteToggle(e, sec, marketName, pickVal, probVal)}
                                  title={isSecFav ? 'Remove from slip' : 'Add to slip'}
                                  style={{ flexShrink: 0 }}
                                >
                                  {isSecFav ? '✓ IN SLIP' : '+ ADD TO SLIP'}
                                </button>
                              )}
                            </div>

                            {(sec as any).settlement_notes && (
                              <div style={{ fontSize: 11, color: isSecWon ? '#15803d' : isSecLost ? '#b91c1c' : '#64748b', marginTop: 2, fontStyle: 'italic', lineHeight: 1.3 }}>
                                {(sec as any).settlement_notes}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

              {/* Markov Service Hold Rates & Surface ELO Diagnostics */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 8,
                  marginTop: 12,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    {p1DisplayName.split(' ').pop()} Hold Est.
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                    {p1HoldRate != null ? `${Math.round(p1HoldRate <= 1 ? p1HoldRate * 100 : p1HoldRate)}% • ${p1Elo} ELO` : `${p1Elo} ELO`}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    {p2DisplayName.split(' ').pop()} Hold Est.
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                    {p2HoldRate != null ? `${Math.round(p2HoldRate <= 1 ? p2HoldRate * 100 : p2HoldRate)}% • ${p2Elo} ELO` : `${p2Elo} ELO`}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    Dominance Ratio (DR)
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                    {dominanceRatioText}
                  </div>
                </div>
                {expectedTotalGames != null && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                      Exp. Total Games
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                      {expectedTotalGames} Games
                    </div>
                  </div>
                )}
                {expectedGameMargin != null && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                      Exp. Spread Margin
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                      {expectedGameMargin > 0 ? `+${expectedGameMargin}` : expectedGameMargin} Games
                    </div>
                  </div>
                )}
              </div>

              {/* AI Tactical Intelligence Narrative */}
              {tacticalAnalysis && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: 10,
                    fontSize: 12,
                    color: '#166534',
                    lineHeight: 1.55,
                  }}
                >
                  <strong>🧠 Tactical &amp; Surface Edge:</strong> {tacticalAnalysis}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
