import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { deleteWallPost, fetchWall, postToWall, type WallPost } from './banterApi';
import { WALL_MAX, WALL_PAGE, snippet, timeAgo, wallCharsLeft, wallErrorMessage } from './banterRules';
import { liveKey, sendPing, topVisible, useLiveRefresh } from './banterLive';
import { notifyPush } from './banterPush';
import { BanterReactions } from './BanterReactions';
import { MentionTextarea, MessageText } from './BanterMentions';
import { PickCard } from './BanterSharePick';
import './banter.css';

/**
 * A Banter wall (used for each league's wall). Newest first, load more, post box with a character
 * counter, Reply on every message (quotes it, tags its author and notifies them), delete own posts
 * (admins: any), manual refresh. Post text is rendered as plain text only (React escapes it; no
 * HTML, no auto-linking). focusPostId scrolls to and highlights one post (from "Replies to you").
 */
export function BanterWall({
  leagueId = null,
  title = 'Banter wall',
  focusPostId = null,
}: {
  leagueId?: string | null;
  title?: string;
  focusPostId?: string | null;
}) {
  const [posts, setPosts] = useState<WallPost[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<WallPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [highlight, setHighlight] = useState<string | null>(focusPostId);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const boxId = `bh-wall-${leagueId || 'public'}`;

  const load = useCallback(async () => {
    setNow(Date.now());
    const r = await fetchWall(leagueId, null, WALL_PAGE);
    if (!r.ok) { setLoadError(wallErrorMessage(r.code)); setPosts([]); setHasMore(false); return; }
    setLoadError(null);
    setPosts(r.data || []);
    setHasMore((r.data || []).length === WALL_PAGE);
  }, [leagueId]);

  useEffect(() => {
    setPosts(null);
    load();
  }, [load]);

  useEffect(() => { if (focusPostId) setHighlight(focusPostId); }, [focusPostId]);

  // Live: newest posts are at the top. If the top of the wall is on screen they slide in; if the
  // member has scrolled down to read, nothing moves and a "new messages" chip waits at the top.
  const listRef = useRef<HTMLDivElement | null>(null);
  const postsRef = useRef<WallPost[] | null>(null);
  postsRef.current = posts;
  const [pending, setPending] = useState<WallPost[] | null>(null);
  const merge = (fresh: WallPost[], current: WallPost[]) => {
    const oldest = fresh.length ? fresh[fresh.length - 1].created_at : null;
    const older = oldest ? current.filter((p) => p.created_at < oldest && !fresh.some((f) => f.id === p.id)) : current;
    return fresh.length < WALL_PAGE ? fresh : [...fresh, ...older];
  };
  useLiveRefresh([leagueId ? liveKey.league(leagueId) : null], async () => {
    const current = postsRef.current;
    if (!current || loadError) return;
    const r = await fetchWall(leagueId, null, WALL_PAGE);
    if (!r.ok) return;
    const fresh = r.data || [];
    const sig = (l: WallPost[]) => l.map((p) => `${p.id}:${p.tagged_handle || ''}:${JSON.stringify(p.reactions || {})}:${p.pick?.status || ''}`).join('|');
    if (sig(fresh) === sig(current.slice(0, fresh.length))) return;
    const added = fresh.filter((f) => !current.some((p) => p.id === f.id) && !f.is_me);
    if (added.length === 0 || topVisible(listRef.current)) {
      setNow(Date.now());
      setPosts(merge(fresh, current));
      setPending(null);
    } else {
      setPending(fresh);
    }
  });

  const showPending = () => {
    if (pending && posts) { setNow(Date.now()); setPosts(merge(pending, posts)); }
    setPending(null);
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const pendingCount = pending && posts ? pending.filter((f) => !posts.some((p) => p.id === f.id)).length : 0;

  // Scroll to the highlighted post once it is on screen, then let the highlight fade.
  useEffect(() => {
    if (!posts || !highlight) return;
    const el = document.getElementById(`bh-post-${highlight}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [posts, highlight]);

  const loadMore = async () => {
    if (!posts || posts.length === 0) return;
    setBusy(true);
    const r = await fetchWall(leagueId, posts[posts.length - 1].created_at, WALL_PAGE);
    setBusy(false);
    if (!r.ok) { setError(wallErrorMessage(r.code)); return; }
    const more = r.data || [];
    setPosts((p) => [...(p || []), ...more.filter((m) => !(p || []).some((x) => x.id === m.id))]);
    setHasMore(more.length === WALL_PAGE);
  };

  const left = wallCharsLeft(body);

  const startReply = (p: WallPost) => {
    setReplyTo(p);
    setTimeout(() => boxRef.current?.focus(), 0);
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(`bh-post-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setHighlight(id); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (left < 0 || body.trim().length === 0) { setError(wallErrorMessage('body_invalid')); return; }
    setBusy(true);
    const r = await postToWall(body, leagueId, replyTo ? replyTo.id : null);
    setBusy(false);
    if (!r.ok) { setError(wallErrorMessage(r.code)); return; }
    if (leagueId) notifyPush('post', r.data.id);
    sendPing(leagueId ? liveKey.league(leagueId) : null, replyTo && !replyTo.is_me ? liveKey.member(replyTo.handle) : null);
    setBody('');
    setReplyTo(null);
    setPending(null);
    await load();
  };

  const remove = async (id: string) => {
    setError(null);
    const r = await deleteWallPost(id);
    if (!r.ok) { setError(wallErrorMessage(r.code)); return; }
    setPosts((p) => (p || []).filter((x) => x.id !== id));
    sendPing(leagueId ? liveKey.league(leagueId) : null);
  };

  return (
    <div className="bh-wall">
      <div className="bh-sec">
        <h2>{title}</h2>
        <button type="button" className="bh-link" onClick={load} aria-label="Refresh the wall">↻ Refresh</button>
      </div>

      {loadError ? (
        <p className="bh-error" role="alert">{loadError}</p>
      ) : (
        <>
          <form className="bh-card bh-wall-form" onSubmit={submit}>
            {replyTo && (
              <div className="bh-replying">
                <span>↩ Replying to <b>{replyTo.handle}</b>: {snippet(replyTo.body, 60)}</span>
                <button type="button" className="bh-link" onClick={() => setReplyTo(null)} aria-label="Stop replying to this message">✕</button>
              </div>
            )}
            <label className="bh-mkt-label" htmlFor={boxId}>{replyTo ? `Your reply to ${replyTo.handle}` : 'Say something'}</label>
            <MentionTextarea
              id={boxId}
              ref={boxRef}
              className="bh-input bh-textarea"
              value={body}
              onValueChange={setBody}
              leagueId={leagueId}
              rows={3}
              maxLength={WALL_MAX + 40}
              placeholder={leagueId ? 'Banter with your league…' : 'Banter with other members…'}
            />
            <div className="bh-inline bh-wall-actions">
              <span className={`bh-counter ${left < 0 ? 'is-over' : left <= 20 ? 'is-near' : ''}`} aria-live="polite">{left}</span>
              <button type="submit" className="bh-btn" disabled={busy || left < 0 || body.trim().length === 0}>{replyTo ? 'Reply' : 'Post'}</button>
            </div>
            <p className="bh-note">
              {replyTo && !replyTo.is_me
                ? `${replyTo.handle} will be tagged and notified.`
                : `Keep it friendly. Plain text, up to ${WALL_MAX} characters. Tap ↩ Reply on a message to answer someone; they get notified.`}
            </p>
          </form>

          {error && <p className="bh-error" role="alert">{error}</p>}

          <div ref={listRef} />
          {pendingCount > 0 && (
            <button type="button" className="bh-live-chip bh-live-chip--inline" onClick={showPending} aria-live="polite">
              ↑ {pendingCount} new {pendingCount === 1 ? 'message' : 'messages'}
            </button>
          )}

          {posts === null ? (
            <p className="bh-muted" aria-busy="true">Loading the wall…</p>
          ) : posts.length === 0 ? (
            <div className="bh-card bh-empty"><p>No posts yet. Start the banter.</p></div>
          ) : (
            <ul className="bh-posts">
              {posts.map((p) => (
                <li
                  key={p.id}
                  id={`bh-post-${p.id}`}
                  className={`bh-card bh-post bh-reply ${p.is_me ? 'is-me' : ''} ${p.tagged_is_me ? 'is-tagged-me' : ''} ${highlight === p.id ? 'is-target' : ''}`}
                >
                  <span className="bh-lb-avatar" aria-hidden="true">{p.avatar_emoji}</span>
                  <div className="bh-post-main">
                    <div className="bh-post-head">
                      <b>{p.handle}{p.is_me ? ' (you)' : ''}</b>
                      <small title={new Date(p.created_at).toLocaleString()}>{timeAgo(p.created_at, now)}</small>
                    </div>
                    {p.reply_to && (
                      p.reply_to.removed ? (
                        <span className="bh-quote">↪ Replying to a message that was removed</span>
                      ) : (
                        <button type="button" className="bh-quote" onClick={() => jumpTo(p.reply_to!.id)}>
                          ↪ <b>{p.reply_to.handle}</b>: {snippet(p.reply_to.preview, 80)}
                        </button>
                      )
                    )}
                    <p className="bh-post-body"><MessageText text={p.body} /></p>
                    {p.pick && <PickCard pick={p.pick} />}
                    {p.tagged_handle && (
                      <span className={`bh-tagged ${p.tagged_is_me ? 'is-me' : ''}`}>
                        🏷 {p.tagged_is_me ? 'You were tagged' : `${p.tagged_handle} was tagged`}
                      </span>
                    )}
                    <BanterReactions
                      kind="post"
                      id={p.id}
                      counts={p.reactions}
                      mine={p.my_reaction}
                      pingKeys={[leagueId ? liveKey.league(leagueId) : null, p.is_me ? null : liveKey.member(p.handle)]}
                    />
                    <div className="bh-reply-actions">
                      <button type="button" className="bh-link" onClick={() => startReply(p)}>↩ Reply</button>
                      {p.can_delete && (
                        <button type="button" className="bh-link-danger" onClick={() => remove(p.id)}>Delete</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {hasMore && (
            <button type="button" className="bh-btn bh-more" onClick={loadMore} disabled={busy}>Load older posts</button>
          )}
        </>
      )}
    </div>
  );
}
