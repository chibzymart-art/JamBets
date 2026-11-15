import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { searchHandles, type HandleSuggestion } from './banterApi';
import { mentionQueryAt, splitMentions } from './banterRules';
import './banter.css';

/** Message text with @mentions highlighted. Plain text only: React escapes it, nothing is linked. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {splitMentions(text).map((part, i) =>
        part.mention ? <span key={i} className="bh-mention">{part.text}</span> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (v: string) => void;
  /** On a league wall: suggest only that league's members. */
  leagueId?: string | null;
  /** In a topic: the people in it are suggested first, straight after "@". */
  topicId?: string | null;
};

/**
 * A textarea that suggests usernames after "@" (up to 8, from the server). Arrow keys / Enter / Tab
 * pick, Escape closes; tapping a name inserts "@name ". The server decides who is really mentioned.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement | null, Props>(function MentionTextarea(
  { value, onValueChange, leagueId = null, topicId = null, onKeyDown, ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  const [query, setQuery] = useState<{ prefix: string; start: number } | null>(null);
  const [items, setItems] = useState<HandleSuggestion[]>([]);
  const [active, setActive] = useState(0);

  const refreshQuery = () => {
    const el = inner.current;
    if (!el) return;
    setQuery(mentionQueryAt(el.value, el.selectionStart ?? el.value.length));
  };

  useEffect(() => {
    if (!query) { setItems([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchHandles(query.prefix, leagueId, topicId);
      if (live) { setItems(r.ok ? r.data || [] : []); setActive(0); }
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [query?.prefix, query?.start, leagueId, topicId]);

  const pick = (h: HandleSuggestion) => {
    const el = inner.current;
    if (!el || !query) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${h.handle} ${value.slice(caret)}`;
    onValueChange(next);
    setQuery(null);
    setItems([]);
    const pos = query.start + h.handle.length + 2;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  };

  const open = !!query && items.length > 0;

  return (
    <div className="bh-mention-wrap">
      <textarea
        {...rest}
        ref={inner}
        value={value}
        onChange={(e) => { onValueChange(e.target.value); requestAnimationFrame(refreshQuery); }}
        onClick={refreshQuery}
        onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refreshQuery(); }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[active]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
          }
          onKeyDown?.(e);
        }}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <ul className="bh-mention-list" role="listbox" aria-label="Mention someone">
          {items.map((h, i) => (
            <li key={h.handle} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`bh-mention-opt ${i === active ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
              >
                <span aria-hidden="true">{h.avatar_emoji}</span> @{h.handle}
                {h.in_thread && <small className="bh-mention-here">{leagueId ? 'in this league' : 'in this topic'}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
