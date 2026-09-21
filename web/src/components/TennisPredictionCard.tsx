import React from 'react';
import { TennisPrediction, TennisSurface } from '../types/tennis';

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
  const { fixture, is_locked } = prediction;
  const tournament = fixture?.tournament;
  const player1 = fixture?.player1;
  const player2 = fixture?.player2;

  const tour = (tournament?.tour || 'ATP').toUpperCase();
  const surface: TennisSurface = tournament?.surface || 'hard_outdoor';
  const cpi = tournament?.court_pace_index ?? 35;

  // Format surface label and icon
  const surfaceMeta = (() => {
    switch (surface) {
      case 'clay':
        return { label: 'Clay Court', icon: '🧱', className: 'clay' };
      case 'grass':
        return { label: 'Grass Court', icon: '🌱', className: 'grass' };
      case 'hard_indoor':
        return { label: 'Indoor Hard', icon: '🏟️', className: 'hard_indoor' };
      case 'hard_outdoor':
      default:
        return { label: 'Hard Court', icon: '🏢', className: 'hard_outdoor' };
    }
  })();

  // CPI classification
  const cpiMeta = (() => {
    if (cpi >= 40) return { speed: 'Fast Pace', class: 'fast' };
    if (cpi <= 31) return { speed: 'Slow Pace', class: 'slow' };
    return { speed: 'Medium Pace', class: 'medium' };
  })();

  // Surface-specific ELO extraction
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

  // ELO distribution percentage
  const totalElo = p1Elo + p2Elo;
  const p1EloPercent = totalElo > 0 ? Math.round((p1Elo / totalElo) * 100) : 50;
  const p2EloPercent = 100 - p1EloPercent;

  // Kickoff formatting in Lagos WAT (UTC+1)
  const kickoffStr = prediction.target_kickoff_at || fixture?.target_kickoff_at;
  const timeFormatted = (() => {
    if (!kickoffStr) return { time: 'Scheduled', date: '' };
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
      return { time: 'Scheduled', date: '' };
    }
  })();

  const isLive = fixture?.status === 'live';
  const isFinished = fixture?.status === 'finished' || fixture?.status === 'retired';

  // Confidence Tier styling
  const tier = (prediction.confidence_category || '').toUpperCase();
  const tierClass = (() => {
    if (tier === 'BANGER') return 'banger';
    if (tier === 'TOP PICK') return 'top-pick';
    if (tier === 'HIGH CONFIDENCE') return 'high-conf';
    return 'no-banker';
  })();

  // Markov metrics
  const markov = prediction.metadata?.markov;
  const probabilityDisplay = prediction.probability ? `${(prediction.probability * 100).toFixed(1)}%` : null;

  return (
    <article className="tennis-card" aria-label={`Tennis match: ${player1?.display_name || 'P1'} vs ${player2?.display_name || 'P2'}`}>
      {/* CARD HEADER: Tournament, Tour, Round, Surface & CPI */}
      <div className="tennis-card-header">
        <div className="card-header-left">
          <span className={`tour-tag ${tour.toLowerCase()}`}>{tour}</span>
          <span className="tournament-title" title={tournament?.name || 'Tournament'}>
            {tournament?.name || 'ATP/WTA World Tour'}
          </span>
          {fixture?.round && <span className="round-badge">{fixture.round}</span>}
        </div>
        <div className="card-header-right">
          <span className={`surface-badge ${surfaceMeta.className}`}>
            <span>{surfaceMeta.icon}</span>
            <span>{surfaceMeta.label}</span>
          </span>
          <span className={`cpi-meter-pill ${cpiMeta.class}`} title={`Court Pace Index: ${cpi} (${cpiMeta.speed})`}>
            <span>CPI {cpi}</span>
          </span>
        </div>
      </div>

      {/* MATCHUP ROW: Players, Rankings, Surface ELOs, and Score */}
      <div className="tennis-matchup-box">
        {/* Player 1 */}
        <div className="competitor-row">
          <div className="competitor-left">
            {player1?.current_rank && (
              <span className="rank-badge" title={`World Rank #${player1.current_rank}`}>
                #{player1.current_rank}
              </span>
            )}
            <span className="competitor-name">{player1?.display_name || 'Player 1'}</span>
          </div>
          <div className="competitor-right">
            <span className="surface-elo-chip" title={`${surfaceMeta.label} Surface ELO`}>
              ⚡ {p1Elo} ELO
            </span>
            {isFinished && <span className="match-set-score">{fixture?.score_p1_sets ?? 0}</span>}
          </div>
        </div>

        {/* Player 2 */}
        <div className="competitor-row">
          <div className="competitor-left">
            {player2?.current_rank && (
              <span className="rank-badge" title={`World Rank #${player2.current_rank}`}>
                #{player2.current_rank}
              </span>
            )}
            <span className="competitor-name">{player2?.display_name || 'Player 2'}</span>
          </div>
          <div className="competitor-right">
            <span className="surface-elo-chip" title={`${surfaceMeta.label} Surface ELO`}>
              ⚡ {p2Elo} ELO
            </span>
            {isFinished && <span className="match-set-score">{fixture?.score_p2_sets ?? 0}</span>}
          </div>
        </div>

        {/* ELO Differential Comparison Bar */}
        <div className="elo-differential-container">
          <div className="elo-diff-header">
            <span>Surface ELO Differential</span>
            <span>
              {absDiff > 0 ? `Δ +${absDiff} (${leaderName.split(' ').pop()})` : 'Even Matchup'}
            </span>
          </div>
          <div className="elo-diff-bar" title={`P1: ${p1EloPercent}% vs P2: ${p2EloPercent}%`}>
            <div className="elo-diff-fill-p1" style={{ width: `${p1EloPercent}%` }} />
            <div className="elo-diff-fill-p2" style={{ width: `${p2EloPercent}%` }} />
          </div>
        </div>

        {/* Kickoff / Status Row */}
        <div className="tennis-status-row">
          <span className="kickoff-badge">
            <span>📅 {timeFormatted.date}</span>
            <span>•</span>
            <span>🕒 {timeFormatted.time}</span>
          </span>
          {isLive ? (
            <span className="match-live-chip">
              <span className="live-pulse-dot" /> LIVE IN-PLAY
            </span>
          ) : isFinished ? (
            <span className="match-status-pill finished">Final Result</span>
          ) : (
            <span className="match-status-pill upcoming">Upcoming Match</span>
          )}
        </div>
      </div>

      {/* 250k MONTE CARLO PREDICTION SECTION */}
      <div className="tennis-sim-section">
        <div className="sim-header-row">
          <span className="mc-badge">
            <span>🎲</span>
            <span>250,000 Monte Carlo Sims</span>
          </span>
          <span className={`tier-badge ${tierClass}`}>{tier || 'TOP PICK'}</span>
        </div>

        {/* SUBSCRIBER TIER PAYWALL GATE */}
        {is_locked && !isSubscriber ? (
          <div className="tennis-locked-teaser">
            <div className="locked-blur-preview">
              <div style={{ background: '#cbd5e1', height: '24px', width: '45%', borderRadius: '6px' }} />
              <div style={{ background: '#10b981', height: '24px', width: '25%', borderRadius: '6px' }} />
            </div>
            <div className="locked-cta-wrap">
              <div className="lock-shield-icon">🔒</div>
              <h4 className="locked-title">Subscriber-Only Prediction</h4>
              <p className="locked-subtext">
                Unlock calibrated win probability, game handicaps, and AI tactical reasoning.
              </p>
              <button
                type="button"
                className="tennis-unlock-btn"
                onClick={() => {
                  if (onOpenUpgrade) onOpenUpgrade();
                  else if (onOpenAuth) onOpenAuth('register');
                }}
              >
                ⚡ Unlock with Oddsbanta VIP
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* UNLOCKED: Primary Market & Probability */}
            <div className="tennis-primary-pick">
              <div>
                <span className="pick-market-lbl">
                  {prediction.market ? prediction.market.replace(/_/g, ' ') : 'Match Winner'}
                </span>
                <div className="pick-selection-val">{prediction.prediction}</div>
              </div>
              {probabilityDisplay && (
                <div className="pick-prob-box">
                  <span className="prob-val">{probabilityDisplay}</span>
                  <span className="prob-lbl">Sim Probability</span>
                </div>
              )}
            </div>

            {/* Secondary Predictions (Set Handicap / Total Games) */}
            {prediction.secondary_predictions && prediction.secondary_predictions.length > 0 && (
              <div className="secondary-picks-row">
                {prediction.secondary_predictions.map((sec, idx) => (
                  <span key={idx} className="secondary-chip">
                    <strong>{sec.market === 'set_handicap' ? 'Set HC:' : 'Total Games:'}</strong>
                    <span>{sec.pick}</span>
                    <span>({Math.round(sec.probability * 100)}%)</span>
                  </span>
                ))}
              </div>
            )}

            {/* Barnett-Clarke Markov Metrics Strip */}
            {markov && (
              <div className="markov-metrics-strip">
                <div className="markov-metric-box">
                  <span className="mm-val">{Math.round((markov.p_hold_player1 || 0.8) * 100)}%</span>
                  <span className="mm-lbl">P1 Hold Est.</span>
                </div>
                <div className="markov-metric-box">
                  <span className="mm-val">{Math.round((markov.p_hold_player2 || 0.8) * 100)}%</span>
                  <span className="mm-lbl">P2 Hold Est.</span>
                </div>
                <div className="markov-metric-box">
                  <span className="mm-val">
                    {(markov.dominance_ratio_player1 || 1.1).toFixed(2)} vs {(markov.dominance_ratio_player2 || 0.9).toFixed(2)}
                  </span>
                  <span className="mm-lbl">Dom. Ratio (DR)</span>
                </div>
              </div>
            )}

            {/* AI Tactical Narrative Breakdown */}
            {prediction.metadata?.ai_tactical_analysis && (
              <div className="tactical-narrative-box">
                <span className="tactical-icon">🧠</span>
                <div>{prediction.metadata.ai_tactical_analysis}</div>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
};
