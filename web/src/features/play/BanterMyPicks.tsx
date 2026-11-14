import { useEffect, useState } from 'react';
import { useUserTimeZone } from '../../lib/dateUtils';
import { fetchMyFootballPicks, type BanterPick } from './banterApi';
import { selectionLabel } from './banterRules';
import './banter.css';

const MARKET_NAME: Record<string, string> = { '1X2': 'Match result', OU25: 'Goals 2.5', BTTS: 'Both teams score' };
const STATUS_TEXT: Record<BanterPick['status'], string> = { pending: 'Pending', won: '✓ Won', lost: '✗ Lost', void: '⊘ Void' };

/** The member's own picks for the last 60 days: pending first, then settled (green won, red lost). */
export function BanterMyPicks() {
  const { timeZone } = useUserTimeZone();
  const [picks, setPicks] = useState<BanterPick[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMyFootballPicks(null, timeZone).then((r) => {
      if (!live) return;
      if (!r.ok) { setError(true); setPicks([]); return; }
      setPicks(r.data || []);
    });
    return () => { live = false; };
  }, [timeZone]);

  if (picks === null) return <p className="bh-muted" aria-busy="true">Loading your picks…</p>;
  if (error) return <p className="bh-error" role="alert">Couldn't load your picks. Please try again.</p>;
  if (picks.length === 0) {
    return (
      <div className="bh-card bh-empty">
        <p>You haven't made any calls yet. Open Today and pick a match.</p>
      </div>
    );
  }

  const pending = picks.filter((p) => p.status === 'pending');
  const settled = picks.filter((p) => p.status !== 'pending');

  const row = (p: BanterPick) => (
    <article key={p.id} className={`bh-card bh-pick bh-pick--${p.status}`}>
      <div className="bh-meta">
        <span>{p.league_country} · {p.league_name}</span>
        <span>{new Date(p.kickoff_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}</span>
      </div>
      <div className="bh-teams">
        <span>{p.home_team || 'Home'}</span>
        <span className="bh-vs">{p.home_score != null && p.away_score != null ? `${p.home_score} – ${p.away_score}` : 'vs'}</span>
        <span className="bh-right">{p.away_team || 'Away'}</span>
      </div>
      <div className="bh-pick-line">
        <div>
          <div className="bh-mkt-label">{MARKET_NAME[p.market] || p.market}</div>
          <b>{selectionLabel(p.market, p.selection, p.home_team || undefined, p.away_team || undefined)}</b>
        </div>
        <span className={`bh-status bh-status--${p.status}`}>
          {STATUS_TEXT[p.status]}
          {p.points != null && p.status !== 'pending' ? ` · ${p.points} pts` : ''}
        </span>
      </div>
    </article>
  );

  return (
    <div className="bh-mypicks">
      <div className="bh-sec"><h2>Pending</h2><small>{pending.length}</small></div>
      {pending.length ? <div className="bh-list">{pending.map(row)}</div> : <p className="bh-muted">No pending calls.</p>}
      <div className="bh-sec"><h2>Settled</h2><small>{settled.length}</small></div>
      {settled.length ? <div className="bh-list">{settled.map(row)}</div> : <p className="bh-muted">Settled calls show here after full time.</p>}
    </div>
  );
}
