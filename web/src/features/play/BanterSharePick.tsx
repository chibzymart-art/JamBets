import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserTimeZone } from '../../lib/dateUtils';
import { PLAY_BASE_PATH } from '../../components/HubSwitch';
import {
  fetchMyLeagues,
  fetchTopics,
  sharePick,
  type BanterLeagueSummary,
  type SharedPick,
  type TopicSummary,
} from './banterApi';
import { PICK_MARKET_NAME, PICK_STATUS_TEXT, WALL_MAX, charsLeft, selectionLabel, shareErrorMessage } from './banterRules';
import { liveKey, sendPing } from './banterLive';
import { notifyPush } from './banterPush';
import './banter.css';

/** A shared pick inside a message: read live, so it turns green / red when it settles. */
export function PickCard({ pick }: { pick: SharedPick }) {
  const { timeZone } = useUserTimeZone();
  const score = pick.home_score != null && pick.away_score != null ? `${pick.home_score} – ${pick.away_score}` : 'vs';
  return (
    <div className={`bh-pick-card bh-pick--${pick.status}`} aria-label="Shared pick">
      <div className="bh-meta">
        <span>{[pick.league_country, pick.league_name].filter(Boolean).join(' · ')}</span>
        <span>
          {new Date(pick.kickoff_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })}
        </span>
      </div>
      <div className="bh-teams">
        <span>{pick.home_team || 'Home'}</span>
        <span className="bh-vs">{score}</span>
        <span className="bh-right">{pick.away_team || 'Away'}</span>
      </div>
      <div className="bh-pick-line">
        <div>
          <div className="bh-mkt-label">{PICK_MARKET_NAME[pick.market] || pick.market}</div>
          <b>{selectionLabel(pick.market, pick.selection, pick.home_team || undefined, pick.away_team || undefined)}</b>
        </div>
        <span className={`bh-status bh-status--${pick.status}`}>
          {PICK_STATUS_TEXT[pick.status]}
          {pick.points != null && pick.status !== 'pending' ? ` · ${pick.points} pts` : ''}
        </span>
      </div>
    </div>
  );
}

/**
 * Share one of your own picks into a topic or one of your leagues, with an optional comment.
 * The server checks the pick is yours and applies the normal posting rules.
 */
export function SharePickPanel({ pickId, onClose }: { pickId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [leagues, setLeagues] = useState<BanterLeagueSummary[] | null>(null);
  const [topics, setTopics] = useState<TopicSummary[] | null>(null);
  const [dest, setDest] = useState<{ kind: 'league' | 'topic'; id: string; name: string } | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ href: string; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetchMyLeagues().then((r) => { if (live) setLeagues(r.ok ? r.data || [] : []); });
    fetchTopics('', 20, 0).then((r) => { if (live) setTopics(r.ok ? r.data || [] : []); });
    return () => { live = false; };
  }, []);

  const left = charsLeft(comment, WALL_MAX);

  const share = async () => {
    if (!dest || left < 0) return;
    setBusy(true);
    setError(null);
    const r = await sharePick(pickId, dest.kind === 'topic' ? { topicId: dest.id } : { leagueId: dest.id }, comment);
    setBusy(false);
    if (!r.ok) { setError(shareErrorMessage(r.code)); return; }
    if (dest.kind === 'topic') {
      notifyPush('reply', r.data.id);
      sendPing(liveKey.topic(dest.id), liveKey.topicList());
      setDone({ href: `${PLAY_BASE_PATH}/discussion?topic=${dest.id}&reply=${r.data.id}`, name: dest.name });
    } else {
      notifyPush('post', r.data.id);
      sendPing(liveKey.league(dest.id));
      setDone({ href: `${PLAY_BASE_PATH}/leagues?league=${dest.id}&post=${r.data.id}`, name: dest.name });
    }
  };

  if (done) {
    return (
      <div className="bh-share-panel" role="status">
        <p>Shared to <b>{done.name}</b>.</p>
        <div className="bh-inline">
          <button type="button" className="bh-btn" onClick={() => navigate(done.href)}>Open it</button>
          <button type="button" className="bh-link" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const option = (kind: 'league' | 'topic', id: string, name: string, sub: string) => (
    <li key={`${kind}-${id}`}>
      <button
        type="button"
        className={`bh-share-opt ${dest?.kind === kind && dest.id === id ? 'is-active' : ''}`}
        aria-pressed={dest?.kind === kind && dest.id === id}
        onClick={() => setDest({ kind, id, name })}
      >
        <span aria-hidden="true">{kind === 'league' ? '👥' : '💬'}</span>
        <span><b>{name}</b><small>{sub}</small></span>
      </button>
    </li>
  );

  return (
    <div className="bh-share-panel">
      <div className="bh-sec"><h2>Share this pick</h2><button type="button" className="bh-link" onClick={onClose}>✕</button></div>
      {leagues === null || topics === null ? (
        <p className="bh-muted" aria-busy="true">Loading…</p>
      ) : leagues.length === 0 && topics.length === 0 ? (
        <p className="bh-muted">Join a league or start a topic first, then share your picks there.</p>
      ) : (
        <>
          {leagues.length > 0 && (
            <>
              <div className="bh-mkt-label">Your leagues</div>
              <ul className="bh-share-list">{leagues.map((l) => option('league', l.league_id, l.name, `${l.members} members`))}</ul>
            </>
          )}
          {topics.length > 0 && (
            <>
              <div className="bh-mkt-label">Discussion topics</div>
              <ul className="bh-share-list">{topics.map((t) => option('topic', t.id, t.title, `${t.replies} replies`))}</ul>
            </>
          )}
          <label className="bh-mkt-label" htmlFor={`bh-share-${pickId}`}>Add a comment (optional)</label>
          <input
            id={`bh-share-${pickId}`}
            className="bh-input"
            value={comment}
            maxLength={WALL_MAX + 20}
            placeholder="e.g. Banker of the day 🔒"
            onChange={(e) => setComment(e.target.value)}
          />
          {error && <p className="bh-error" role="alert">{error}</p>}
          <div className="bh-inline">
            <button type="button" className="bh-btn" onClick={share} disabled={!dest || busy || left < 0}>
              {busy ? 'Sharing…' : dest ? `Share to ${dest.name}` : 'Choose where to share'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
