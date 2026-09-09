import React from 'react';
import { Link } from 'react-router-dom';
import { QueueFixture, FootballPrediction, SecondaryPrediction } from '../types';

export interface TierDisplayConfig {
  label: string;
  icon: string;
  badgeClass: string;
  textColor: string;
  borderColor: string;
  bgColor: string;
}

export function getTierConfig(category?: string | null): TierDisplayConfig {
  const norm = (category || '').toUpperCase().replace(/ /g, '_');
  switch (norm) {
    case 'BANGER':
      return {
        label: 'BANGER (96%+)',
        icon: '🔥',
        badgeClass: 'tier-banger',
        textColor: '#ea580c', // Red/Orange text
        borderColor: '#f97316',
        bgColor: '#fff7ed'
      };
    case 'TOP_PICK':
    case 'TOPPICK':
      return {
        label: 'TOP PICK (90%-95%)',
        icon: '⭐',
        badgeClass: 'tier-top-pick',
        textColor: '#d97706', // Gold text
        borderColor: '#f59e0b',
        bgColor: '#fefce8'
      };
    case 'HIGH_CONFIDENCE':
    case 'HIGHCONFIDENCE':
      return {
        label: 'HIGH CONFIDENCE (83%-89%)',
        icon: '🟢',
        badgeClass: 'tier-high-conf',
        textColor: '#16a34a', // Bright Green text
        borderColor: '#22c55e',
        bgColor: '#f0fdf4'
      };
    case 'MID_CONFIDENCE':
    case 'MIDCONFIDENCE':
      return {
        label: 'MID CONFIDENCE (75%-82%)',
        icon: '🔵',
        badgeClass: 'tier-mid-conf',
        textColor: '#2563eb', // Blue text
        borderColor: '#3b82f6',
        bgColor: '#eff6ff'
      };
    case 'LOW_CONFIDENCE':
    case 'LOWCONFIDENCE':
      return {
        label: 'LOW CONFIDENCE (65%-74%)',
        icon: '🟡',
        badgeClass: 'tier-low-conf',
        textColor: '#ca8a04', // Yellow/Muted text
        borderColor: '#eab308',
        bgColor: '#fef9c3'
      };
    case 'RISKY':
      return {
        label: 'RISKY (<65%)',
        icon: '⚠️',
        badgeClass: 'tier-risky',
        textColor: '#9a3412', // Grey/Orange text
        borderColor: '#fb923c',
        bgColor: '#fff7ed'
      };
    case 'NO_SAFE_BANKER':
    case 'NOSAFEBANKER':
      return {
        label: 'NO SAFE BANKER',
        icon: '🛡️',
        badgeClass: 'tier-no-banker',
        textColor: '#64748b',
        borderColor: '#cbd5e1',
        bgColor: '#f8fafc'
      };
    case 'LOCKED':
    case 'HIDDEN':
      return {
        label: 'PREMIUM LOCKED',
        icon: '🔒',
        badgeClass: 'tier-locked',
        textColor: '#7c3aed',
        borderColor: '#c4b5fd',
        bgColor: '#faf5ff'
      };
    default:
      return {
        label: category || 'MODEL SIGNAL',
        icon: '🎯',
        badgeClass: 'tier-default',
        textColor: '#0f172a',
        borderColor: '#e2e8f0',
        bgColor: '#f8fafc'
      };
  }
}

export const formatMarketName = (market?: string | null): string => {
  if (!market) return 'Market Outcome';
  switch (market.toLowerCase()) {
    case '1x2': return 'Match Result (1X2)';
    case 'double_chance': return 'Double Chance';
    case 'over_under_0.5': return 'Goals O/U 0.5';
    case 'over_under_1.5': return 'Goals O/U 1.5';
    case 'over_under_2.5': return 'Goals O/U 2.5';
    case 'over_under_3.5': return 'Goals O/U 3.5';
    case 'over_under_4.5': return 'Goals O/U 4.5';
    case 'home_goals_0.5': return 'Home Goals O/U 0.5';
    case 'away_goals_0.5': return 'Away Goals O/U 0.5';
    case 'btts':
    case 'both_teams_to_score': return 'Both Teams To Score';
    case 'ht_result': return 'Half Time Result';
    case 'ht_goals_0.5': return 'HT Goals O/U 0.5';
    case 'ht_goals_1.5': return 'HT Goals O/U 1.5';
    case '2h_goals_0.5': return '2H Goals O/U 0.5';
    case '2h_goals_1.5': return '2H Goals O/U 1.5';
    case 'corners':
    case 'corners_8.5': return 'Corners O/U 8.5';
    case 'corners_9.5': return 'Corners O/U 9.5';
    case 'corners_10.5': return 'Corners O/U 10.5';
    case 'no_safe_banker': return 'Banker Requirement (≥80%)';
    default: return market.replace(/_/g, ' ').toUpperCase();
  }
};

export const formatPredictionOutcome = (outcome?: string | null): string => {
  if (!outcome) return '—';
  switch (outcome.toLowerCase()) {
    case 'home': return 'Home Win';
    case 'draw': return 'Draw (X)';
    case 'away': return 'Away Win';
    case '1x': return 'Home or Draw (1X)';
    case 'x2': return 'Draw or Away (X2)';
    case '12': return 'Home or Away (12)';
    case 'over': return 'Over';
    case 'under': return 'Under';
    case 'yes': return 'Yes (BTTS)';
    case 'no': return 'No (Clean Sheet)';
    case 'skip': return 'SKIP (No Safe Edge)';
    default: return outcome.toUpperCase();
  }
};

export interface FixtureCardProps {
  fixture: QueueFixture;
  prediction?: FootballPrediction | null;
  isAdmin: boolean;
  canViewPredictions: boolean;
  isStarred: boolean;
  onToggleFavorite: (id: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const FixtureCard: React.FC<FixtureCardProps> = ({
  fixture,
  prediction,
  isAdmin,
  canViewPredictions,
  isStarred,
  onToggleFavorite,
  isExpanded,
  onToggleExpand
}) => {
  const isFinished = fixture.status === 'finished';
  const isLive = fixture.status === 'live';
  const isDataUnavailable = fixture.status === 'data_unavailable';

  // Format Kickoff in Lagos WAT (UTC+1)
  const kickoffDate = new Date(fixture.target_kickoff_at);
  const timeStr = kickoffDate.toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const dateStr = kickoffDate.toLocaleDateString('en-GB', {
    timeZone: 'Africa/Lagos',
    month: 'short',
    day: 'numeric'
  });

  // Paywall lock evaluation:
  // Admin and verified paid users NEVER see locks.
  // Settled / finished fixtures are public to prove track record.
  // Free users see locks on active scheduled predictions.
  const hasPrediction = !!prediction;
  const isSettled = prediction?.settlement_status === 'won' ||
    prediction?.settlement_status === 'lost' ||
    prediction?.settlement_status === 'void' ||
    prediction?.settlement_status === 'voided' ||
    isFinished;

  const isLocked = !isAdmin && !canViewPredictions && !isSettled && hasPrediction;

  const tierConfig = getTierConfig(
    isLocked ? 'LOCKED' : prediction?.confidence_category || (hasPrediction ? 'MID_CONFIDENCE' : null)
  );

  // Parse Secondary Predictions
  const secondaryList: SecondaryPrediction[] = React.useMemo(() => {
    if (!prediction?.secondary_predictions) return [];
    if (Array.isArray(prediction.secondary_predictions)) return prediction.secondary_predictions;
    try {
      if (typeof prediction.secondary_predictions === 'string') {
        return JSON.parse(prediction.secondary_predictions);
      }
    } catch {}
    return [];
  }, [prediction?.secondary_predictions]);

  const isWon = prediction?.settlement_status === 'won';
  const isLost = prediction?.settlement_status === 'lost';
  const isVoid = prediction?.settlement_status === 'void' || prediction?.settlement_status === 'voided';
  const isPending = !prediction?.settlement_status || prediction.settlement_status === 'pending';

  const isNoBanker = prediction?.market === 'NO_SAFE_BANKER' ||
    prediction?.confidence_category === 'NO_SAFE_BANKER' ||
    prediction?.prediction === 'SKIP';

  const probPct = prediction?.probability != null
    ? ((prediction.probability <= 1 ? prediction.probability * 100 : prediction.probability)).toFixed(1)
    : null;

  return (
    <div id={`fixture-${fixture.id}`} className="fixture-card">
      {/* Top Bar: League & Date & Watchlist */}
      <div className="card-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="league-badge">
            {fixture.league_name || fixture.league_code}
          </span>
          <span className="queue-day-pill queue-day-0">
            📅 {dateStr}
          </span>
        </div>

        <button
          type="button"
          className={`star-favorite-btn ${isStarred ? 'starred' : ''}`}
          title={isStarred ? 'Remove from Watchlist' : 'Add to Watchlist'}
          onClick={() => onToggleFavorite(fixture.id)}
        >
          {isStarred ? '★' : '☆'}
        </button>
      </div>

      {/* Matchup Header: Home vs Away */}
      <div className="matchup-container">
        <div className="team-row">
          <div className="team-info">
            <div className="team-icon">
              {fixture.home_team_name?.charAt(0)?.toUpperCase() || 'H'}
            </div>
            <span className="team-name">{fixture.home_team_name?.replace(/-/g, ' ')}</span>
          </div>
          {fixture.home_score !== null && fixture.home_score !== undefined && (
            <span className="team-score">{fixture.home_score}</span>
          )}
        </div>

        <div className="vs-divider">VS</div>

        <div className="team-row">
          <div className="team-info">
            <div className="team-icon">
              {fixture.away_team_name?.charAt(0)?.toUpperCase() || 'A'}
            </div>
            <span className="team-name">{fixture.away_team_name?.replace(/-/g, ' ')}</span>
          </div>
          {fixture.away_score !== null && fixture.away_score !== undefined && (
            <span className="team-score">{fixture.away_score}</span>
          )}
        </div>
      </div>

      {/* Match State Banners */}
      {isLive && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#dc2626' }}>
            🔴 LIVE {fixture.match_minute ? `${fixture.match_minute}'` : ''}
          </span>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#dc2626' }}>
            Score: {fixture.home_score ?? 0} - {fixture.away_score ?? 0}
          </span>
        </div>
      )}

      {isFinished && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
            FULL TIME
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
            Final: {fixture.home_score ?? 0} - {fixture.away_score ?? 0}
          </span>
        </div>
      )}

      {/* Meta Footer */}
      <div className="card-footer">
        <span className="kickoff-time">
          {dateStr} • {timeStr} WAT
        </span>
        <span className="status-badge">
          {fixture.status?.toUpperCase() || 'SCHEDULED'}
        </span>
      </div>

      {/* Prediction Summary Strip */}
      <div
        className="fixture-prediction-summary"
        onClick={onToggleExpand}
        title="Click to expand calibrated probabilistic breakdown"
      >
        <div className="summary-left-group">
          {isDataUnavailable ? (
            <span className="data-unavailable-pill" title="Skipped to prevent hallucination">
              🛡️ Data Unavailable - Skipped
            </span>
          ) : isLocked ? (
            <div className="paywall-lock-badge-wrap">
              <span className="paywall-locked-pill">
                🔒 Premium Pick Locked (₦5,000/mo)
              </span>
              <Link
                to="/subscription"
                className="paywall-unlock-link-btn"
                onClick={(e) => e.stopPropagation()}
              >
                Unlock Pick →
              </Link>
            </div>
          ) : hasPrediction ? (
            <span
              className={`top-signal-badge ${tierConfig.badgeClass}`}
              style={{ color: tierConfig.textColor, borderColor: tierConfig.borderColor, background: tierConfig.bgColor }}
            >
              {isNoBanker ? (
                <>🛡 NO SAFE BANKER: Pass Match (No market ≥80%)</>
              ) : (
                <>
                  {tierConfig.icon} {tierConfig.label}: {formatMarketName(prediction.market)} ({formatPredictionOutcome(prediction.prediction)})
                  {probPct ? ` - ${probPct}%` : ''}
                </>
              )}
            </span>
          ) : (
            <span className="summary-count-text">
              ⏱ Probability Simulation Queued
            </span>
          )}

          {/* Secondary Picks Indicator */}
          {!isLocked && secondaryList.length > 0 && (
            <span className="summary-secondary-chip" title="Alternative calibrated markets">
              +{secondaryList.length} Secondary Picks
            </span>
          )}

          {/* Settlement Badge */}
          {prediction && (isWon || isLost) && (
            <span className="summary-settle-chip">
              {isWon && <span style={{ color: '#16a34a' }}>✓ Won</span>}
              {isLost && <span style={{ color: '#dc2626' }}>✗ Lost</span>}
            </span>
          )}
        </div>

        <button
          type="button"
          className={`btn-expand-summary ${isExpanded ? 'expanded' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
        >
          {isExpanded ? (
            <>▲ Hide Breakdown</>
          ) : (
            <>▼ View Sniper Breakdown {secondaryList.length ? `(1 + ${secondaryList.length} Picks)` : ''}</>
          )}
        </button>
      </div>

      {/* Expandable Breakdown Body */}
      {isExpanded && (
        <div className="expanded-breakdown-body">
          {isDataUnavailable ? (
            <div className="data-unavailable-card">
              <div className="data-unavailable-icon">🛡️</div>
              <div className="data-unavailable-info">
                <h4>Data Unavailable — Hallucination Prevented</h4>
                <p>
                  This fixture was evaluated by our scrapers, but verified real stats/odds were not available across official multi-sources.
                  Per JamBets' <strong>Zero-Hallucination Policy</strong>, synthetic fallbacks are strictly forbidden, and this match was passed to protect your capital.
                </p>
              </div>
            </div>
          ) : isLocked ? (
            /* CRITICAL DIRECTIVE 3: PAYWALL UI BLURRED LOCK STATE */
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
                      <span className="sniper-prob-val">9X.X%</span>
                      <span className="sniper-prob-label">Simulated Probability</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="paywall-overlay-prompt">
                <div className="paywall-lock-icon">🔒</div>
                <h4>Premium Pick - Upgrade to Standard/VIP to View</h4>
                <p>
                  High-probability Banker consensus (80%+), Top Pick, and Banger (96%+) signals are protected for active members.
                </p>
                <Link to="/subscription" className="btn-paywall-unlock-prominent">
                  ⚡ Unlock with Standard Plan (₦5,000/mo) →
                </Link>
              </div>
            </div>
          ) : hasPrediction ? (
            <div className="prediction-panel">
              <div className="prediction-panel-header">
                <div className="sim-verified-pill">
                  <span className="dot"></span>
                  <span>Exact 250,000 Draws Verified • Sniper Engine</span>
                </div>
                <span className="model-tag">
                  PCG64 • Dixon-Coles
                </span>
              </div>

              {/* Primary Prediction Card */}
              {isNoBanker ? (
                <div
                  className="sniper-primary-card"
                  style={{ borderColor: 'var(--tier-no-banker-border)', background: 'var(--tier-no-banker-bg)' }}
                >
                  <div className="sniper-primary-badge-row">
                    <span className="sniper-primary-title" style={{ color: 'var(--tier-no-banker-text)' }}>
                      🛡 VOLATILE TOSS-UP — ANTI-LOSS PROTECTION
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {isVoid && <span className="badge-settled-void">⊘ VOID</span>}
                      <span className="tier-badge tier-no-banker">
                        🛡 NO SAFE BANKER
                      </span>
                    </div>
                  </div>

                  <div className="sniper-primary-main">
                    <div className="sniper-market-outcome">
                      <span className="sniper-market-name">Banker Standard (≥ 80.00%)</span>
                      <span className="sniper-outcome-val" style={{ color: '#475569' }}>SKIP / PASS MATCH</span>
                    </div>
                    <div className="sniper-prob-group">
                      <span className="sniper-prob-val" style={{ color: '#64748b' }}>PROTECTED</span>
                      <span className="sniper-prob-label">Anti-Loss Guard</span>
                    </div>
                  </div>

                  <div style={{ padding: '8px 12px', background: '#ffffff', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, color: '#475569', lineHeight: 1.5, marginTop: 4 }}>
                    ⚠️ <strong>Sniper Protection:</strong> No single market in this fixture achieved the strict <strong>≥ 80.00% banker certainty floor</strong> across 250,000 simulations. JamBets advises passing on this match to protect capital.
                  </div>

                  {prediction.settlement_notes && (
                    <div className={`settle-reason-tag ${isWon ? 'won' : ''}`}>
                      <strong>Settlement:</strong> {prediction.settlement_notes}
                    </div>
                  )}
                </div>
              ) : (
                <div className="sniper-primary-card">
                  <div className="sniper-primary-badge-row">
                    <span className="sniper-primary-title">
                      🎯 PRIMARY PREDICTION (TOP BANKER)
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {isWon && <span className="badge-settled-won">✓ WON</span>}
                      {isLost && <span className="badge-settled-lost">✗ LOST</span>}
                      {isVoid && <span className="badge-settled-void">⊘ VOID</span>}
                      {isPending && <span className="badge-settled-pending">⏳ PENDING</span>}
                      <span
                        className={`tier-badge ${tierConfig.badgeClass}`}
                        style={{ color: tierConfig.textColor, borderColor: tierConfig.borderColor, background: tierConfig.bgColor }}
                      >
                        {tierConfig.icon} {tierConfig.label}
                      </span>
                    </div>
                  </div>

                  <div className="sniper-primary-main">
                    <div className="sniper-market-outcome">
                      <span className="sniper-market-name">{formatMarketName(prediction.market)}</span>
                      <span className="sniper-outcome-val">{formatPredictionOutcome(prediction.prediction)}</span>
                    </div>
                    <div className="sniper-prob-group">
                      <span className="sniper-prob-val" style={{ color: tierConfig.textColor }}>
                        {probPct}%
                      </span>
                      <span className="sniper-prob-label">Simulated Probability</span>
                    </div>
                  </div>

                  <div className="pred-bar-container" style={{ height: 8 }}>
                    <div
                      className="pred-bar-fill"
                      style={{
                        width: `${Math.min(100, Number(probPct) || 0)}%`,
                        background: tierConfig.borderColor
                      }}
                    />
                  </div>

                  {prediction.settlement_notes && (
                    <div className={`settle-reason-tag ${isWon ? 'won' : ''}`}>
                      <strong>Settlement:</strong> {prediction.settlement_notes}
                    </div>
                  )}
                </div>
              )}

              {/* CRITICAL DIRECTIVE 4: SECONDARY PREDICTIONS RENDER */}
              {secondaryList.length > 0 && (
                <div className="secondary-predictions-section">
                  <div className="secondary-predictions-header">
                    <span className="secondary-section-title">
                      📦 SECONDARY SIGNALS (QUALIFYING ≥60% LEANS — MAX 4)
                    </span>
                    <span className="secondary-section-desc">
                      Alternative high-probability outcomes evaluated from 250,000 simulations
                    </span>
                  </div>

                  <div className="secondary-predictions-grid">
                    {secondaryList.map((sec, idx) => {
                      const secTier = getTierConfig(sec.confidence_tier || sec.confidence_category || 'MID_CONFIDENCE');
                      const secProb = sec.probability != null
                        ? sec.probability
                        : sec.prob != null ? sec.prob : 0;
                      const secPct = (secProb <= 1 ? secProb * 100 : secProb).toFixed(1);

                      return (
                        <div key={idx} className="secondary-pred-card">
                          <div className="secondary-card-top">
                            <div className="secondary-rank-market">
                              <span className="secondary-rank-badge">
                                {isNoBanker ? `Lean #${idx + 1}` : `#${idx + 2}`}
                              </span>
                              <span className="secondary-market-name">{formatMarketName(sec.market)}</span>
                            </div>
                            <span
                              className={`tier-badge ${secTier.badgeClass}`}
                              style={{ fontSize: 9, padding: '1px 5px', color: secTier.textColor, background: secTier.bgColor, borderColor: secTier.borderColor }}
                            >
                              {secTier.icon} {secTier.label}
                            </span>
                          </div>

                          <div className="secondary-card-mid">
                            <span className="secondary-outcome-val">{formatPredictionOutcome(sec.prediction)}</span>
                            <span className="secondary-prob-val" style={{ color: secTier.textColor }}>{secPct}%</span>
                          </div>

                          <div className="pred-bar-container" style={{ height: 4 }}>
                            <div
                              className="pred-bar-fill"
                              style={{
                                width: `${Math.min(100, Number(secPct) || 0)}%`,
                                background: secTier.borderColor
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 10, padding: '12px 16px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              ⏱ Mathematical simulation in queue. Quantitative Dixon-Coles parameters will generate before kickoff.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
