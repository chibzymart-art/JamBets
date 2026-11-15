import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { deleteWallPost, fetchWall, postToWall, type WallPost } from './banterApi';
import { WALL_MAX, WALL_PAGE, timeAgo, wallCharsLeft, wallErrorMessage } from './banterRules';
import './banter.css';

/**
 * A Banter wall: the public wall (leagueId null) or one league's wall. Newest first, load more,
 * post box with a character counter, delete own posts (admins: any), manual refresh.
 * Post text is rendered as plain text only (React escapes it; no HTML, no auto-linking).
 */
export function BanterWall({ leagueId = null, title = 'Banter wall' }: { leagueId?: string | null; title?: string }) {
  const [posts, setPosts] = useState<WallPost[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (left < 0 || body.trim().length === 0) { setError(wallErrorMessage('body_invalid')); return; }
    setBusy(true);
    const r = await postToWall(body, leagueId);
    setBusy(false);
    if (!r.ok) { setError(wallErrorMessage(r.code)); return; }
    setBody('');
    await load();
  };

  const remove = async (id: string) => {
    setError(null);
    const r = await deleteWallPost(id);
    if (!r.ok) { setError(wallErrorMessage(r.code)); return; }
    setPosts((p) => (p || []).filter((x) => x.id !== id));
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
            <label className="bh-mkt-label" htmlFor={`bh-wall-${leagueId || 'public'}`}>Say something</label>
            <textarea
              id={`bh-wall-${leagueId || 'public'}`}
              className="bh-input bh-textarea"
              value={body}
              rows={3}
              maxLength={WALL_MAX + 40}
              placeholder={leagueId ? 'Banter with your league…' : 'Banter with other members…'}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="bh-inline bh-wall-actions">
              <span className={`bh-counter ${left < 0 ? 'is-over' : left <= 20 ? 'is-near' : ''}`} aria-live="polite">{left}</span>
              <button type="submit" className="bh-btn" disabled={busy || left < 0 || body.trim().length === 0}>Post</button>
            </div>
            <p className="bh-note">Keep it friendly. Plain text, up to {WALL_MAX} characters.</p>
          </form>

          {error && <p className="bh-error" role="alert">{error}</p>}

          {posts === null ? (
            <p className="bh-muted" aria-busy="true">Loading the wall…</p>
          ) : posts.length === 0 ? (
            <div className="bh-card bh-empty"><p>No posts yet. Start the banter.</p></div>
          ) : (
            <ul className="bh-posts">
              {posts.map((p) => (
                <li key={p.id} className={`bh-card bh-post ${p.is_me ? 'is-me' : ''}`}>
                  <span className="bh-lb-avatar" aria-hidden="true">{p.avatar_emoji}</span>
                  <div className="bh-post-main">
                    <div className="bh-post-head">
                      <b>{p.handle}{p.is_me ? ' (you)' : ''}</b>
                      <small title={new Date(p.created_at).toLocaleString()}>{timeAgo(p.created_at, now)}</small>
                      {p.can_delete && (
                        <button type="button" className="bh-link-danger" onClick={() => remove(p.id)}>Delete</button>
                      )}
                    </div>
                    <p className="bh-post-body">{p.body}</p>
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
