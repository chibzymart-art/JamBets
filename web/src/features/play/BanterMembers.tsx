import { useEffect, useState } from 'react';
import { fetchMember, fetchMyFollows, followMember, type BanterMember, type MyFollows } from './banterApi';
import { formatPoints, followErrorMessage } from './banterRules';
import { notifyPush } from './banterPush';
import './banter.css';

// ---------------------------------------------------------------------------
// Opening a member card from anywhere in the Banter Hub (a name in a chat, the bell, Profile).
// ---------------------------------------------------------------------------
type Opener = (handle: string) => void;
const openers = new Set<Opener>();
export function openMember(handle: string): void {
  openers.forEach((fn) => fn(handle));
}

/** A member's name you can tap to see their card and follow them. Plain text, never a link. */
export function MemberName({ handle, isMe = false }: { handle: string; isMe?: boolean }) {
  if (isMe) return <>{handle} (you)</>;
  return (
    <button type="button" className="bh-member-link" onClick={() => openMember(handle)} aria-label={`Open ${handle}'s card`}>
      {handle}
    </button>
  );
}

/** Rendered once by the hub: the member card sheet. */
export function MemberSheetHost() {
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => {
    const fn: Opener = (h) => setHandle(h);
    openers.add(fn);
    return () => { openers.delete(fn); };
  }, []);
  useEffect(() => {
    if (!handle) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHandle(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handle]);
  if (!handle) return null;
  return (
    <div className="bh-sheet-backdrop" role="presentation" onClick={() => setHandle(null)}>
      <div className="bh-sheet" role="dialog" aria-modal="true" aria-label={`${handle}'s card`} onClick={(e) => e.stopPropagation()}>
        <MemberCard key={handle} handle={handle} onClose={() => setHandle(null)} />
      </div>
    </div>
  );
}

function MemberCard({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [m, setM] = useState<BanterMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMember(handle).then((r) => {
      if (!live) return;
      if (!r.ok) { setError(followErrorMessage(r.code)); return; }
      setM(r.data);
    });
    return () => { live = false; };
  }, [handle]);

  const toggle = async () => {
    if (!m) return;
    setBusy(true);
    setError(null);
    const r = await followMember(m.handle, !m.is_following);
    setBusy(false);
    if (!r.ok) { setError(followErrorMessage(r.code)); return; }
    setM({ ...m, is_following: r.data.following, followers: r.data.followers });
    if (r.data.notification_id) notifyPush('follow', r.data.notification_id);
  };

  return (
    <div className="bh-member-card">
      <div className="bh-sec">
        <h2>Member</h2>
        <button type="button" className="bh-link" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {error && <p className="bh-error" role="alert">{error}</p>}
      {!m && !error && <p className="bh-muted" aria-busy="true">Loading…</p>}
      {m && (
        <>
          <div className="bh-member-head">
            <span className="bh-profile-avatar" aria-hidden="true">{m.avatar_emoji}</span>
            <div>
              <b>{m.handle}</b>
              <small>{m.follows_you ? 'Follows you' : 'Banter Hub member'}</small>
            </div>
          </div>
          <div className="bh-stat-grid bh-stat-grid--3">
            <div><small>Followers</small><b>{m.followers}</b></div>
            <div><small>Following</small><b>{m.following}</b></div>
            <div><small>Points</small><b>{formatPoints(m.record?.points ?? 0)}</b></div>
          </div>
          <p className="bh-note">
            {m.record?.settled ?? 0} settled picks · {m.record?.won ?? 0} won · {m.record?.lost ?? 0} lost
          </p>
          {!m.is_me && (
            <button type="button" className={`bh-btn ${m.is_following ? 'bh-btn-ghost' : ''}`} onClick={toggle} disabled={busy}>
              {busy ? '…' : m.is_following ? 'Following ✓ (tap to unfollow)' : '＋ Follow'}
            </button>
          )}
          {!m.is_me && (
            <p className="bh-note">Followers are told when {m.handle} makes a pick, starts a topic or posts in Discussion.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Profile: followers and following, with their names (tap to open a card). */
export function FollowsCard() {
  const [f, setF] = useState<MyFollows | null | undefined>(undefined);
  const [show, setShow] = useState<'followers' | 'following' | null>(null);
  useEffect(() => {
    let live = true;
    fetchMyFollows().then((r) => { if (live) setF(r.ok ? r.data : null); });
    return () => { live = false; };
  }, []);
  if (!f) return null;
  const list = show === 'followers' ? f.followers_list : show === 'following' ? f.following_list : [];
  return (
    <div className="bh-card bh-follows">
      <div className="bh-seg" role="tablist" aria-label="Followers and following">
        <button type="button" role="tab" aria-selected={show === 'followers'} className={`bh-seg-btn ${show === 'followers' ? 'is-active' : ''}`}
          onClick={() => setShow(show === 'followers' ? null : 'followers')}>
          {f.followers} {f.followers === 1 ? 'follower' : 'followers'}
        </button>
        <button type="button" role="tab" aria-selected={show === 'following'} className={`bh-seg-btn ${show === 'following' ? 'is-active' : ''}`}
          onClick={() => setShow(show === 'following' ? null : 'following')}>
          {f.following} following
        </button>
      </div>
      {show && (
        list.length === 0 ? (
          <p className="bh-muted">{show === 'followers' ? 'No followers yet.' : "You're not following anyone yet. Tap a name in a chat to follow."}</p>
        ) : (
          <ul className="bh-follow-list">
            {list.map((x) => (
              <li key={x.handle}>
                <button type="button" className="bh-share-opt" onClick={() => openMember(x.handle)}>
                  <span aria-hidden="true">{x.avatar_emoji}</span>
                  <span><b>{x.handle}</b></span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
