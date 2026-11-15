import { useEffect, useState } from 'react';
import { react, type ReactionCounts, type ReactionKind, type ReactionTarget } from './banterApi';
import { REACTIONS, applyReaction } from './banterRules';
import { sendPing } from './banterLive';
import { notifyPush } from './banterPush';
import './banter.css';

/**
 * The five reactions under a message. One per member: tap to react, tap another to change, tap the
 * same to remove. Counts update at once (and are corrected by the server's answer); the writer is
 * notified by the server. Hidden until the reactions database change is applied (counts missing).
 */
export function BanterReactions({
  kind,
  id,
  counts,
  mine,
  pingKeys = [],
}: {
  kind: ReactionTarget;
  id: string;
  counts: ReactionCounts | null | undefined;
  mine: ReactionKind | null | undefined;
  /** Live channels to ping after reacting (the conversation, the writer's member channel). */
  pingKeys?: (string | null | undefined)[];
}) {
  const [state, setState] = useState<{ counts: ReactionCounts; mine: ReactionKind | null }>({ counts: counts || {}, mine: mine || null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // Live refreshes bring new server counts; take them unless a tap is in flight.
  useEffect(() => {
    if (!busy) setState({ counts: counts || {}, mine: mine || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(counts || {}), mine]);

  if (counts === undefined) return null;

  const tap = async (r: ReactionKind) => {
    if (busy) return;
    const before = state;
    setState(applyReaction(state, r));
    setBusy(true);
    setError(false);
    const res = await react(kind, id, r);
    setBusy(false);
    if (!res.ok) {
      setState(before);
      setError(true);
      setTimeout(() => setError(false), 2500);
      return;
    }
    setState({ counts: res.data.counts || {}, mine: (res.data.mine as ReactionKind | null) || null });
    if (res.data.state !== 'removed' && res.data.reaction_id) notifyPush('reaction', res.data.reaction_id);
    sendPing(...pingKeys);
  };

  return (
    <div className="bh-reactions" role="group" aria-label="Reactions">
      {REACTIONS.map((r) => {
        const n = state.counts[r.id] || 0;
        const on = state.mine === r.id;
        return (
          <button
            key={r.id}
            type="button"
            className={`bh-react ${on ? 'is-mine' : ''} ${n > 0 ? 'has-count' : ''}`}
            onClick={() => tap(r.id)}
            aria-pressed={on}
            aria-label={`${r.label}${n ? `, ${n}` : ''}`}
            title={r.label}
          >
            <span aria-hidden="true">{r.emoji}</span>
            {n > 0 && <small>{n}</small>}
          </button>
        );
      })}
      {error && <small className="bh-react-error" role="status">Couldn't react. Try again.</small>}
    </div>
  );
}
