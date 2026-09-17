import React from 'react';
import { UnifiedMarketPrediction } from '../lib/marketFeedService';
import { FavoritePredictionItem } from './FavoritesDrawer';
import { formatClubName } from './GoalCard';

export interface SpecialistMarketCardProps {
  prediction: UnifiedMarketPrediction;
  isFavorite?: boolean;
  onToggleFavorite?: (item: FavoritePredictionItem) => void;
  onOpenUpgrade?: () => void;
  isAdmin?: boolean;
}

export const SpecialistMarketCard: React.FC<SpecialistMarketCardProps> = ({
  prediction,
  isFavorite = false,
  onToggleFavorite,
  onOpenUpgrade,
  isAdmin: _isAdmin = false,
}) => {
  const { fixture, metrics, is_locked } = prediction;
  const homeName = formatClubName(fixture?.home_team?.short_name || fixture?.home_team?.name || 'Home Club');
  const awayName = formatClubName(fixture?.away_team?.short_name || fixture?.away_team?.name || 'Away Club');
  const leagueName = fixture?.league?.name || fixture?.league?.code || 'Football';
  const kickoffStr = prediction.target_kickoff_at || fixture?.target_kickoff_at;

  // Format Kickoff in Lagos WAT (UTC+1)
  const timeFormatted = (() => {
    if (!kickoffStr) return { time: 'Upcoming', date: '' };
    try {
      const d = new Date(kickoffStr);
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
      const date = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Lagos',
        month: 'short',
        day: 'numeric',
      }).format(d);
      return { time: `${time} WAT`, date };
    } catch {
      return { time: 'Upcoming', date: '' };
    }
  })();

  // Match & Settlement Status
  const fixtureStatus = (fixture?.status || '').toLowerCase();
  const period = (fixture?.period || '').toUpperCase();
  const minute = fixture?.match_minute;

  const isLive =
    ['live', 'in_play', 'inplay', 'halftime', '1h', '2h', 'et', 'penalties'].includes(fixtureStatus) ||
    ['1H', 'HT', '2H', 'ET', 'LIVE'].includes(period) ||
    (minute !== null && minute !== undefined && minute > 0 && fixtureStatus !== 'finished');

  const isFinished =
    ['finished', 'ft', 'aet', 'pen'].includes(fixtureStatus) ||
    period === 'FT' ||
    Boolean(prediction.settled_at) ||
    ['won', 'lost', 'void'].includes(prediction.settlement_status);

  const isSettled = ['won', 'lost', 'void'].includes(prediction.settlement_status);
  const isWon = prediction.settlement_status === 'won';
  const isLost = prediction.settlement_status === 'lost';

  // Full-time final score display
  const ftHome = fixture?.home_score ?? (prediction.actual_score ? prediction.actual_score.split('-')[0]?.trim() : null);
  const ftAway = fixture?.away_score ?? (prediction.actual_score ? prediction.actual_score.split('-')[1]?.trim() : null);
  const hasFtScore = ftHome !== null && ftAway !== null && ftHome !== undefined && ftAway !== undefined;

  // Prediction-specific score & breakdown (HT score, total corners, total goals, etc.)
  const predictionOutcomeDetail = (() => {
    if (!isFinished && !isSettled) return null;

    // 1. 1H Blitz (First Half Over 0.5 Goals)
    if (
      prediction.market === 'ht_over_0.5_goals' ||
      prediction.prediction.toLowerCase().includes('1h') ||
      prediction.prediction.toLowerCase().includes('first half')
    ) {
      const htScore =
        prediction.ht_score ||
        (fixture?.half_time_home_score !== null &&
        fixture?.half_time_away_score !== null &&
        fixture?.half_time_home_score !== undefined &&
        fixture?.half_time_away_score !== undefined
          ? `${fixture.half_time_home_score}-${fixture.half_time_away_score}`
          : null);

      return {
        label: '1H Score',
        value: htScore ? `HT ${htScore}` : isWon ? 'Goal in 1H' : '0-0 at HT',
        detail: 'Half-Time Score',
      };
    }

    // 2. Over 2.5 Goals
    if (
      prediction.market === 'over_2.5_goals' ||
      prediction.prediction.toLowerCase().includes('over 2.5')
    ) {
      const hScore =
        fixture?.home_score ??
        (prediction.actual_score ? parseInt(prediction.actual_score.split('-')[0], 10) : null);
      const aScore =
        fixture?.away_score ??
        (prediction.actual_score ? parseInt(prediction.actual_score.split('-')[1], 10) : null);

      if (hScore !== null && aScore !== null && !isNaN(hScore) && !isNaN(aScore)) {
        const total = hScore + aScore;
        return {
          label: 'Total Goals',
          value: `${total} Goals`,
          detail: total >= 3 ? 'Over 2.5 Threshold Exceeded' : 'Under 2.5 Threshold',
        };
      }
      return null;
    }

    // 3. Corners Specialist
    if (prediction.market_category === 'corners' || prediction.market === 'corners') {
      const cornersCount =
        prediction.actual_corners ||
        (fixture?.corners_home !== null &&
        fixture?.corners_away !== null &&
        fixture?.corners_home !== undefined &&
        fixture?.corners_away !== undefined
          ? fixture.corners_home + fixture.corners_away
          : null);

      if (cornersCount) {
        const displayVal =
          typeof cornersCount === 'string' && cornersCount.toLowerCase().includes('corner')
            ? cornersCount
            : `${cornersCount} Corners`;

        const cornerDetail =
          fixture?.corners_home !== null &&
          fixture?.corners_away !== null &&
          fixture?.corners_home !== undefined &&
          fixture?.corners_away !== undefined
            ? `(${fixture.corners_home} Home - ${fixture.corners_away} Away)`
            : 'Match Set-Pieces';

        return {
          label: 'Total Corners',
          value: displayVal,
          detail: cornerDetail,
        };
      }
      return null;
    }

    // 4. Match Winner / Draw (Home Win / Away Win / Draw)
    if (['home_win', 'away_win', 'draw'].includes(prediction.market_category)) {
      const finalScore =
        prediction.actual_score ||
        (fixture?.home_score !== null &&
        fixture?.away_score !== null &&
        fixture?.home_score !== undefined &&
        fixture?.away_score !== undefined
          ? `${fixture.home_score}-${fixture.away_score}`
          : null);

      if (finalScore) {
        const [h, a] = finalScore.split('-').map(Number);
        let outcomeLabel = 'Draw (X)';
        if (h > a) outcomeLabel = 'Home Win (1)';
        else if (a > h) outcomeLabel = 'Away Win (2)';

        return {
          label: 'Outcome',
          value: outcomeLabel,
          detail: `Final: ${finalScore}`,
        };
      }
    }

    return null;
  })();

  // Simulated Decimal Odds estimation from calibrated probability
  const estimatedOdds = prediction.probability
    ? Math.max(1.15, Number((1 / prediction.probability).toFixed(2)))
    : null;

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleFavorite) return;
    const favoriteItem: FavoritePredictionItem = {
      id: `${prediction.fixture_id}::${prediction.market}::${prediction.prediction}`,
      fixtureId: prediction.fixture_id,
      homeTeam: homeName,
      awayTeam: awayName,
      league: leagueName,
      targetKickoffAt: kickoffStr || new Date().toISOString(),
      market: prediction.market_label,
      prediction: prediction.prediction,
      probability: prediction.probability || 0.7,
      confidenceCategory: prediction.confidence_category,
    };
    onToggleFavorite(favoriteItem);
  };

  return (
    <div className={`specialist-market-card ${is_locked ? 'is-freemium-locked' : ''} ${isSettled ? `settled-${prediction.settlement_status}` : ''}`}>
      {/* Top Card Header */}
      <div className="card-top-row">
        <div className="card-league-badge">
          <span className="league-icon">🏆</span>
          <span className="league-text">{leagueName}</span>
        </div>

        <div className="card-time-status">
          {isLive ? (
            <span className="live-match-pill">
              <span className="live-pulsing-dot" />
              <span>{period === 'HT' ? 'HALF TIME' : `LIVE ${minute ? `${minute}'` : ''}`}</span>
            </span>
          ) : isSettled ? (
            <span className={`settle-status-pill ${isWon ? 'won' : isLost ? 'lost' : 'void'}`}>
              {isWon ? '✓ WON' : isLost ? '✕ LOST' : '⟲ VOID'}
            </span>
          ) : (
            <span className="kickoff-time-pill">
              <span className="time-clock">⏰</span>
              <span>{timeFormatted.time}</span>
              {timeFormatted.date && <span className="time-dot">• {timeFormatted.date}</span>}
            </span>
          )}
        </div>
      </div>

      {/* Match Competitors Header */}
      <div className="card-matchup-row">
        <div className="team-box home-box">
          <span className="team-name">{homeName}</span>
        </div>

        <div className="vs-center-box">
          {isLive ? (
            <div className="live-score-badge is-live" title="Match In-Play">
              <span className="live-score-text">
                {fixture?.home_score ?? 0} - {fixture?.away_score ?? 0}
              </span>
            </div>
          ) : isFinished && hasFtScore ? (
            <div className="ft-score-badge" title="Full-Time Official Result">
              <span className="ft-tag">FT</span>
              <span className="ft-score-text">
                {ftHome} - {ftAway}
              </span>
            </div>
          ) : (
            <span className="vs-badge">VS</span>
          )}
        </div>

        <div className="team-box away-box">
          <span className="team-name">{awayName}</span>
        </div>
      </div>

      {/* Settled Prediction-Specific Outcome Score Bar */}
      {isFinished && predictionOutcomeDetail && (
        <div className={`settled-outcome-bar ${isWon ? 'is-won' : isLost ? 'is-lost' : 'is-void'}`}>
          <div className="outcome-metric-left">
            <span className="outcome-icon">{isWon ? '🎯' : '📊'}</span>
            <span className="outcome-label">{predictionOutcomeDetail.label}:</span>
            <span className="outcome-val">{predictionOutcomeDetail.value}</span>
          </div>
          <div className="outcome-metric-right">
            <span className="outcome-ft-reference">{predictionOutcomeDetail.detail}</span>
          </div>
        </div>
      )}

      {/* Specialist Engine Banner */}
      <div className="card-engine-bar">
        <div className="engine-identity">
          <span className="engine-icon">{prediction.market_icon}</span>
          <span className="engine-label">{prediction.market_label}</span>
        </div>

        {!is_locked && (
          <span className={`confidence-tier-pill tier-${prediction.confidence_tier?.toLowerCase()}`}>
            {prediction.confidence_tier?.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* AI Tactical Scout Written Analysis (Just like in early Over 2.5 & 1H 0.5 versions) */}
      {prediction.tactical_rationale && (
        <div className="specialist-ai-scout-banner">
          <span className="scout-icon">🤖</span>
          <div className="scout-content">
            <span className="scout-tag">
              AI Tactical Scout {prediction.tactical_tag ? `[${prediction.tactical_tag.replace(/_/g, ' ')}]` : ''}:
            </span>
            <span className="scout-rationale">{prediction.tactical_rationale}</span>
          </div>
        </div>
      )}

      {/* Main Prediction & Probability Section */}
      <div className="card-prediction-container">
        {is_locked ? (
          /* Frosted Freemium Paywall Mask */
          <div className="freemium-locked-overlay">
            <div className="locked-mask-content">
              <div className="locked-icon-shield">🔒</div>
              <div className="locked-title-text">VIP CALIBRATED SIGNAL</div>
              <div className="locked-sub-text">
                Monte Carlo edge & high-conviction mathematical pick locked
              </div>
              <button
                type="button"
                className="locked-unlock-cta-btn"
                onClick={onOpenUpgrade}
              >
                <span>⚡ Unlock for ₦5,000</span>
                <span className="arrow-chip">→</span>
              </button>
            </div>
          </div>
        ) : (
          /* Unlocked High-Conviction Intelligence Display */
          <>
            <div className="prediction-headline-row">
              <div className="prediction-pick-wrap">
                <span className="pick-prefix">CALIBRATED PICK:</span>
                <span className="pick-value">{prediction.prediction}</span>
              </div>

              {prediction.display_probability !== null && (
                <div className="probability-metric-box">
                  <span className="prob-pct">{prediction.display_probability}%</span>
                  <span className="prob-sub">Edge Conf.</span>
                </div>
              )}
            </div>

            {/* Glowing Probability Gauge Bar */}
            {prediction.display_probability !== null && (
              <div className="probability-bar-track">
                <div
                  className="probability-bar-fill"
                  style={{
                    width: `${Math.min(100, Math.max(10, prediction.display_probability))}%`,
                    background:
                      prediction.display_probability >= 75
                        ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                        : prediction.display_probability >= 60
                        ? 'linear-gradient(90deg, #38bdf8 0%, #0284c7 100%)'
                        : 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)',
                  }}
                />
              </div>
            )}

            {/* Engine-Specific Telemetry Metrics Grid */}
            <div className="engine-telemetry-grid">
              {prediction.market_category === 'home_win' && (
                <>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">Venue Dominance</span>
                    <span className="telemetry-val">
                      {metrics.home_venue_advantage ? `+${(metrics.home_venue_advantage * 100).toFixed(0)}% Fortress` : 'High Edge'}
                    </span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">Home Clean Sheet</span>
                    <span className="telemetry-val">
                      {metrics.home_clean_sheet_prob ? `${(metrics.home_clean_sheet_prob * 100).toFixed(0)}%` : 'Calibrated'}
                    </span>
                  </div>
                </>
              )}

              {prediction.market_category === 'away_win' && (
                <>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">Road Counter Rating</span>
                    <span className="telemetry-val">
                      {metrics.away_counter_efficiency ? `${(metrics.away_counter_efficiency * 100).toFixed(0)}% Press Speed` : 'High Speed'}
                    </span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">Away Clean Sheet</span>
                    <span className="telemetry-val">
                      {metrics.away_clean_sheet_prob ? `${(metrics.away_clean_sheet_prob * 100).toFixed(0)}%` : 'Solid Box'}
                    </span>
                  </div>
                </>
              )}

              {prediction.market_category === 'draw' && (
                <>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">Tactical Equilibrium</span>
                    <span className="telemetry-val">
                      {metrics.tactical_equilibrium_score ? `${(metrics.tactical_equilibrium_score * 100).toFixed(0)}% Parity` : 'Symmetric'}
                    </span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">0-0 / 1-1 Density</span>
                    <span className="telemetry-val">
                      {metrics.low_scoring_density ? `${(metrics.low_scoring_density * 100).toFixed(0)}% Joint Prob` : 'High Low-xG'}
                    </span>
                  </div>
                </>
              )}

              {prediction.market_category === 'corners' && (
                <>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">Projected Total</span>
                    <span className="telemetry-val">
                      {metrics.predicted_total_corners ? `${metrics.predicted_total_corners} Corners` : '8.5 Line'}
                    </span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">O7.5 / O8.5 Density</span>
                    <span className="telemetry-val">
                      {metrics.over_7_5_pct && metrics.over_8_5_pct
                        ? `${metrics.over_7_5_pct}% / ${metrics.over_8_5_pct}%`
                        : metrics.over_7_5_prob && metrics.over_8_5_prob
                        ? `${Math.round(metrics.over_7_5_prob * 100)}% / ${Math.round(metrics.over_8_5_prob * 100)}%`
                        : prediction.display_probability !== null
                        ? `${prediction.display_probability}% / ${Math.max(50, prediction.display_probability - 8)}%`
                        : '74% / 66%'}
                    </span>
                  </div>
                </>
              )}

              {prediction.market_category === 'goals' && (
                <>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">Expected Goals</span>
                    <span className="telemetry-val">
                      {metrics.xg_combined ? `${metrics.xg_combined.toFixed(2)} xG` : 'High Pace'}
                    </span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">1H Press Intensity</span>
                    <span className="telemetry-val">
                      {metrics.ht_goal_frequency ? `${(metrics.ht_goal_frequency * 100).toFixed(0)}% First Half` : 'Early Strike'}
                    </span>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action Footer: + Add to Acca Slip Button */}
      <div className="card-action-footer">
        <div className="action-left-info">
          {estimatedOdds && !is_locked && (
            <span className="estimated-odds-tag">
              Est. Odds: <strong>{estimatedOdds}</strong>
            </span>
          )}
        </div>

        {!is_locked && (
          <button
            type="button"
            className={`add-to-acca-btn ${isFavorite ? 'in-slip' : ''}`}
            onClick={handleFavoriteClick}
            title={isFavorite ? 'Remove from Acca Slip' : 'Add to Acca Slip'}
          >
            <span className="btn-icon">{isFavorite ? '✓' : '+'}</span>
            <span className="btn-label">{isFavorite ? 'In Acca Slip' : 'Add to Acca Slip'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
