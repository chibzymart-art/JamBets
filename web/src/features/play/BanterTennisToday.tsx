import { useCallback, useEffect, useState } from 'react';
import { getDateDetailsByOffset, useUserTimeZone } from '../../lib/dateUtils';
import { cancelTennisPick, fetchMyTennisPicks, fetchTennisMatches, submitTennisPick, type BanterTennisMatch } from './banterTennisApi';
import { lockLabel, pickErrorMessage } from './banterRules';
import './banter.css';

/**
 * Banter Hub tennis: pick the match winner on matches the main system has already predicted.
 * Same date strip and lock rules as football (picks close a minute before the start).
 */

const BACK_DAYS = 7;
const FORWARD_DAYS = 4;
const CHIPS = 4;

export function BanterTennisToday() {
  const { timeZone } = useUserTimeZone();
  const [offset, setOffset] = useState(0);
  const [start, setStart] = useState(-1);
  const date = getDateDetailsByOffset(offset, timeZone).iso;

  const [matches, setMatches] = useState<BanterTennisMatch[] | null>(null);
  const [mine, setMine] = useState<Record<string, 'p1' | 'p2'>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setMatches(null);
    setError(null);
    const [m, p] = await Promise.all([fetchTennisMatches(date, timeZone), fetchMyTennisPicks(date, timeZone)]);
    if (!m.ok || !p.ok) {
      const code = !m.ok ? m.code : !p.ok ? p.code : 'unknown';
      setError(code === 'not_ready' ? "Tennis picks aren't switched on yet. Please check back soon." : "Couldn't load matches. Please try again.");
      setMatches([]);
      return;
    }
    setMatches(m.data || []);
    const map: Record<string, 'p1' | 'p2'> = {};
    for (const x of p.data || []) map[x.fixture_id] = x.selection;
    setMine(map);
  }, [date, timeZone]);

  useEffect(() => {
    load();
  }, [load]);

  const pick = async (m: BanterTennisMatch, sel: 'p1' | 'p2') => {
    setBusy(m.fixture_id);
    setError(null);
    const current = mine[m.fixture_id];
    const res = current === sel ? await cancelTennisPick(m.fixture_id) : await submitTennisPick(m.fixture_id, sel);
    setBusy(null);
    if (!res.ok) { setError(pickErrorMessage(res.code)); return; }
    setMine((x) => {
      const next = { ...x };
      if (current === sel) delete next[m.fixture_id];
      else next[m.fixture_id] = sel;
      return next;
    });
  };

  const chips = Array.from({ length: CHIPS }, (_, i) => getDateDetailsByOffset(start + i, timeZone));

  return (
    <div className="bh-today">
      <div className="bh-card bh-controls">
        <div className="bh-dates" role="group" aria-label="Choose a date">
          <button type="button" className="bh-arrow" aria-label="Earlier dates" disabled={start <= -BACK_DAYS} onClick={() => setStart((s) => Math.max(-BACK_DAYS, s - 1))}>‹</button>
          <div className="bh-chips">
            {chips.map((d) => (
              <button key={d.iso} type="button" className={`bh-chip ${d.offsetDays === offset ? 'is-active' : ''}`} aria-pressed={d.offsetDays === offset} onClick={() => setOffset(d.offsetDays)}>
                <b>{d.offsetDays === -1 ? 'Yesterday' : d.offsetDays === 0 ? 'Today' : d.shortDay}</b>
                <small>{d.dateFormatted}</small>
              </button>
            ))}
          </div>
          <button type="button" className="bh-arrow" aria-label="Later dates" disabled={start + CHIPS - 1 >= FORWARD_DAYS} onClick={() => setStart((s) => Math.min(FORWARD_DAYS - CHIPS + 1, s + 1))}>›</button>
        </div>
      </div>

      <div className="bh-sec"><h2>Tennis: who wins?</h2><small>{matches ? `${matches.length} matches` : ''}</small></div>

      {error && <p className="bh-error" role="alert">{error}</p>}

      {matches === null ? (
        <p className="bh-muted" aria-busy="true">Loading matches…</p>
      ) : matches.length === 0 ? (
        <div className="bh-card bh-empty"><p>No tennis matches open for picks on this day.</p></div>
      ) : (
        <div className="bh-list">
          {matches.map((m) => {
            const lock = m.status === 'scheduled' ? lockLabel(m.kickoff_at, now) : null;
            const locked = !lock;
            const time = new Date(m.kickoff_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone });
            const over = m.p1_sets != null && m.p2_sets != null;
            return (
              <article key={m.fixture_id} className="bh-card bh-fixture">
                <div className="bh-meta">
                  <span>{m.tour} · {m.tournament_name} · {m.round} · {time}</span>
                  <span className={`bh-lock ${locked ? 'is-closed' : ''}`}>{lock || (over ? 'Finished' : 'Locked')}</span>
                </div>
                <div className="bh-teams">
                  <span>{m.player1 || 'Player 1'}</span>
                  <span className="bh-vs">{over ? `${m.p1_sets} – ${m.p2_sets}` : 'vs'}</span>
                  <span className="bh-right">{m.player2 || 'Player 2'}</span>
                </div>
                <div className="bh-market">
                  <div className="bh-mkt-label">Match winner</div>
                  <div className="bh-opts bh-opts-2">
                    {(['p1', 'p2'] as const).map((sel) => {
                      const selected = mine[m.fixture_id] === sel;
                      return (
                        <button
                          key={sel}
                          type="button"
                          className={`bh-opt ${selected ? 'is-selected' : ''}`}
                          aria-pressed={selected}
                          disabled={locked || busy === m.fixture_id}
                          onClick={() => pick(m, sel)}
                          title={selected ? 'Tap again to remove this call' : undefined}
                        >
                          {(sel === 'p1' ? m.player1 : m.player2) || (sel === 'p1' ? 'Player 1' : 'Player 2')}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {!locked && <p className="bh-note">Tap a player to call the winner; tap again to remove it. You can change until it locks.</p>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
