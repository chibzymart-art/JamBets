import { useEffect, useState } from 'react';
import { useUserTimeZone } from '../../lib/dateUtils';
import { fetchLeaderboard, fetchMyFootballPicks, type BanterState, type LeaderboardPeriod, type LeaderboardRow } from './banterApi';
import { ProfileForm } from './BanterGate';
import { PushSettingsCard } from './BanterPushUI';
import { formatPoints, myLeaderboardRow, pendingCount } from './banterRules';
import './banter.css';

/**
 * Banter Hub profile: avatar and username (editable with the same rules as the first-time screen),
 * and the member's record for this week, this month and all time, taken from their own leaderboard
 * row. Uses functions that are already live; no new database objects.
 */

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

export function BanterProfile({
  me,
  onProfileSaved,
}: {
  me: { handle: string; avatar: string };
  onProfileSaved: (s: BanterState) => void;
}) {
  const { timeZone } = useUserTimeZone();
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const [row, setRow] = useState<LeaderboardRow | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    setRow(undefined);
    setError(false);
    // Limit 1: the function still returns the caller's own row when they are outside the top.
    fetchLeaderboard(period, 1).then((r) => {
      if (!live) return;
      if (!r.ok) { setError(true); setRow(null); return; }
      setRow(myLeaderboardRow(r.data));
    });
    return () => { live = false; };
  }, [period, me.handle]);

  useEffect(() => {
    let live = true;
    fetchMyFootballPicks(null, timeZone).then((r) => {
      if (live && r.ok) setPending(pendingCount(r.data));
    });
    return () => { live = false; };
  }, [timeZone]);

  return (
    <div className="bh-today">
      <div className="bh-card bh-profile-head">
        <span className="bh-profile-avatar" aria-hidden="true">{me.avatar}</span>
        <div className="bh-profile-name">
          <h2>{me.handle}</h2>
          <small>
            {pending == null ? 'Banter Hub member' : pending === 0 ? 'No calls waiting for a result' : `${pending} ${pending === 1 ? 'call' : 'calls'} waiting for a result`}
          </small>
        </div>
        <button type="button" className="bh-btn" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? 'Close' : 'Edit'}
        </button>
      </div>

      {editing && (
        <div className="bh-card">
          <ProfileForm
            initialHandle={me.handle}
            initialAvatar={me.avatar}
            submitLabel="Save changes"
            onSaved={onProfileSaved}
          />
        </div>
      )}

      <div className="bh-sec"><h2>Notifications</h2></div>
      <PushSettingsCard />

      <div className="bh-sec"><h2>Your record</h2></div>
      <div className="bh-seg" role="tablist" aria-label="Record period">
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

      {error ? (
        <p className="bh-error" role="alert">Couldn't load your record. Please try again.</p>
      ) : row === undefined ? (
        <p className="bh-muted" aria-busy="true">Loading your record…</p>
      ) : row === null ? (
        <div className="bh-card bh-empty">
          <p>No settled calls {period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'yet'}. Make your calls on Today; your record fills in after full time.</p>
        </div>
      ) : (
        <div className="bh-card bh-record">
          <div className="bh-record-top">
            <div><small>Place</small><b>#{row.place}</b></div>
            <div><small>Points</small><b>{formatPoints(row.points)}</b></div>
            <div><small>Hit rate</small><b>{Number(row.hit_rate)}%</b></div>
          </div>
          <div className="bh-record-grid">
            <div className="is-won"><small>Won</small><b>{row.won}</b></div>
            <div className="is-lost"><small>Lost</small><b>{row.lost}</b></div>
            <div><small>Void</small><b>{row.voided}</b></div>
            <div><small>Settled</small><b>{row.settled}</b></div>
          </div>
        </div>
      )}
    </div>
  );
}
