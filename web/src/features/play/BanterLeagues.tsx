import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createLeague,
  fetchLeagueTable,
  fetchMyLeagues,
  joinLeague,
  leaveLeague,
  type BanterLeagueSummary,
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
import './banter.css';

/**
 * Banter Hub private leagues: create one, share the invite link, join with a code or link,
 * and see each league's week / month / all-time table. Paid members only (server-checked).
 */

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

export function BanterLeagues() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [leagues, setLeagues] = useState<BanterLeagueSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
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
    const r = await createLeague(name);
    setBusy(false);
    if (!r.ok) { setFormError(leagueErrorMessage(r.code)); return; }
    setNewName('');
    setNotice(`"${r.data.name}" is ready. Share the invite link below.`);
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
    setJoinCode('');
    clearJoinParam();
    setNotice(r.data.already_member ? `You're already in "${r.data.name}".` : `You joined "${r.data.name}".`);
    await load();
    setOpenId(r.data.league_id);
  };

  const onLeft = async (message: string) => {
    setOpenId(null);
    setNotice(message);
    await load();
  };

  if (leagues === null) return <p className="bh-muted" aria-busy="true">Loading your leagues…</p>;

  return (
    <div className="bh-today">
      {loadError && <p className="bh-error" role="alert">{loadError}</p>}
      {notice && <p className="bh-notice" role="status">{notice}</p>}

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
            </form>
            {formError && <p className="bh-error" role="alert">{formError}</p>}
          </div>
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
}: {
  league: BanterLeagueSummary;
  open: boolean;
  onToggle: () => void;
  onLeft: (message: string) => void;
}) {
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

  return (
    <article className="bh-card bh-league">
      <button type="button" className="bh-league-head" onClick={onToggle} aria-expanded={open}>
        <span className="bh-league-icon" aria-hidden="true">👥</span>
        <span className="bh-league-title">
          <b>{league.name}</b>
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

          <div className="bh-inline bh-league-actions">
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
