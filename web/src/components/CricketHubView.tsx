import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import './cricket-hub.css';

// Cricket hub: every in-scope match with the engine's win probability.
// Predictions are BigBang VIP + admin only (the feed redacts them for others).

export interface CricketHubViewProps {
  currentUser?: any;
  isAdmin?: boolean;
  canViewPredictions?: boolean;
  onOpenAuth?: (mode: 'signin' | 'register') => void;
  onOpenSubscription?: () => void;
  onBackToFootball?: () => void;
}

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
  settlement_status: 'pending' | 'won' | 'lost' | 'void';
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
  scores?: { team: string; innings: number; runs: number; wickets?: number; overs?: number }[];
  prediction: CricketPrediction | null;
}

interface CricketFeed {
  success: boolean;
  is_subscriber: boolean;
  matches: CricketMatch[];
  stats: { settled: number; won: number; lost: number };
}

const pct = (p?: number) => (typeof p === 'number' ? `${Math.round(p * 100)}%` : '');

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const tomorrow = dayKey(new Date(Date.now() + 86400000).toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (key === today) return 'Today';
  if (key === tomorrow) return 'Tomorrow';
  if (key === yesterday) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

function scoreLine(m: CricketMatch, team: string): string {
  const inns = (m.scores || []).filter((s) => s.team === team);
  return inns
    .map((s) => `${s.runs}${s.wickets !== undefined && s.wickets !== null && s.wickets < 10 ? `/${s.wickets}` : ''}${s.overs ? ` (${s.overs})` : ''}`)
    .join(' & ');
}

const MatchCard: React.FC<{
  m: CricketMatch;
  onUnlock: () => void;
}> = ({ m, onUnlock }) => {
  const p = m.prediction;
  const time = new Date(m.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const toss =
    m.toss_winner && m.toss_decision
      ? `${m.toss_winner} won the toss and chose to ${m.toss_decision}`
      : m.status === 'scheduled'
        ? 'Toss and XIs not announced yet'
        : null;
  const statusBadge =
    m.status === 'live' ? <span className="ck-badge ck-live">Live</span> :
    m.status === 'abandoned' ? <span className="ck-badge">Abandoned</span> :
    m.status === 'finished' ? <span className="ck-badge">Finished</span> :
    <span className="ck-badge ck-time">{time}</span>;
  const outcome = p && p.settlement_status !== 'pending'
    ? <span className={`ck-result ck-${p.settlement_status}`}>{p.settlement_status === 'won' ? 'Won' : p.settlement_status === 'lost' ? 'Lost' : 'Void'}</span>
    : null;

  return (
    <article className="ck-card">
      <header className="ck-card-head">
        <span className="ck-format">{m.format}</span>
        <span className="ck-comp">{m.competition}</span>
        {statusBadge}
      </header>
      {[m.home_team, m.away_team].map((team, i) => {
        const prob = p && !p.locked ? (i === 0 ? p.home_win_prob : p.away_win_prob) : undefined;
        const fav = p && !p.locked && p.predicted_winner === team;
        return (
          <div className={`ck-team${fav ? ' ck-fav' : ''}`} key={team}>
            <span className="ck-team-name">{team}</span>
            <span className="ck-team-score">{scoreLine(m, team)}</span>
            {prob !== undefined && (
              <span className="ck-team-prob">
                <span className="ck-bar"><span style={{ width: pct(prob) }} /></span>
                <strong>{pct(prob)}</strong>
              </span>
            )}
          </div>
        );
      })}
      {p && p.locked && (
        <button type="button" className="ck-unlock" onClick={onUnlock}>
          🔒 Win probabilities are for BigBang VIP members
        </button>
      )}
      {p && !p.locked && (
        <div className="ck-pick">
          <span>
            Model pick: <strong>{p.predicted_winner}</strong> {pct(p.probability)}
            {p.tier === 'ELITE' && <span className="ck-tier">Elite</span>}
          </span>
          <span className="ck-stage">{p.stage === 'toss' ? 'Updated after the toss' : 'Before the toss'}</span>
          {outcome}
        </div>
      )}
      {!p && m.status === 'scheduled' && <div className="ck-note">Prediction not published yet</div>}
      <footer className="ck-foot">
        {toss && <span>{toss}</span>}
        {m.result_text && m.status !== 'scheduled' && <span>{m.result_text}</span>}
        {m.venue && <span>{m.venue}{m.city ? `, ${m.city}` : ''}</span>}
      </footer>
    </article>
  );
};

export const CricketHubView: React.FC<CricketHubViewProps> = ({
  currentUser,
  onOpenAuth,
  onOpenSubscription,
  onBackToFootball,
}) => {
  const [feed, setFeed] = useState<CricketFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState<'all' | 'T20' | 'ODI'>('all');

  const load = useCallback(async () => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch('/api/cricket-feed', { headers, cache: 'no-store' });
      const data = (await res.json()) as CricketFeed;
      if (!res.ok || !data.success) throw new Error('feed');
      setFeed(data);
      setError(null);
    } catch {
      setError('Cricket matches could not be loaded. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  }, []);

  const hasLive = Boolean(feed?.matches.some((m) => m.status === 'live'));

  useEffect(() => {
    load();
  }, [load, currentUser?.id]);

  useEffect(() => {
    const t = window.setInterval(load, hasLive ? 30000 : 300000);
    return () => window.clearInterval(t);
  }, [load, hasLive]);

  const groups = useMemo(() => {
    const list = (feed?.matches || []).filter((m) => format === 'all' || m.format === format);
    const byDay = new Map<string, CricketMatch[]>();
    for (const m of list) {
      const k = dayKey(m.start_time);
      byDay.set(k, [...(byDay.get(k) || []), m]);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [feed, format]);

  const onUnlock = () => {
    if (!currentUser) onOpenAuth?.('signin');
    else onOpenSubscription?.();
  };

  return (
    <section className="ck-hub">
      <div className="ck-hub-head">
        <div>
          <h1>🏏 Cricket predictions</h1>
        </div>
        {feed && feed.stats.settled > 0 && (
          <div className="ck-record">
            <strong>{feed.stats.won}/{feed.stats.settled}</strong>
            <span>model picks won</span>
          </div>
        )}
      </div>
      <div className="ck-filters" role="tablist" aria-label="Format">
        {(['all', 'T20', 'ODI'] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={format === f}
            className={format === f ? 'active' : ''} onClick={() => setFormat(f)}>
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>
      {loading && <div className="ck-note">Loading matches…</div>}
      {error && <div className="ck-note ck-error">{error}</div>}
      {!loading && !error && groups.length === 0 && (
        <div className="ck-empty">
          <p>No T20 or ODI matches in the next few days.</p>
          <button type="button" className="coming-soon-back-btn" onClick={onBackToFootball}>⚽ View Football Predictions</button>
        </div>
      )}
      {groups.map(([day, matches]) => (
        <div key={day} className="ck-day">
          <h2>{dayLabel(day)}</h2>
          <div className="ck-grid">
            {matches.map((m) => <MatchCard key={m.id} m={m} onUnlock={onUnlock} />)}
          </div>
        </div>
      ))}
      <p className="ck-credit">Historical ball-by-ball data: Cricsheet.org</p>
    </section>
  );
};

export default CricketHubView;
