import { useEffect, useState } from 'react';
import { fetchLeaderboard, type LeaderboardPeriod, type LeaderboardRow } from './banterApi';
import { BANTER_POINTS, formatPoints, splitLeaderboard } from './banterRules';
import './banter.css';

/**
 * Banter Hub leaderboard: members ranked by points from settled picks (paid members only).
 * Shows username, points, number of settled picks and hit rate. The member's own row is always shown.
 */

const LIMIT = 50;
const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

export function BanterLeaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(false);
    fetchLeaderboard(period, LIMIT).then((r) => {
      if (!live) return;
      if (!r.ok) { setError(true); setRows([]); return; }
      setRows(r.data || []);
    });
    return () => { live = false; };
  }, [period]);

  const { top, me } = splitLeaderboard(rows || [], LIMIT);

  const row = (r: LeaderboardRow) => (
    <li key={`${r.place}-${r.handle}`} className={`bh-lb-row ${r.is_me ? 'is-me' : ''}`}>
      <span className="bh-lb-place">{r.place}</span>
      <span className="bh-lb-avatar" aria-hidden="true">{r.avatar_emoji}</span>
      <span className="bh-lb-who">
        <b>{r.handle}{r.is_me ? ' (you)' : ''}</b>
        <small>{r.settled} picks · {r.won} won · {r.lost} lost{r.voided ? ` · ${r.voided} void` : ''}</small>
      </span>
      <span className="bh-lb-score">
        <b>{formatPoints(r.points)}</b>
        <small>{Number(r.hit_rate).toFixed(Number.isInteger(Number(r.hit_rate)) ? 0 : 1)}% hit</small>
      </span>
    </li>
  );

  return (
    <div className="bh-today">
      <div className="bh-seg" role="tablist" aria-label="Leaderboard period">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={period === p.id}
            className={`bh-seg-btn ${period === p.id ? 'is-active' : ''}`}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="bh-error" role="alert">Couldn't load the leaderboard. Please try again.</p>}

      {rows === null ? (
        <p className="bh-muted" aria-busy="true">Loading leaderboard…</p>
      ) : top.length === 0 && !me ? (
        <div className="bh-card bh-empty">
          <p>No settled picks {period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'yet'}. Make your calls on Today; points arrive after full time.</p>
        </div>
      ) : (
        <div className="bh-card bh-lb">
          <ol className="bh-lb-list">{top.map(row)}</ol>
          {me && (
            <>
              <div className="bh-lb-gap" aria-hidden="true">⋯</div>
              <ol className="bh-lb-list">{row(me)}</ol>
            </>
          )}
        </div>
      )}

      <p className="bh-note">
        Correct pick {formatPoints(BANTER_POINTS.won)}, wrong {formatPoints(BANTER_POINTS.lost)}, voided match {formatPoints(BANTER_POINTS.void)}.
        Ties go to hit rate. The week starts Monday 00:00 WAT.
      </p>
    </div>
  );
}
