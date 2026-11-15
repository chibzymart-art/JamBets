import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createLeague,
  fetchLeagueTable,
  fetchMyLeagues,
  fetchPublicLeagues,
  joinLeague,
  joinPublicLeague,
  leaveLeague,
  setLeaguePublic,
  type BanterLeagueSummary,
  type PublicLeague,
  type LeaderboardPeriod,
  type LeaderboardRow,
} from './banterApi';
import {
  LEAGUE_NAME_MAX,
  LEAGUE_NAME_MIN,
  formatPoints,
  inviteLink,
  leagueErrorMessage,
  normaliseInvite,
  telegramShareUrl,
  whatsappShareUrl,
} from './banterRules';
import { BanterWall } from './BanterWall';
import { RepliesToYou } from './BanterRepliesToYou';
import { LeagueMuteButton } from './BanterPushUI';
import { notifyPush } from './banterPush';
import './banter.css';

/**
 * Banter Hub leagues: create a public or private one, share the invite link, join with a code or
 * link, browse and join public leagues, and see each league's week / month / all-time table.
 * Paid members only (server-checked).
 */

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

export function BanterLeagues({ onNotificationsChanged }: { onNotificationsChanged?: () => void } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // From "Replies to you": ?league=<id>&post=<id> opens that league and scrolls to the post.
  const linkLeague = searchParams.get('league');
  const linkPost = searchParams.get('post');
  const [leagues, setLeagues] = useState<BanterLeagueSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(linkLeague);
  useEffect(() => { if (linkLeague) setOpenId(linkLeague); }, [linkLeague, linkPost]);

  const [newName, setNewName] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [publicKey, setPublicKey] = useState(0);
  const [joinCode, setJoinCode] = useState(() => normaliseInvite(searchParams.get('join') || ''));
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchMyLeagues();
    if (!r.ok) {
      setLoadError(leagueErrorMessage(r.code));
      setLeagues([]);
      return;
    }
    setLoadError(null);
    setLeagues(r.data || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clearJoinParam = () => {
    if (searchParams.get('join')) {
      const next = new URLSearchParams(searchParams);
      next.delete('join');
      setSearchParams(next, { replace: true });
    }
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const name = newName.trim();
    if (name.length < LEAGUE_NAME_MIN || name.length > LEAGUE_NAME_MAX) {
      setFormError(leagueErrorMessage('name_invalid'));
      return;
    }
    setBusy(true);
    const r = await createLeague(name, newPublic);
    setBusy(false);
    if (!r.ok) { setFormError(leagueErrorMessage(r.code)); return; }
    setNewName('');
    setNotice(
      newPublic
        ? `"${r.data.name}" is ready and listed in Public leagues. You can also share the invite link below.`
        : `"${r.data.name}" is ready. Share the invite link below.`,
    );
    setNewPublic(false);
    setPublicKey((k) => k + 1);
    await load();
    setOpenId(r.data.league_id);
  };

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const code = normaliseInvite(joinCode);
    if (code.length !== 8) { setFormError(leagueErrorMessage('league_not_found')); return; }
    setBusy(true);
    const r = await joinLeague(code);
    setBusy(false);
    if (!r.ok) { setFormError(leagueErrorMessage(r.code)); return; }
    if (!r.data.already_member) notifyPush('join', r.data.league_id);
    setJoinCode('');
    clearJoinParam();
    setNotice(r.data.already_member ? `You're already in "${r.data.name}".` : `You joined "${r.data.name}".`);
    await load();
    setOpenId(r.data.league_id);
  };

  const onLeft = async (message: string) => {
    setOpenId(null);
    setNotice(message);
    setPublicKey((k) => k + 1);
    await load();
  };

  const onPublicChanged = async (message: string, openLeagueId?: string) => {
    setNotice(message);
    await load();
    if (openLeagueId) setOpenId(openLeagueId);
  };

  if (leagues === null) return <p className="bh-muted" aria-busy="true">Loading your leagues…</p>;

  return (
    <div className="bh-today">
      {loadError && <p className="bh-error" role="alert">{loadError}</p>}
      {notice && <p className="bh-notice" role="status">{notice}</p>}
      {!loadError && <RepliesToYou key={`${linkLeague}-${linkPost}`} onChanged={onNotificationsChanged} />}

      {!loadError && (
        <>
          <div className="bh-sec"><h2>Your leagues</h2><small>{leagues.length}</small></div>
          {leagues.length === 0 ? (
            <div className="bh-card bh-empty"><p>You're not in a league yet. Create one for your friends, or join with an invite code.</p></div>
          ) : (
            <div className="bh-list">
              {leagues.map((l) => (
                <LeagueCard
                  key={l.league_id}
                  league={l}
                  open={openId === l.league_id}
                  onToggle={() => setOpenId(openId === l.league_id ? null : l.league_id)}
                  onLeft={onLeft}
                  focusPostId={l.league_id === linkLeague ? linkPost : null}
                  onVisibilityChanged={() => { setPublicKey((k) => k + 1); load(); }}
                />
              ))}
            </div>
          )}

          <div className="bh-card bh-forms">
            <form onSubmit={onJoin} className="bh-form-row">
              <label htmlFor="bh-join" className="bh-mkt-label">Join with a code or link</label>
              <div className="bh-inline">
                <input
                  id="bh-join"
                  className="bh-input"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="e.g. 7F3A9C2B"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" className="bh-btn" disabled={busy}>Join</button>
              </div>
            </form>
            <form onSubmit={onCreate} className="bh-form-row">
              <label htmlFor="bh-create" className="bh-mkt-label">Create a league</label>
              <div className="bh-inline">
                <input
                  id="bh-create"
                  className="bh-input"
                  value={newName}
                  maxLength={LEAGUE_NAME_MAX}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Office Gaffers"
                  autoComplete="off"
                />
                <button type="submit" className="bh-btn" disabled={busy}>Create</button>
              </div>
              <div className="bh-seg bh-vis-choice" role="radiogroup" aria-label="Who can find this league">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!newPublic}
                  className={`bh-seg-btn ${!newPublic ? 'is-active' : ''}`}
                  onClick={() => setNewPublic(false)}
                >
                  🔒 Private
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={newPublic}
                  className={`bh-seg-btn ${newPublic ? 'is-active' : ''}`}
                  onClick={() => setNewPublic(true)}
                >
                  🌍 Public
                </button>
              </div>
              <p className="bh-note">
                {newPublic
                  ? 'Public: listed for every member to find and join. You can switch it to private later.'
                  : 'Private: hidden. Only people you send the invite code or link to can join.'}
              </p>
            </form>
            {formError && <p className="bh-error" role="alert">{formError}</p>}
          </div>

          <PublicLeagues key={publicKey} onChanged={onPublicChanged} />
        </>
      )}
    </div>
  );
}

function LeagueCard({
  league,
  open,
  onToggle,
  onLeft,
  onVisibilityChanged,
  focusPostId = null,
}: {
  league: BanterLeagueSummary;
  open: boolean;
  onToggle: () => void;
  onLeft: (message: string) => void;
  onVisibilityChanged: () => void;
  focusPostId?: string | null;
}) {
  const [isPublic, setIsPublic] = useState(!!league.is_public);
  const [savingVis, setSavingVis] = useState(false);
  useEffect(() => { setIsPublic(!!league.is_public); }, [league.is_public]);
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setRows(null);
    fetchLeagueTable(league.league_id, period).then((r) => {
      if (!live) return;
      if (!r.ok) { setError(leagueErrorMessage(r.code)); setRows([]); return; }
      setError(null);
      setRows(r.data || []);
    });
    return () => { live = false; };
  }, [open, period, league.league_id]);

  const link = inviteLink(league.invite_code);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const leave = async () => {
    if (!confirmLeave) { setConfirmLeave(true); return; }
    const r = await leaveLeague(league.league_id);
    if (!r.ok) { setError(leagueErrorMessage(r.code)); setConfirmLeave(false); return; }
    onLeft(r.data === 'deleted' ? `"${league.name}" was deleted.` : `You left "${league.name}".`);
  };

  const toggleVisibility = async () => {
    const next = !isPublic;
    setSavingVis(true);
    const r = await setLeaguePublic(league.league_id, next);
    setSavingVis(false);
    if (!r.ok) {
      setError(r.code === 'not_ready' ? leagueErrorMessage('public_not_ready') : leagueErrorMessage(r.code));
      return;
    }
    setError(null);
    setIsPublic(next);
    onVisibilityChanged();
  };

  return (
    <article className="bh-card bh-league">
      <button type="button" className="bh-league-head" onClick={onToggle} aria-expanded={open}>
        <span className="bh-league-icon" aria-hidden="true">👥</span>
        <span className="bh-league-title">
          <b>
            {league.name}{' '}
            <span className={`bh-vis-badge ${isPublic ? 'is-public' : ''}`}>{isPublic ? 'Public' : 'Private'}</span>
          </b>
          <small>{league.members} {league.members === 1 ? 'member' : 'members'}{league.is_owner ? ' · you created it' : ''}</small>
        </span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="bh-league-body">
          <div className="bh-invite">
            <span className="bh-invite-link" title={link}>{link}</span>
            <button type="button" className="bh-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <div className="bh-inline">
            <a className="bh-btn bh-btn-wa" href={whatsappShareUrl(league.name, league.invite_code)} target="_blank" rel="noopener noreferrer">Share to WhatsApp</a>
            <a className="bh-btn" href={telegramShareUrl(league.name, league.invite_code)} target="_blank" rel="noopener noreferrer">Telegram</a>
          </div>
          <p className="bh-note">Invite code: <b>{league.invite_code}</b></p>

          {league.is_owner && (
            <div className="bh-vis-row">
              <span>
                <b>{isPublic ? '🌍 Public' : '🔒 Private'}</b>
                <small>{isPublic ? 'Anyone in the Banter Hub can find and join.' : 'Hidden. Invite code or link only.'}</small>
              </span>
              <button type="button" className="bh-btn" onClick={toggleVisibility} disabled={savingVis}>
                {savingVis ? 'Saving…' : isPublic ? 'Make private' : 'Make public'}
              </button>
            </div>
          )}

          <div className="bh-seg" role="tablist" aria-label="League table period">
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

          {error && <p className="bh-error" role="alert">{error}</p>}
          {rows === null ? (
            <p className="bh-muted" aria-busy="true">Loading table…</p>
          ) : (
            <ol className="bh-lb-list bh-lb">
              {rows.map((r) => (
                <li key={`${r.place}-${r.handle}`} className={`bh-lb-row ${r.is_me ? 'is-me' : ''}`}>
                  <span className="bh-lb-place">{r.place}</span>
                  <span className="bh-lb-avatar" aria-hidden="true">{r.avatar_emoji}</span>
                  <span className="bh-lb-who">
                    <b>{r.handle}{r.is_me ? ' (you)' : ''}</b>
                    <small>{r.settled} picks · {r.won} won · {r.lost} lost</small>
                  </span>
                  <span className="bh-lb-score">
                    <b>{formatPoints(r.points)}</b>
                    <small>{Number(r.hit_rate)}% hit</small>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <BanterWall leagueId={league.league_id} title="League wall" focusPostId={focusPostId} />

          <div className="bh-inline bh-league-actions">
            <LeagueMuteButton leagueId={league.league_id} />
            <button type="button" className="bh-link-danger" onClick={leave}>
              {confirmLeave
                ? league.is_owner ? 'Tap again to delete this league for everyone' : 'Tap again to leave'
                : league.is_owner ? 'Delete league' : 'Leave league'}
            </button>
            {confirmLeave && (
              <button type="button" className="bh-link" onClick={() => setConfirmLeave(false)}>Cancel</button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** Public leagues anyone in the Banter Hub can join or leave at will. Invite codes are never shown here. */
function PublicLeagues({ onChanged }: { onChanged: (message: string, openLeagueId?: string) => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<'newest' | 'biggest'>('newest');
  const [rows, setRows] = useState<PublicLeague[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    setRows(null);
    fetchPublicLeagues(query, order).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setError(r.code === 'not_ready' ? leagueErrorMessage('public_not_ready') : leagueErrorMessage(r.code));
        setRows([]);
        return;
      }
      setError(null);
      setRows(r.data || []);
    });
    return () => { live = false; };
  }, [query, order, reload]);

  const join = async (l: PublicLeague) => {
    setBusyId(l.league_id);
    const r = await joinPublicLeague(l.league_id);
    setBusyId(null);
    if (!r.ok) { setError(leagueErrorMessage(r.code)); return; }
    if (!r.data.already_member) notifyPush('join', r.data.league_id);
    setReload((n) => n + 1);
    onChanged(r.data.already_member ? `You're already in "${r.data.name}".` : `You joined "${r.data.name}".`, r.data.league_id);
  };

  const leave = async (l: PublicLeague) => {
    if (confirmLeaveId !== l.league_id) { setConfirmLeaveId(l.league_id); return; }
    setBusyId(l.league_id);
    const r = await leaveLeague(l.league_id);
    setBusyId(null);
    setConfirmLeaveId(null);
    if (!r.ok) { setError(leagueErrorMessage(r.code)); return; }
    setReload((n) => n + 1);
    onChanged(r.data === 'deleted' ? `"${l.name}" was deleted.` : `You left "${l.name}".`);
  };

  return (
    <section className="bh-public" aria-label="Public leagues">
      <div className="bh-sec"><h2>Public leagues</h2><small>{rows ? rows.length : ''}</small></div>
      <div className="bh-card bh-forms">
        <div className="bh-inline">
          <input
            className="bh-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search public leagues"
            aria-label="Search public leagues"
            autoComplete="off"
          />
        </div>
        <div className="bh-seg" role="tablist" aria-label="Sort public leagues">
          <button type="button" role="tab" aria-selected={order === 'newest'} className={`bh-seg-btn ${order === 'newest' ? 'is-active' : ''}`} onClick={() => setOrder('newest')}>Newest</button>
          <button type="button" role="tab" aria-selected={order === 'biggest'} className={`bh-seg-btn ${order === 'biggest' ? 'is-active' : ''}`} onClick={() => setOrder('biggest')}>Biggest</button>
        </div>
        {error && <p className="bh-error" role="alert">{error}</p>}
        {rows === null ? (
          <p className="bh-muted" aria-busy="true">Loading public leagues…</p>
        ) : rows.length === 0 && !error ? (
          <p className="bh-muted">{query ? 'No public league matches that search.' : 'No public leagues yet. Create one and pick Public.'}</p>
        ) : (
          <ul className="bh-public-list">
            {rows.map((l) => (
              <li key={l.league_id} className="bh-public-row">
                <span className="bh-league-icon" aria-hidden="true">🌍</span>
                <span className="bh-league-title">
                  <b>{l.name}</b>
                  <small>
                    {l.members} {l.members === 1 ? 'member' : 'members'}
                    {l.creator_handle ? ` · by ${l.creator_handle}` : ''}
                  </small>
                </span>
                {l.is_member ? (
                  <button type="button" className="bh-link-danger" onClick={() => leave(l)} disabled={busyId === l.league_id}>
                    {confirmLeaveId === l.league_id ? 'Tap again' : 'Leave'}
                  </button>
                ) : (
                  <button type="button" className="bh-btn" onClick={() => join(l)} disabled={busyId === l.league_id}>
                    {busyId === l.league_id ? 'Joining…' : 'Join'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
