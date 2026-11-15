import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchNotifications, markNotificationsRead, type BanterNotification } from './banterApi';
import { notificationHref, notificationLine, snippet, timeAgo } from './banterRules';
import { notifyLocal, onLocalNotify } from './banterLive';
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

  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetchNotifications(30).then((r) => {
      if (!live) return;
      // A passing error keeps what is shown; the first load shows nothing on error.
      if (r.ok) setItems(r.data || []);
      else setItems((cur) => cur || []);
    });
    return () => { live = false; };
  }, [tick]);

  // Live: new replies and tags appear without leaving the page. The hub's member channel (a ping
  // or its 15-second poll) and this tab's own actions call notifyLocal.
  useEffect(() => onLocalNotify(() => setTick((t) => t + 1)), []);

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
        notifyLocal();
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
