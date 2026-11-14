import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDateDetailsByOffset, useUserTimeZone } from '../../lib/dateUtils';
import {
  cancelFootballPick,
  fetchFootballFixtures,
  fetchFootballLeagues,
  fetchMyFootballPicks,
  saveBanterLeagues,
  submitFootballPick,
  type BanterFixture,
  type BanterLeague,
} from './banterApi';
import { FOOTBALL_MARKETS, initialLeagueTicks, lockLabel, pickErrorMessage } from './banterRules';
import './banter.css';

/**
 * Banter Hub "Today": pick a date, tick leagues, then make calls on the matches the main system
 * has already predicted. All data comes from Banter RPCs; nothing from the Predictions Hub is used.
 */

const BACK_DAYS = 7;
const FORWARD_DAYS = 4;
const CHIPS = 4;

export function BanterToday({ savedLeagues }: { savedLeagues: string[] | null }) {
  const { timeZone } = useUserTimeZone();
  const todayIso = getDateDetailsByOffset(0, timeZone).iso;
  const [offset, setOffset] = useState(0);
  const [start, setStart] = useState(-1);
  const date = getDateDetailsByOffset(offset, timeZone).iso;

  const [leagues, setLeagues] = useState<BanterLeague[]>([]);
  const [ticks, setTicks] = useState<string[]>(() => initialLeagueTicks(savedLeagues));
  const [fixtures, setFixtures] = useState<BanterFixture[] | null>(null);
  const [myPicks, setMyPicks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setFixtures(null);
    setError(null);
    const [lg, fx, mine] = await Promise.all([
      fetchFootballLeagues(date, timeZone),
      fetchFootballFixtures(date, timeZone, null),
      fetchMyFootballPicks(date, timeZone),
    ]);
    if (!lg.ok || !fx.ok || !mine.ok) {
      setError("Couldn't load matches. Please try again.");
      setFixtures([]);
      return;
    }
    setLeagues(lg.data || []);
    setFixtures(fx.data || []);
    const map: Record<string, string> = {};
    for (const p of mine.data || []) map[`${p.fixture_id}:${p.market}`] = p.selection;
    setMyPicks(map);
  }, [date, timeZone]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => (fixtures || []).filter((f) => ticks.includes(f.league_code)),
    [fixtures, ticks],
  );
  const hiddenCount = (fixtures || []).length - visible.length;

  const pick = async (f: BanterFixture, market: string, value: string) => {
    const key = `${f.fixture_id}:${market}`;
    setBusy(key);
    setError(null);
    const current = myPicks[key];
    const res = current === value
      ? await cancelFootballPick(f.fixture_id, market)
      : await submitFootballPick(f.fixture_id, market, value);
    setBusy(null);
    if (!res.ok) {
      setError(pickErrorMessage(res.code));
      return;
    }
    setMyPicks((m) => {
      const next = { ...m };
      if (current === value) delete next[key];
      else next[key] = value;
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
              <button
                key={d.iso}
                type="button"
                className={`bh-chip ${d.offsetDays === offset ? 'is-active' : ''}`}
                aria-pressed={d.offsetDays === offset}
                onClick={() => setOffset(d.offsetDays)}
              >
                <b>{d.offsetDays === -1 ? 'Yesterday' : d.offsetDays === 0 ? 'Today' : d.shortDay}</b>
                <small>{d.dateFormatted}</small>
              </button>
            ))}
          </div>
          <button type="button" className="bh-arrow" aria-label="Later dates" disabled={start + CHIPS - 1 >= FORWARD_DAYS} onClick={() => setStart((s) => Math.min(FORWARD_DAYS - CHIPS + 1, s + 1))}>›</button>
        </div>

        <LeagueTicks leagues={leagues} ticks={ticks} onChange={(next) => { setTicks(next); saveBanterLeagues(next); }} />
      </div>

      <div className="bh-sec">
        <h2>Make your calls</h2>
        <small>{date === todayIso ? 'Today' : getDateDetailsByOffset(offset, timeZone).formatted}</small>
      </div>

      {error && <p className="bh-error" role="alert">{error}</p>}

      {fixtures === null ? (
        <p className="bh-muted" aria-busy="true">Loading matches…</p>
      ) : visible.length === 0 ? (
        <div className="bh-card bh-empty">
          <p>
            {fixtures.length === 0
              ? 'No matches open for picks on this day.'
              : 'No matches in your ticked leagues on this day.'}
          </p>
          {hiddenCount > 0 && (
            <button type="button" className="bh-btn" onClick={() => { const all = leagues.map((l) => l.league_code); setTicks(all); saveBanterLeagues(all); }}>
              Show all {hiddenCount} matches from other leagues
            </button>
          )}
        </div>
      ) : (
        <div className="bh-list">
          {visible.map((f) => {
            const lock = f.status === 'scheduled' ? lockLabel(f.kickoff_at, now) : null;
            const locked = !lock;
            const time = new Date(f.kickoff_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone });
            return (
              <article key={f.fixture_id} className="bh-card bh-fixture">
                <div className="bh-meta">
                  <span>{f.league_country} · {f.league_name} · {time}</span>
                  <span className={`bh-lock ${locked ? 'is-closed' : ''}`}>{lock || (f.status === 'finished' ? 'Full time' : 'Locked')}</span>
                </div>
                <div className="bh-teams">
                  <span>{f.home_team || 'Home'}</span>
                  <span className="bh-vs">{f.home_score != null && f.away_score != null ? `${f.home_score} – ${f.away_score}` : 'vs'}</span>
                  <span className="bh-right">{f.away_team || 'Away'}</span>
                </div>
                {FOOTBALL_MARKETS.map((m) => {
                  const key = `${f.fixture_id}:${m.id}`;
                  return (
                    <div key={m.id} className="bh-market">
                      <div className="bh-mkt-label">{m.label}</div>
                      <div className={`bh-opts bh-opts-${m.options.length}`}>
                        {m.options.map((o) => {
                          const selected = myPicks[key] === o.value;
                          return (
                            <button
                              key={o.value}
                              type="button"
                              className={`bh-opt ${selected ? 'is-selected' : ''}`}
                              aria-pressed={selected}
                              disabled={locked || busy === key}
                              onClick={() => pick(f, m.id, o.value)}
                              title={selected ? 'Tap again to remove this call' : undefined}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {!locked && <p className="bh-note">Tap a choice to call it; tap it again to remove it. You can change until it locks.</p>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeagueTicks({ leagues, ticks, onChange }: { leagues: BanterLeague[]; ticks: string[]; onChange: (t: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const shown = leagues.filter((l) => ticks.includes(l.league_code)).length;

  return (
    <div className="bh-leagues" ref={ref}>
      <button type="button" className="bh-leagues-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Leagues: {shown} of {leagues.length} ticked <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="bh-leagues-menu" role="group" aria-label="Leagues to show">
          {leagues.length === 0 && <p className="bh-muted">No leagues have matches on this day.</p>}
          {leagues.map((l) => {
            const on = ticks.includes(l.league_code);
            return (
              <label key={l.league_code} className="bh-league-row">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? ticks.filter((t) => t !== l.league_code) : [...ticks, l.league_code])}
                />
                <span>{l.league_country} · {l.league_name}</span>
                <small>{l.fixtures}</small>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
