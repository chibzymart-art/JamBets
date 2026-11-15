import { useEffect, useState } from 'react';
import { useUserTimeZone } from '../../lib/dateUtils';
import { fetchMyFootballPicks } from './banterApi';
import { fetchMyTennisPicks } from './banterTennisApi';
import { STATUS_TEXT, footballRow, mergePickRows, tennisRow, type PickRow } from './banterPickRows';
import './banter.css';

/** The member's own picks for the last 60 days, every sport: pending first, then settled. */
export function BanterMyPicks() {
  const { timeZone } = useUserTimeZone();
  const [rows, setRows] = useState<PickRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([fetchMyFootballPicks(null, timeZone), fetchMyTennisPicks(null, timeZone)]).then(([f, t]) => {
      if (!live) return;
      if (!f.ok) { setError(true); setRows([]); return; }
      // Tennis may not be switched on yet: show football alone rather than an error.
      const tennis = t.ok ? (t.data || []).map(tennisRow) : [];
      setRows(mergePickRows([...(f.data || []).map(footballRow), ...tennis]));
    });
    return () => { live = false; };
  }, [timeZone]);

  if (rows === null) return <p className="bh-muted" aria-busy="true">Loading your picks…</p>;
  if (error) return <p className="bh-error" role="alert">Couldn't load your picks. Please try again.</p>;
  if (rows.length === 0) {
    return (
      <div className="bh-card bh-empty">
        <p>You haven't made any calls yet. Open Today and pick a match.</p>
      </div>
    );
  }

  const pending = rows.filter((p) => p.status === 'pending');
  const settled = rows.filter((p) => p.status !== 'pending');

  const row = (p: PickRow) => (
    <article key={p.id} className={`bh-card bh-pick bh-pick--${p.status}`}>
      <div className="bh-meta">
        <span>{p.meta}</span>
        <span>{new Date(p.kickoff_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}</span>
      </div>
      <div className="bh-teams">
        <span>{p.left}</span>
        <span className="bh-vs">{p.score || 'vs'}</span>
        <span className="bh-right">{p.right}</span>
      </div>
      <div className="bh-pick-line">
        <div>
          <div className="bh-mkt-label">{p.market}</div>
          <b>{p.pick}</b>
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
