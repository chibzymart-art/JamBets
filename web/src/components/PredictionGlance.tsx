import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import './prediction-glance.css';

/**
 * Shared collapsed view for prediction cards (football, tennis, basketball, goals, specialist markets).
 * Presentation only: every value, lock decision and handler comes from the parent card,
 * which keeps all of its existing paywall logic and its "View More" dropdown.
 *
 * Layout: league · time  /  home vs away  /  tier + pick | score  /  slip · View More
 */

export type GlanceSettle = 'won' | 'lost' | 'void' | 'passed' | 'live' | null;

export interface PredictionGlanceProps {
  league: ReactNode;
  leagueTitle?: string;
  /** Extra meta after the league name, e.g. tennis round. */
  leagueExtra?: ReactNode;
  time: ReactNode;
  /** When set, replaces the time chip on the right (e.g. "LIVE 63'" or "FT"). */
  statusChip?: { kind: 'live' | 'final'; text: ReactNode } | null;
  home: ReactNode;
  away: ReactNode;
  /** Fixture venue, shown under the teams. */
  venue?: ReactNode | null;
  /** Score shown between the teams (live or final). Falls back to "vs". */
  centerScore?: ReactNode | null;
  isLive?: boolean;
  tierLabel?: ReactNode;
  tierStyle?: CSSProperties;
  tierClassName?: string;
  settle?: GlanceSettle;
  /** Extra badges beside the tier (e.g. "NEW CHANGE"). */
  badges?: ReactNode;
  /** Market name shown above the pick, e.g. "Moneyline". */
  marketLabel?: ReactNode;
  pick: ReactNode;
  locked?: boolean;
  /** Call to action shown under a locked pick (button or link from the parent). */
  lockedCta?: ReactNode;
  /** Right column, e.g. "9.6/10". */
  scoreText?: ReactNode;
  /** Right column, second line, e.g. "84% probability". */
  scoreSub?: ReactNode;
  /** Optional slip button; omit to hide. */
  slip?: { active: boolean; onClick: (e: MouseEvent) => void } | null;
  /** Dropdown toggle; omit for cards without a dropdown. */
  expanded?: boolean;
  onToggle?: () => void;
}

const SETTLE_TEXT: Record<Exclude<GlanceSettle, null>, string> = {
  won: '✓ Won',
  lost: '✗ Lost',
  void: '⊘ Void',
  passed: '🛡️ Passed',
  live: '⚡ In play',
};

export function PredictionGlance(props: PredictionGlanceProps) {
  const {
    league, leagueTitle, leagueExtra, time, statusChip, home, away, venue, centerScore, isLive,
    tierLabel, tierStyle, tierClassName, settle, badges, marketLabel, pick, locked, lockedCta,
    scoreText, scoreSub, slip, expanded, onToggle,
  } = props;

  return (
    <div className="pg">
      <div className="pg-meta">
        <span className="pg-league" title={leagueTitle}>
          {league}
          {leagueExtra ? <span className="pg-league-extra"> · {leagueExtra}</span> : null}
        </span>
        {statusChip ? (
          <span className={`pg-chip ${statusChip.kind === 'live' ? 'pg-chip--live' : 'pg-chip--final'}`}>
            {statusChip.kind === 'live' && <span className="pg-live-dot" aria-hidden="true" />}
            {statusChip.text}
          </span>
        ) : (
          <span className="pg-chip">{time}</span>
        )}
      </div>

      <div className="pg-teams">
        <span className="pg-team">{home}</span>
        {centerScore != null ? (
          <span className={`pg-score-center ${isLive ? 'is-live' : ''}`}>{centerScore}</span>
        ) : (
          <span className="pg-vs">vs</span>
        )}
        <span className="pg-team pg-team--away">{away}</span>
      </div>

      {venue ? <div className="pg-venue">📍 {venue}</div> : null}

      <div className="pg-pick">
        <div className="pg-pick-left">
          {(tierLabel || settle || badges) && (
            <div className="pg-tags">
              {tierLabel && (
                <span className={`pg-tier ${tierClassName || ''}`} style={tierStyle}>
                  {tierLabel}
                </span>
              )}
              {settle && <span className={`pg-settle pg-settle--${settle}`}>{SETTLE_TEXT[settle]}</span>}
              {badges}
            </div>
          )}
          {marketLabel && <div className="pg-market">{marketLabel}</div>}
          <div className={`pg-pick-text ${locked ? 'is-locked' : ''}`}>{pick}</div>
          {locked && lockedCta ? <div className="pg-locked-cta">{lockedCta}</div> : null}
        </div>
        {(scoreText || scoreSub) && (
          <div className="pg-pick-right">
            {scoreText && <div className="pg-score">{scoreText}</div>}
            {scoreSub && <div className="pg-score-sub">{scoreSub}</div>}
          </div>
        )}
      </div>

      {(slip || onToggle) && (
        <div className="pg-actions">
          {slip ? (
            <button
              type="button"
              className={`pg-slip ${slip.active ? 'is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                slip.onClick(e);
              }}
              title={slip.active ? 'Remove from Acca Slip' : 'Add to Acca Slip'}
            >
              {slip.active ? '✓ In slip' : '+ Add to slip'}
            </button>
          ) : (
            <span />
          )}
          {onToggle && (
            <button
              type="button"
              className={`pg-toggle ${expanded ? 'is-expanded' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              aria-expanded={!!expanded}
            >
              {expanded ? 'View Less' : 'View More'}
              <span aria-hidden="true" className="pg-toggle-icon">{expanded ? '⌃' : '⌄'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
