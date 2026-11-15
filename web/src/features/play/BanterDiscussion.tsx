import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createTopic,
  deleteReply,
  deleteTopic,
  fetchNotifications,
  fetchTopic,
  fetchTopics,
  markNotificationsRead,
  postReply,
  type BanterNotification,
  type TopicDetail,
  type TopicReply,
  type TopicSummary,
} from './banterApi';
import {
  REPLY_MAX,
  TOPIC_BODY_MAX,
  TOPIC_PAGE,
  TOPIC_TITLE_MAX,
  charsLeft,
  discussionErrorMessage,
  notificationLine,
  snippet,
  timeAgo,
  topicTitleValid,
} from './banterRules';
import './banter.css';

/**
 * Banter Hub Discussion: every conversation is a topic. Members open a topic and reply, or reply to
 * one message, which tags its author in the thread and notifies them in-app ("Replies to you").
 * All topics are visible to paid members. Text is rendered as plain text only (React escapes it;
 * no HTML, no auto-linking). The open topic lives in the address (?topic=<id>) so it can be shared.
 */
export function BanterDiscussion({ onNotificationsChanged }: { onNotificationsChanged?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const topicId = searchParams.get('topic');
  const focusReply = searchParams.get('reply');

  const openTopic = (id: string, replyId?: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('topic', id);
    if (replyId) next.set('reply', replyId); else next.delete('reply');
    setSearchParams(next);
    window.scrollTo({ top: 0 });
  };
  const closeTopic = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('topic');
    next.delete('reply');
    setSearchParams(next);
  };

  return topicId ? (
    <TopicView key={topicId} topicId={topicId} focusReply={focusReply} onBack={closeTopic} />
  ) : (
    <TopicList onOpen={openTopic} onNotificationsChanged={onNotificationsChanged} />
  );
}

// ---------------------------------------------------------------------------
// Topic list + new topic + "Replies to you"
// ---------------------------------------------------------------------------

function TopicList({
  onOpen,
  onNotificationsChanged,
}: {
  onOpen: (id: string, replyId?: string) => void;
  onNotificationsChanged?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<TopicSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setNow(Date.now());
    const r = await fetchTopics(query, TOPIC_PAGE, 0);
    if (!r.ok) { setLoadError(discussionErrorMessage(r.code)); setTopics([]); setHasMore(false); return; }
    setLoadError(null);
    setTopics(r.data || []);
    setHasMore((r.data || []).length === TOPIC_PAGE);
  }, [query]);

  useEffect(() => {
    setTopics(null);
    load();
  }, [load]);

  const loadMore = async () => {
    if (!topics) return;
    setBusy(true);
    const r = await fetchTopics(query, TOPIC_PAGE, topics.length);
    setBusy(false);
    if (!r.ok) { setError(discussionErrorMessage(r.code)); return; }
    const more = r.data || [];
    setTopics((t) => [...(t || []), ...more.filter((m) => !(t || []).some((x) => x.id === m.id))]);
    setHasMore(more.length === TOPIC_PAGE);
  };

  const titleLeft = charsLeft(title, TOPIC_TITLE_MAX);
  const bodyLeft = charsLeft(body, TOPIC_BODY_MAX);
  const canPost = topicTitleValid(title) && body.trim().length > 0 && bodyLeft >= 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!topicTitleValid(title)) { setError(discussionErrorMessage('title_invalid')); return; }
    if (!canPost) { setError(discussionErrorMessage('body_invalid')); return; }
    setBusy(true);
    const r = await createTopic(title, body);
    setBusy(false);
    if (!r.ok) { setError(discussionErrorMessage(r.code)); return; }
    setTitle('');
    setBody('');
    setComposing(false);
    onOpen(r.data.id);
  };

  const remove = async (id: string) => {
    setError(null);
    const r = await deleteTopic(id);
    if (!r.ok) { setError(discussionErrorMessage(r.code)); return; }
    setTopics((t) => (t || []).filter((x) => x.id !== id));
  };

  return (
    <div className="bh-wall">
      <div className="bh-sec">
        <h2>Discussion</h2>
        <button type="button" className="bh-link" onClick={load} aria-label="Refresh topics">↻ Refresh</button>
      </div>

      {loadError ? (
        <p className="bh-error" role="alert">{loadError}</p>
      ) : (
        <>
          <RepliesToYou onOpen={onOpen} onChanged={onNotificationsChanged} />

          {composing ? (
            <form className="bh-card bh-wall-form" onSubmit={submit}>
              <label className="bh-mkt-label" htmlFor="bh-topic-title">Topic title</label>
              <input
                id="bh-topic-title"
                className="bh-input"
                value={title}
                maxLength={TOPIC_TITLE_MAX + 20}
                placeholder="e.g. Who wins the title this season?"
                onChange={(e) => setTitle(e.target.value)}
                autoComplete="off"
              />
              <div className="bh-inline bh-wall-actions">
                <span className={`bh-counter ${titleLeft < 0 ? 'is-over' : titleLeft <= 15 ? 'is-near' : ''}`}>{titleLeft}</span>
              </div>
              <label className="bh-mkt-label" htmlFor="bh-topic-body">Start the discussion</label>
              <textarea
                id="bh-topic-body"
                className="bh-input bh-textarea"
                value={body}
                rows={4}
                maxLength={TOPIC_BODY_MAX + 50}
                placeholder="Say what you think. Others can reply in the topic."
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="bh-inline bh-wall-actions">
                <span className={`bh-counter ${bodyLeft < 0 ? 'is-over' : bodyLeft <= 50 ? 'is-near' : ''}`} aria-live="polite">{bodyLeft}</span>
                <button type="button" className="bh-link" onClick={() => { setComposing(false); setError(null); }}>Cancel</button>
                <button type="submit" className="bh-btn" disabled={busy || !canPost}>Post topic</button>
              </div>
              <p className="bh-note">Every topic is visible to all members. Keep it friendly. Plain text only.</p>
            </form>
          ) : (
            <button type="button" className="bh-btn" onClick={() => setComposing(true)}>＋ Start a topic</button>
          )}

          {error && <p className="bh-error" role="alert">{error}</p>}

          <div className="bh-inline bh-disc-search">
            <input
              className="bh-input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search topics"
              aria-label="Search topics"
              autoComplete="off"
            />
          </div>

          {topics === null ? (
            <p className="bh-muted" aria-busy="true">Loading topics…</p>
          ) : topics.length === 0 ? (
            <div className="bh-card bh-empty">
              <p>{query ? 'No topic matches that search.' : 'No topics yet. Start the first one.'}</p>
            </div>
          ) : (
            <ul className="bh-topics">
              {topics.map((t) => (
                <li key={t.id} className={`bh-card bh-post ${t.is_me ? 'is-me' : ''}`}>
                  <span className="bh-lb-avatar" aria-hidden="true">{t.avatar_emoji}</span>
                  <div className="bh-post-main">
                    <button type="button" className="bh-topic-row bh-link" onClick={() => onOpen(t.id)}>
                      <span className="bh-post-main">
                        <span className="bh-topic-title">{t.title}</span>
                        <span className="bh-topic-preview">{t.preview}</span>
                      </span>
                    </button>
                    <div className="bh-topic-meta">
                      <span>{t.handle}{t.is_me ? ' (you)' : ''}</span>
                      <span>💬 {t.replies} {t.replies === 1 ? 'reply' : 'replies'}</span>
                      <span title={new Date(t.last_activity_at).toLocaleString()}>active {timeAgo(t.last_activity_at, now)}</span>
                      {t.can_delete && (
                        <button type="button" className="bh-link-danger" onClick={() => remove(t.id)}>Delete</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {hasMore && (
            <button type="button" className="bh-btn bh-more" onClick={loadMore} disabled={busy}>Load more topics</button>
          )}
        </>
      )}
    </div>
  );
}

function RepliesToYou({
  onOpen,
  onChanged,
}: {
  onOpen: (id: string, replyId?: string) => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<BanterNotification[] | null>(null);
  const [open, setOpen] = useState(false);
  const now = Date.now();

  useEffect(() => {
    let live = true;
    fetchNotifications(30).then((r) => {
      if (live) setItems(r.ok ? r.data || [] : []);
    });
    return () => { live = false; };
  }, []);

  if (!items || items.length === 0) return null;
  const unread = items.filter((n) => !n.is_read);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    // Opening the list marks what it shows as read.
    if (next && unread.length > 0) {
      const r = await markNotificationsRead(unread.map((n) => n.id));
      if (r.ok) {
        setItems((all) => (all || []).map((n) => ({ ...n, is_read: true })));
        onChanged?.();
      }
    }
  };

  return (
    <div className="bh-notifs">
      <button type="button" className="bh-link bh-notif-toggle" onClick={toggle} aria-expanded={open}>
        🔔 Replies to you
        {unread.length > 0 && <span className="bh-notif-count">{unread.length}</span>}
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="bh-notif-list">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`bh-notif ${n.is_read ? '' : 'is-unread'}`}
                onClick={() => onOpen(n.topic_id, n.reply_id)}
              >
                <span className="bh-lb-avatar" aria-hidden="true">{n.from_avatar}</span>
                <span>
                  <b>{notificationLine(n.kind, n.from_handle)}</b> · <small style={{ display: 'inline' }}>{timeAgo(n.created_at, now)}</small>
                  <small>in “{n.topic_title}”: {snippet(n.preview, 90)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One topic with its replies
// ---------------------------------------------------------------------------

function TopicView({ topicId, focusReply, onBack }: { topicId: string; focusReply: string | null; onBack: () => void }) {
  const [data, setData] = useState<TopicDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<TopicReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [highlight, setHighlight] = useState<string | null>(focusReply);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setNow(Date.now());
    const r = await fetchTopic(topicId);
    if (!r.ok) { setLoadError(discussionErrorMessage(r.code)); return; }
    setLoadError(null);
    setData(r.data);
  }, [topicId]);

  useEffect(() => { load(); }, [load]);

  // Coming from "Replies to you": scroll to that message once it is on screen.
  useEffect(() => {
    if (!data || !highlight) return;
    const el = document.getElementById(`bh-reply-${highlight}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [data, highlight]);

  const left = charsLeft(body, REPLY_MAX);

  const startReplyTo = (r: TopicReply) => {
    setReplyTo(r);
    setTimeout(() => boxRef.current?.focus(), 0);
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(`bh-reply-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setHighlight(id); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (left < 0 || body.trim().length === 0) { setError(`Replies need 1 to ${REPLY_MAX} characters.`); return; }
    setBusy(true);
    const r = await postReply(topicId, body, replyTo ? replyTo.id : null);
    setBusy(false);
    if (!r.ok) { setError(discussionErrorMessage(r.code)); return; }
    setBody('');
    setReplyTo(null);
    await load();
    setHighlight(r.data.id);
  };

  const removeReply = async (id: string) => {
    setError(null);
    const r = await deleteReply(id);
    if (!r.ok) { setError(discussionErrorMessage(r.code)); return; }
    await load();
  };

  const removeTopic = async () => {
    setError(null);
    const r = await deleteTopic(topicId);
    if (!r.ok) { setError(discussionErrorMessage(r.code)); return; }
    onBack();
  };

  return (
    <div className="bh-wall">
      <div className="bh-sec">
        <button type="button" className="bh-link bh-back" onClick={onBack}>← All topics</button>
        <button type="button" className="bh-link" onClick={load} aria-label="Refresh this topic">↻ Refresh</button>
      </div>

      {loadError ? (
        <p className="bh-error" role="alert">{loadError}</p>
      ) : data === null ? (
        <p className="bh-muted" aria-busy="true">Loading the topic…</p>
      ) : (
        <>
          <article className={`bh-card bh-post bh-topic-head ${data.topic.is_me ? 'is-me' : ''}`}>
            <span className="bh-lb-avatar" aria-hidden="true">{data.topic.avatar_emoji}</span>
            <div className="bh-post-main">
              <div className="bh-post-head">
                <b>{data.topic.handle}{data.topic.is_me ? ' (you)' : ''}</b>
                <small title={new Date(data.topic.created_at).toLocaleString()}>{timeAgo(data.topic.created_at, now)}</small>
                {data.topic.can_delete && (
                  <button type="button" className="bh-link-danger" onClick={removeTopic}>Delete topic</button>
                )}
              </div>
              <h2>{data.topic.title}</h2>
              <p className="bh-post-body">{data.topic.body}</p>
            </div>
          </article>

          <div className="bh-sec">
            <h2>{data.replies.length} {data.replies.length === 1 ? 'reply' : 'replies'}</h2>
          </div>

          {data.replies.length === 0 ? (
            <div className="bh-card bh-empty"><p>No replies yet. Be the first.</p></div>
          ) : (
            <ul className="bh-replies">
              {data.replies.map((r) => (
                <li
                  key={r.id}
                  id={`bh-reply-${r.id}`}
                  className={`bh-card bh-post bh-reply ${r.is_me ? 'is-me' : ''} ${r.tagged_is_me ? 'is-tagged-me' : ''} ${highlight === r.id ? 'is-target' : ''}`}
                >
                  <span className="bh-lb-avatar" aria-hidden="true">{r.avatar_emoji}</span>
                  <div className="bh-post-main">
                    <div className="bh-post-head">
                      <b>{r.handle}{r.is_me ? ' (you)' : ''}</b>
                      <small title={new Date(r.created_at).toLocaleString()}>{timeAgo(r.created_at, now)}</small>
                    </div>
                    {r.reply_to && (
                      r.reply_to.removed ? (
                        <span className="bh-quote">↪ Replying to a message that was removed</span>
                      ) : (
                        <button type="button" className="bh-quote" onClick={() => jumpTo(r.reply_to!.id)}>
                          ↪ <b>{r.reply_to.handle}</b>: {snippet(r.reply_to.preview, 80)}
                        </button>
                      )
                    )}
                    <p className="bh-post-body">{r.body}</p>
                    {r.tagged_handle && (
                      <span className={`bh-tagged ${r.tagged_is_me ? 'is-me' : ''}`}>
                        🏷 {r.tagged_is_me ? 'You were tagged' : `${r.tagged_handle} was tagged`}
                      </span>
                    )}
                    <div className="bh-reply-actions">
                      {!r.is_me && (
                        <button type="button" className="bh-link" onClick={() => startReplyTo(r)}>↩ Reply</button>
                      )}
                      {r.can_delete && (
                        <button type="button" className="bh-link-danger" onClick={() => removeReply(r.id)}>Delete</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form className="bh-card bh-wall-form" onSubmit={submit}>
            {replyTo && (
              <div className="bh-replying">
                <span>↩ Replying to <b>{replyTo.handle}</b>: {snippet(replyTo.body, 60)}</span>
                <button type="button" className="bh-link" onClick={() => setReplyTo(null)} aria-label="Stop replying to this message">✕</button>
              </div>
            )}
            <label className="bh-mkt-label" htmlFor="bh-reply-box">{replyTo ? `Your reply to ${replyTo.handle}` : 'Reply in this topic'}</label>
            <textarea
              id="bh-reply-box"
              ref={boxRef}
              className="bh-input bh-textarea"
              value={body}
              rows={3}
              maxLength={REPLY_MAX + 40}
              placeholder="Join the discussion…"
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="bh-inline bh-wall-actions">
              <span className={`bh-counter ${left < 0 ? 'is-over' : left <= 30 ? 'is-near' : ''}`} aria-live="polite">{left}</span>
              <button type="submit" className="bh-btn" disabled={busy || left < 0 || body.trim().length === 0}>Reply</button>
            </div>
            <p className="bh-note">
              {replyTo ? `${replyTo.handle} will be tagged and notified.` : 'Tap ↩ Reply on a message to answer someone directly; they get notified.'}
            </p>
          </form>

          {error && <p className="bh-error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
