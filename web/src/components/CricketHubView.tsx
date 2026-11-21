import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatCardKickoff, getDateDetailsByOffset, useUserTimeZone } from '../lib/dateUtils';
import { PredictionGlance, type GlanceSettle } from './PredictionGlance';
import './cricket-hub.css';

// Cricket hub: one card per match with the engine's win probability, a date bar
// (past dates, yesterday, today, tomorrow and the next days) and settled colours.
// Predictions are BigBang VIP + admin only (the feed redacts them for others).
// A pick may be refreshed until 48 hours before the start; after that the
// database locks it, and the card says so.

export interface CricketHubViewProps {
  currentUser?: any;
  isAdmin?: boolean;
  canViewPredictions?: boolean;
  onOpenAuth?: (mode: 'signin' | 'register') => void;
  onOpenSubscription?: () => void;
  onBackToFootball?: () => void;
}

type Settlement = 'pending' | 'won' | 'lost' | 'void';

interface CricketPrediction {
  locked?: boolean;
  stage?: 'provisional' | 'toss';
  home_win_prob?: number;
  away_win_prob?: number;
  predicted_winner?: string;
  probability?: number;
  tier?: 'ELITE' | 'STANDARD' | 'WATCH';
  bat_first?: string | null;
  first_innings_median?: number | null;
  settlement_status: Settlement;
}

interface CricketMatch {
  id: string;
  format: 'T20' | 'ODI';
  competition: string;
  home_team: string;
  away_team: string;
  start_time: string;
  venue?: string | null;
  city?: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'abandoned' | 'postponed';
  toss_winner?: string | null;
  toss_decision?: 'bat' | 'field' | null;
  result_text?: string | null;
  scores?: { team: string; innings: number; runs: number; wickets?: number | null; overs?: number | null }[];
  pick_locked?: boolean;
  prediction: CricketPrediction | null;
  toss_update?: CricketPrediction | null;
}

interface Tally {
  settled: number;
  won: number;
  lost: number;
  void: number;
}

interface CricketFeed {
  success: boolean;
  is_subscriber: boolean;
  date: string;
  today: string;
  matches: CricketMatch[];
  dates: { iso: string; count: number }[];
  stats: Tally;
  day_stats: Tally;
}

const DAYS_AHEAD = 4;
const pct = (p?: number) => (typeof p === 'number' ? `${Math.round(p * 100)}%` : '');

function inningsText(m: CricketMatch, team: string): string {
  return (m.scores || [])
    .filter((s) => s.team === team)
    .map((s) => `${s.runs}${typeof s.wickets === 'number' && s.wickets < 10 ? `/${s.wickets}` : ''}`)
    .join(' & ');
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

const MatchCard: React.FC<{ m: CricketMatch; timeZone: string; onUnlock: () => void }> = ({ m, timeZone, onUnlock }) => {
  const [expanded, setExpanded] = useState(false);
  const p = m.prediction;
  const locked = Boolean(p?.locked);
  const settle: GlanceSettle = p && p.settlement_status !== 'pending' ? p.settlement_status : null;
  const stateClass = settle === 'won' ? 'card-won' : settle === 'lost' ? 'card-lost' : settle === 'void' ? 'card-void' : '';

  const homeScore = inningsText(m, m.home_team);
  const awayScore = inningsText(m, m.away_team);
  const showScore = m.status !== 'scheduled' && (homeScore || awayScore);

  const statusChip =
    m.status === 'live' ? { kind: 'live' as const, text: 'LIVE' } :
    m.status === 'finished' ? { kind: 'final' as const, text: 'Result' } :
    m.status === 'abandoned' ? { kind: 'final' as const, text: 'Abandoned' } :
    m.status === 'postponed' ? { kind: 'final' as const, text: 'Postponed' } :
    null;

  const toss = m.toss_winner && m.toss_decision
    ? `${m.toss_winner} won the toss and chose to ${m.toss_decision}`
    : m.status === 'scheduled' ? 'Toss and XIs not announced yet' : null;

  const lockLine = !p
    ? null
    : m.pick_locked
      ? '🔒 Pick locked (locks 48 hours before the start and never changes)'
      : 'Pick can still update until 48 hours before the start';

  let pick: React.ReactNode;
  if (!p) pick = m.status === 'scheduled' ? 'Prediction not published yet' : 'No prediction for this match';
  else if (locked) pick = '🔒 BigBang VIP Pick';
  else pick = <>{p.predicted_winner} to win</>;

  return (
    <article className={`ck-card ${stateClass}`} onClick={() => setExpanded((e) => !e)}>
      <PredictionGlance
        league={`🏏 ${m.format} · ${m.competition}`}
        leagueTitle={m.competition}
        time={`📅 ${formatCardKickoff(m.start_time, timeZone)}`}
        statusChip={statusChip}
        home={m.home_team}
        away={m.away_team}
        venue={m.venue ? `${m.venue}${m.city ? `, ${m.city}` : ''}` : null}
        centerScore={showScore ? `${homeScore || '–'}  v  ${awayScore || '–'}` : null}
        isLive={m.status === 'live'}
        tierLabel={p && !locked && p.tier === 'ELITE' ? 'ELITE' : undefined}
        tierClassName="ck-tier"
        settle={settle}
        marketLabel="Match winner"
        pick={pick}
        locked={locked}
        lockedCta={
          <button type="button" className="ck-unlock" onClick={(e) => { e.stopPropagation(); onUnlock(); }}>
            Unlock win probabilities with BigBang VIP
          </button>
        }
        scoreText={p && !locked ? pct(p.probability) : undefined}
        scoreSub={p && !locked ? 'win chance' : undefined}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
      />
      {expanded && (
        <div className="ck-more" onClick={(e) => e.stopPropagation()}>
          {p && !locked && (
            <div className="ck-probs">
              {[m.home_team, m.away_team].map((team, i) => {
                const prob = i === 0 ? p.home_win_prob : p.away_win_prob;
                const fav = p.predicted_winner === team;
                return (
                  <div className={`ck-prob-row${fav ? ' ck-fav' : ''}`} key={team}>
                    <span className="ck-prob-team">{team}</span>
                    <span className="ck-bar"><span style={{ width: pct(prob) }} /></span>
                    <strong>{pct(prob)}</strong>
                  </div>
                );
              })}
            </div>
          )}
          {m.toss_update && !locked && (
            <div className="ck-line">
              After the toss the model gives <strong>{m.toss_update.predicted_winner}</strong>{' '}
              {pct(m.toss_update.probability)}. The pick above stays as published.
            </div>
          )}
          {p && !locked && typeof p.first_innings_median === 'number' && (
            <div className="ck-line">Expected first-innings score: about {Math.round(p.first_innings_median)}</div>
          )}
          {toss && <div className="ck-line">{toss}</div>}
          {m.result_text && m.status !== 'scheduled' && <div className="ck-line"><strong>{m.result_text}</strong></div>}
          {lockLine && <div className="ck-line ck-muted">{lockLine}</div>}
        </div>
      )}
    </article>
  );
};

export const CricketHubView: React.FC<CricketHubViewProps> = ({
  currentUser,
  onOpenAuth,
  onOpenSubscription,
  onBackToFootball,
}) => {
  const { timeZone, timeZoneAbbr } = useUserTimeZone();
  const todayIso = getDateDetailsByOffset(0, timeZone).iso;
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [feed, setFeed] = useState<CricketFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState<'all' | 'T20' | 'ODI'>('all');
  const requestId = useRef(0);

  const load = useCallback(async (date: string, quiet = false) => {
    const id = ++requestId.current;
    if (!quiet) setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const qs = new URLSearchParams({ date, tz: timeZone });
      const res = await fetch(`/api/cricket-feed?${qs}`, { headers, cache: 'no-store' });
      const data = (await res.json()) as CricketFeed;
      if (!res.ok || !data.success) throw new Error('feed');
      if (id !== requestId.current) return; // a newer date was chosen meanwhile
      setFeed(data);
      setError(null);
    } catch {
      if (id !== requestId.current) return;
      setError('Cricket matches could not be loaded. Please try again shortly.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [timeZone]);

  useEffect(() => {
    load(selectedDate);
  }, [load, selectedDate, currentUser?.id]);

  const shown = feed && feed.date === selectedDate ? feed : null;
  const hasLive = Boolean(shown?.matches.some((m) => m.status === 'live'));

  useEffect(() => {
    const t = window.setInterval(() => load(selectedDate, true), hasLive ? 30000 : 300000);
    return () => window.clearInterval(t);
  }, [load, selectedDate, hasLive]);

  const countByDate = useMemo(() => new Map((feed?.dates || []).map((d) => [d.iso, d.count])), [feed]);

  const chips = useMemo(
    () => Array.from({ length: DAYS_AHEAD + 2 }, (_, i) => {
      const d = getDateDetailsByOffset(i - 1, timeZone);
      const label = d.offsetDays === -1 ? 'Yesterday' : d.offsetDays === 0 ? 'Today' : d.offsetDays === 1 ? 'Tomorrow' : d.dayName;
      return { ...d, label };
    }),
    [timeZone, todayIso],
  );
  const chipIsos = new Set(chips.map((c) => c.iso));

  const dropdownDates = useMemo(() => {
    const set = new Map<string, number>();
    for (const d of feed?.dates || []) set.set(d.iso, d.count);
    // Always offer the last 30 days and the next days, even before any match is stored.
    for (let o = DAYS_AHEAD; o >= -30; o--) {
      const iso = getDateDetailsByOffset(o, timeZone).iso;
      if (!set.has(iso)) set.set(iso, 0);
    }
    return [...set.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [feed, timeZone, todayIso]);

  const matches = useMemo(
    () => (shown?.matches || []).filter((m) => format === 'all' || m.format === format),
    [shown, format],
  );

  const onUnlock = () => {
    if (!currentUser) onOpenAuth?.('signin');
    else onOpenSubscription?.();
  };

  const day = shown?.day_stats;
  const overall = feed?.stats;
  const otherDate = !chipIsos.has(selectedDate);

  return (
    <section className="ck-hub">
      <div className="ck-hub-head">
        <div className="ck-title">
          <h1>🏏 Cricket predictions</h1>
          <span className="ck-tz" title={`Times are shown in your time zone (${timeZone})`}>🕒 {timeZoneAbbr}</span>
        </div>
        <label className="ck-format-select">
          <span className="ck-sr">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} aria-label="Format">
            <option value="all">All formats</option>
            <option value="T20">T20</option>
            <option value="ODI">ODI</option>
          </select>
        </label>
      </div>

      <div className="ck-dates" role="group" aria-label="Choose a date">
        <label className={`ck-date ck-date-pick ${otherDate ? 'active' : ''}`}>
          <span className="ck-date-main">📅 {otherDate ? longDate(selectedDate).replace(/ \d{4}$/, '') : 'All dates'} ▾</span>
          <span className="ck-date-sub">{otherDate ? 'Selected date' : 'Pick any date'}</span>
          <select
            value={selectedDate}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            aria-label="Pick a date"
          >
            {dropdownDates.map(([iso, count]) => (
              <option key={iso} value={iso}>
                {longDate(iso)}{iso === todayIso ? ' (today)' : ''}{count ? ` · ${count} match${count === 1 ? '' : 'es'}` : ''}
              </option>
            ))}
          </select>
        </label>
        {chips.map((c) => {
          const count = countByDate.get(c.iso);
          const active = selectedDate === c.iso;
          return (
            <button
              key={c.iso}
              type="button"
              className={`ck-date ${active ? 'active' : ''} ${c.offsetDays === -1 ? 'ck-date-past' : ''}`}
              onClick={() => setSelectedDate(c.iso)}
              aria-pressed={active}
              title={c.longFormatted}
            >
              <span className="ck-date-main">
                {c.label}
                {count ? <span className="ck-date-count">{count}</span> : null}
              </span>
              <span className="ck-date-sub">{c.dateFormatted}</span>
            </button>
          );
        })}
      </div>

      <div className="ck-summary">
        <span className="ck-summary-day">{longDate(selectedDate)}</span>
        {day && day.settled + day.void > 0 && (
          <span className="ck-summary-pills">
            <span className="ck-pill ck-pill-won">{day.won} won</span>
            <span className="ck-pill ck-pill-lost">{day.lost} lost</span>
            {day.void > 0 && <span className="ck-pill ck-pill-void">{day.void} void</span>}
          </span>
        )}
        {overall && overall.settled > 0 && (
          <span className="ck-summary-all">All time: <strong>{overall.won}/{overall.settled}</strong> picks won</span>
        )}
      </div>

      {loading && !shown && <div className="ck-note">Loading matches…</div>}
      {error && <div className="ck-note ck-error">{error}</div>}
      {shown && matches.length === 0 && (
        <div className="ck-empty">
          <p>No {format === 'all' ? 'T20 or ODI' : format} matches on {longDate(selectedDate)}.</p>
          <button type="button" className="coming-soon-back-btn" onClick={onBackToFootball}>⚽ View Football Predictions</button>
        </div>
      )}
      <div className={`ck-list ${loading ? 'is-loading' : ''}`}>
        {matches.map((m) => <MatchCard key={m.id} m={m} timeZone={timeZone} onUnlock={onUnlock} />)}
      </div>
      <p className="ck-credit">Historical ball-by-ball data: Cricsheet.org</p>
    </section>
  );
};

export default CricketHubView;
