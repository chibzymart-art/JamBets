import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchNotifications, markNotificationsRead, type BanterNotification } from './banterApi';
import { notificationHref, notificationLine, snippet, timeAgo } from './banterRules';
import './banter.css';

/**
 * "Replies to you": replies in Discussion and on league walls, newest first. Shown on both the
 * Discussion and Leagues tabs. Opening the list marks what it shows as read.
 */
export function RepliesToYou({ onChanged }: { onChanged?: () => void }) {
  const navigate = useNavigate();
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
    if (next && unread.length > 0) {
      const r = await markNotificationsRead(unread.map((n) => n.id));
      if (r.ok) {
        setItems((all) => (all || []).map((n) => ({ ...n, is_read: true })));
        onChanged?.();
      }
    }
  };

  const go = (n: BanterNotification) => {
    navigate(notificationHref(n));
    window.scrollTo({ top: 0 });
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
              <button type="button" className={`bh-notif ${n.is_read ? '' : 'is-unread'}`} onClick={() => go(n)}>
                <span className="bh-lb-avatar" aria-hidden="true">{n.from_avatar}</span>
                <span>
                  <b>{notificationLine(n.kind, n.from_handle)}</b> · <small style={{ display: 'inline' }}>{timeAgo(n.created_at, now)}</small>
                  <small>
                    {n.kind === 'league_reply' ? `in league “${n.league_name}”` : `in “${n.topic_title}”`}: {snippet(n.preview, 90)}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
