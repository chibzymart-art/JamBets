import React from 'react';
import { UnifiedMarketPrediction } from '../lib/marketFeedService';
import { FavoritePredictionItem } from './FavoritesDrawer';
import { formatClubName } from './GoalCard';
import { formatKickoff } from '../lib/dateUtils';
import { PredictionGlance } from './PredictionGlance';

export interface SpecialistMarketCardProps {
  prediction: UnifiedMarketPrediction;
  isFavorite?: boolean;
  onToggleFavorite?: (item: FavoritePredictionItem) => void;
  onOpenUpgrade?: () => void;
  isAdmin?: boolean;
  isPaidUser?: boolean;
  isVisitor?: boolean;
  isTrialExpired?: boolean;
  onOpenAuth?: (mode: 'signin' | 'register') => void;
}

export const SpecialistMarketCard: React.FC<SpecialistMarketCardProps> = ({
  prediction,
  isFavorite = false,
  onToggleFavorite,
  onOpenUpgrade,
  isAdmin = false,
  isPaidUser = false,
  isVisitor = false,
  isTrialExpired = false,
  onOpenAuth,
}) => {
  const { fixture, metrics, is_locked: rawIsLocked } = prediction;
  const isLocked = (!isAdmin && !isPaidUser) || Boolean(rawIsLocked);
  const homeName = formatClubName(fixture?.home_team?.short_name || fixture?.home_team?.name || 'Home Club');
  const awayName = formatClubName(fixture?.away_team?.short_name || fixture?.away_team?.name || 'Away Club');
  const leagueName = fixture?.league?.name || fixture?.league?.code || 'Football';
  const kickoffStr = prediction.target_kickoff_at || fixture?.target_kickoff_at;

  // Format Kickoff dynamically in visitor's local timezone
  const timeFormatted = (() => {
    if (!kickoffStr) return { time: 'Upcoming', date: '' };
    try {
      const res = formatKickoff(kickoffStr);
      return { time: res.fullFormatted, date: res.dateStr };
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

    return null;
  })();

  const [isExpanded, setIsExpanded] = React.useState(false);

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
    <div className={`specialist-market-card ${isLocked ? 'is-freemium-locked' : ''} ${isSettled ? `settled-${prediction.settlement_status}` : ''}`}>
      {/* CARD HEADER (shared prototype layout); scout notes, gauge and telemetry open in View More */}
      <div onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer' }}>
        <PredictionGlance
          venue={fixture?.venue || null}
          league={`🏆 ${leagueName}`}
          leagueTitle={leagueName}
          time={`⏰ ${timeFormatted.time}${timeFormatted.date ? ` • ${timeFormatted.date}` : ''}`}
          statusChip={
            isLive
              ? { kind: 'live', text: period === 'HT' ? 'HALF TIME' : `LIVE ${minute ? `${minute}'` : ''}` }
              : isFinished
              ? { kind: 'final', text: 'FULL TIME' }
              : null
          }
          home={homeName}
          away={awayName}
          centerScore={
            isLive
              ? `${fixture?.home_score ?? 0} - ${fixture?.away_score ?? 0}`
              : isFinished && hasFtScore
              ? `${ftHome} - ${ftAway}`
              : null
          }
          isLive={isLive}
          tierLabel={!isLocked && prediction.confidence_tier ? prediction.confidence_tier.replace(/_/g, ' ') : null}
          tierClassName={`confidence-tier-pill tier-${prediction.confidence_tier?.toLowerCase()}`}
          settle={isSettled && !isLocked ? (isWon ? 'won' : isLost ? 'lost' : 'void') : null}
          marketLabel={`${prediction.market_icon} ${prediction.market_label}`}
          pick={
            isLocked
              ? `🔒 ${isVisitor ? 'Register to unlock' : 'VIP calibrated signal'}`
              : prediction.prediction === 'Home Win'
              ? '🏠 Home Win (1)'
              : prediction.prediction === 'Away Win'
              ? '✈️ Away Win (2)'
              : prediction.prediction
          }
          locked={isLocked}
          lockedCta={
            isVisitor ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenAuth) onOpenAuth('register');
                  else onOpenUpgrade?.();
                }}
              >
                Register to view →
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenUpgrade?.();
                }}
              >
                Subscribe →
              </button>
            )
          }
          scoreText={!isLocked && prediction.display_probability !== null ? `${prediction.display_probability}%` : null}
          scoreSub={!isLocked && prediction.display_probability !== null ? 'edge conf.' : null}
          slip={!isLocked && onToggleFavorite ? { active: isFavorite, onClick: handleFavoriteClick } : null}
          expanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
        />
      </div>

      {/* Locked explanation (shown in View More) */}
      {isExpanded && isLocked && (
        <div className="pg-detail-row">
          {isVisitor
            ? 'Register for a 3-day free trial to view Oddsbanta AI predictions'
            : isTrialExpired
            ? 'Free trial expired. Subscribe to Oddsbanta VIP to view calibrated signals'
            : 'Monte Carlo edge & high-conviction mathematical pick locked'}
        </div>
      )}

      {/* Settled Prediction-Specific Outcome Score Bar */}
      {isExpanded && !isLocked && isFinished && predictionOutcomeDetail && (
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

      {/* AI Tactical Scout Written Analysis (Just like in early Over 2.5 & 1H 0.5 versions) */}
      {isExpanded && !isLocked && prediction.tactical_rationale && (
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

      {/* Main Prediction & Probability Section (gauge and telemetry, shown in View More) */}
      {isExpanded && !isLocked && (
      <div className="card-prediction-container">
          <>
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
              {prediction.market_category === 'corners' && (
                <>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">Projected Total</span>
                    <span className="telemetry-val">
                      {metrics.predicted_total_corners ? `${metrics.predicted_total_corners} Corners` : '8.5 Line'}
                    </span>
                  </div>
                  <div className="telemetry-pill">
                    <span className="telemetry-label">
                      {metrics.over_9_5_pct ? 'O7.5 / O8.5 / O9.5 Density' : 'O7.5 / O8.5 Density'}
                    </span>
                    <span className="telemetry-val">
                      {metrics.over_9_5_pct
                        ? `${metrics.over_7_5_pct || 74}% / ${metrics.over_8_5_pct || 66}% / ${metrics.over_9_5_pct}%`
                        : metrics.over_7_5_pct && metrics.over_8_5_pct
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
      </div>
      )}

    </div>
  );
};
