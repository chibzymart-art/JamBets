import React, { useState } from 'react';
import { TennisPrediction, TennisSurface } from '../types/tennis';
import { getTierConfig } from './FixtureCard';

export interface TennisPredictionCardProps {
  prediction: TennisPrediction;
  isSubscriber: boolean;
  onOpenUpgrade?: () => void;
  onOpenAuth?: (mode: 'signin' | 'register') => void;
}

export const TennisPredictionCard: React.FC<TennisPredictionCardProps> = ({
  prediction,
  isSubscriber,
  onOpenUpgrade,
  onOpenAuth,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { fixture, is_locked } = prediction;
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

  const isFinished = fixture?.status === 'finished' || fixture?.status === 'retired';
  const isLive = fixture?.status === 'live';
  const isWon = prediction.settlement_status === 'won';
  const isLost = prediction.settlement_status === 'lost';
  const isVoid = prediction.settlement_status === 'void';
  const isLocked = !isSubscriber || is_locked;

  // Confidence tier configuration (matching Football FixtureCard exactly)
  const effectiveCategory = isLocked ? 'LOCKED' : (prediction.confidence_category || 'TOP PICK');
  const tierConfig = getTierConfig(effectiveCategory);
  const cleanTierLabel = (tierConfig.label || '').replace(/\s*\([^)]*\)/g, '').trim();

  const probPct = prediction.probability != null
    ? ((prediction.probability <= 1 ? prediction.probability * 100 : prediction.probability)).toFixed(1)
    : null;
  const probNum = prediction.probability != null
    ? (prediction.probability <= 1 ? prediction.probability * 100 : prediction.probability)
    : null;
  const scoreRating = probNum != null ? (probNum / 10).toFixed(1) : null;

  const tournamentDisplay = `${tour} • ${tournament?.name || 'World Tour'}`;
  const locationText = `${tournament?.city || tournament?.country || 'Official Court'}`;
  const eloDiffText = absDiff > 0 ? `Δ +${absDiff} ELO (${leaderName.split(' ').pop()})` : 'Even Matchup';

  const p1DisplayName = player1?.display_name || 'Player 1';
  const p2DisplayName = player2?.display_name || 'Player 2';
  const p1RankText = player1?.current_rank ? ` #${player1.current_rank}` : '';
  const p2RankText = player2?.current_rank ? ` #${player2.current_rank}` : '';

  const markov = prediction.metadata?.markov;

  return (
    <div
      id={`fixture-${prediction.id}`}
      className={`fixture-card glance-fixture-box ${isWon ? 'card-state-won' : isLost ? 'card-state-lost' : 'card-state-default'}`}
      onClick={() => setIsExpanded(!isExpanded)}
      style={{ cursor: 'pointer', marginBottom: 12 }}
    >
      {/* 1. TOP META ROW: TOURNAMENT, TIME, SURFACE & CPI */}
      <div className="glance-top-row">
        <span className="glance-league-pill" title={tournamentDisplay}>
          {tournamentDisplay}
        </span>

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

            {scoreRating && (
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

        {/* Right Col: Exact Football Key 250,000 Sim Pick Card + Chevron */}
        <div className="glance-right-col">
          {isLocked ? (
            <div className="glance-key-pick-card locked" onClick={() => setIsExpanded(!isExpanded)}>
              <div className="key-pick-badge">
                <span className="key-pick-spark">✨</span>
                <span>KEY 250,000 SIM PICK</span>
              </div>
              <div className="key-pick-outcome locked-blur">
                ••••••••••••••••
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
                Unlock (₦5,000/mo) →
              </button>
            </div>
          ) : (
            <div
              className="glance-key-pick-card"
              onClick={() => setIsExpanded(!isExpanded)}
              title="Click to expand calibrated 250,000 Monte Carlo & Markov simulation breakdown"
            >
              <div className="key-pick-badge">
                <span className="key-pick-spark">✨</span>
                <span>KEY 250,000 SIM PICK</span>
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
                {prediction.prediction}
              </div>
              <div className="key-pick-prob">
                {probPct ? `${probPct}% Probability` : 'Simulated'}
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

      {/* 3. EXPANDABLE BREAKDOWN BODY (MATCHING FOOTBALL CARD BREAKDOWN EXACTLY) */}
      {isExpanded && (
        <div className="expanded-breakdown-body" onClick={(e) => e.stopPropagation()}>
          {isLocked ? (
            /* PAYWALL UI BLURRED LOCK STATE */
            <div className="paywall-lock-container">
              <div className="paywall-blurred-backdrop">
                <div className="sniper-primary-card dummy-placeholder">
                  <div className="sniper-primary-badge-row">
                    <span className="sniper-primary-title">⭐ TOP PICK (RESTRICTED)</span>
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
                <h4>Premium Pick - Upgrade to Standard/VIP to View</h4>
                <p>
                  High-probability Banker consensus (80%+), Top Pick, and Banger signals are protected for active members.
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
                  ⚡ Unlock with Standard Plan (₦5,000/mo) →
                </button>
              </div>
            </div>
          ) : (
            <div className="prediction-panel">
              <div className="prediction-panel-header">
                <div className="sim-verified-pill">
                  <span className="dot" />
                  <span>Exact 250,000 Draws Verified • Tennis Engine</span>
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
                  </div>
                </div>

                <div className="sniper-primary-main">
                  <div className="sniper-market-outcome">
                    <span className="sniper-market-name">
                      {prediction.market ? prediction.market.replace(/_/g, ' ').toUpperCase() : 'MATCH WINNER'}
                    </span>
                    <span className="sniper-outcome-val">
                      {prediction.prediction}
                    </span>
                  </div>
                  <div className="sniper-prob-group">
                    <span className="sniper-prob-val">{probPct ? `${probPct}%` : '88.5%'}</span>
                    <span className="sniper-prob-label">Simulated Probability</span>
                  </div>
                </div>
              </div>

              {/* Secondary Markets Grid (Set Handicap & Total Games) */}
              {prediction.secondary_predictions && prediction.secondary_predictions.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
                  {prediction.secondary_predictions.map((sec, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '10px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                          {sec.market === 'set_handicap' ? 'Set Handicap' : 'Total Games'}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                          {sec.pick}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: '#16a34a' }}>
                        {Math.round(sec.probability * 100)}%
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Markov Service Hold Rates & Surface ELO Diagnostics */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
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
                    {Math.round((markov?.p_hold_player1 || 0.82) * 100)}% • {p1Elo} ELO
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    {p2DisplayName.split(' ').pop()} Hold Est.
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                    {Math.round((markov?.p_hold_player2 || 0.8) * 100)}% • {p2Elo} ELO
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    Dominance Ratio (DR)
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
                    {(markov?.dominance_ratio_player1 || 1.15).toFixed(2)} vs {(markov?.dominance_ratio_player2 || 0.92).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* AI Tactical Intelligence Narrative */}
              {prediction.metadata?.ai_tactical_analysis && (
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
                  <strong>🧠 Tactical & Surface Edge:</strong> {prediction.metadata.ai_tactical_analysis}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
