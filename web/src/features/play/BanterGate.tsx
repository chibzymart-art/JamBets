import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { fetchBanterState, saveBanterProfile, type BanterState } from './banterApi';
import { AVATAR_CHOICES, HANDLE_MAX, checkHandle, handleMessage } from './banterHandle';

/**
 * Who may enter Banter Hub, decided by the server:
 *  - visitor (not signed in): sign-up prompt
 *  - signed in, trial over and not paid: upgrade prompt
 *  - has access, no username yet: choose a username
 *  - has access and a username: the hub (children)
 * Loading shows a placeholder; any error shows a retry, never the hub (fails closed).
 */

interface BanterGateProps {
  isSignedIn: boolean;
  onCreateAccount: () => void;
  onOpenPricing: () => void;
  children: (me: { handle: string; avatar: string; leagues: string[] | null }) => ReactNode;
}

export function BanterGate({ isSignedIn, onCreateAccount, onOpenPricing, children }: BanterGateProps) {
  const [state, setState] = useState<BanterState | null>(null);

  const load = useCallback(async () => {
    setState(null);
    setState(await fetchBanterState(isSignedIn));
  }, [isSignedIn]);

  useEffect(() => {
    load();
  }, [load]);

  if (!state) {
    return <section className="play-card banter-gate" aria-busy="true"><p className="play-lead">Loading Banter Hub…</p></section>;
  }

  if (state.status === 'visitor') {
    return (
      <section className="play-card banter-gate">
        <div className="play-empty-icon" aria-hidden="true">💬</div>
        <h1 className="play-title">Join Banter Hub</h1>
        <p className="play-lead">
          Predict today's matches against other members and climb the leaderboard. Create a free account to start your free trial.
        </p>
        <div className="play-cta-row">
          <button type="button" className="play-btn-primary" onClick={onCreateAccount}>
            Create a free account
          </button>
          <span className="play-cta-note">Free to play. 18+ only.</span>
        </div>
      </section>
    );
  }

  if (state.status === 'no_access') {
    return (
      <section className="play-card banter-gate">
        <div className="play-empty-icon" aria-hidden="true">🔒</div>
        <h1 className="play-title">Your free trial has ended</h1>
        <p className="play-lead">
          Banter Hub is for members on a free trial or a paid plan. Upgrade to keep predicting and stay on the leaderboard.
        </p>
        <div className="play-cta-row">
          <button type="button" className="play-btn-primary" onClick={onOpenPricing}>
            See plans
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="play-card banter-gate">
        <h1 className="play-title">We couldn't open Banter Hub</h1>
        <p className="play-lead">Please check your connection and try again.</p>
        <div className="play-cta-row">
          <button type="button" className="play-btn-primary" onClick={load}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'needs_profile') {
    return <ChooseUsername onSaved={setState} onUpgrade={onOpenPricing} />;
  }

  return <>{children({ handle: state.handle, avatar: state.avatar, leagues: state.leagues })}</>;
}

function ChooseUsername({ onSaved, onUpgrade }: { onSaved: (s: BanterState) => void; onUpgrade: () => void }) {
  const [handle, setHandle] = useState('');
  const [avatar, setAvatar] = useState(AVATAR_CHOICES[0]);
  const [touched, setTouched] = useState(false);
  const [serverCode, setServerCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const localProblem = checkHandle(handle);
  const message = serverCode ? handleMessage(serverCode) : touched ? handleMessage(localProblem) : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setServerCode(null);
    if (localProblem) return;
    setSaving(true);
    const res = await saveBanterProfile(handle, avatar);
    setSaving(false);
    if (res.ok) onSaved(res.state);
    else setServerCode(res.code);
  };

  return (
    <section className="play-card banter-gate">
      <h1 className="play-title">Choose your username</h1>
      <p className="play-lead">This is the name other members see on picks and the leaderboard. Your email is never shown.</p>
      <form className="banter-form" onSubmit={submit} noValidate>
        <label className="banter-label" htmlFor="banter-handle">Username</label>
        <input
          id="banter-handle"
          className={`banter-input ${message ? 'is-invalid' : ''}`}
          value={handle}
          maxLength={HANDLE_MAX + 5}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="e.g. LagosOracle"
          onChange={(e) => { setHandle(e.target.value); setServerCode(null); }}
          onBlur={() => setTouched(true)}
          aria-invalid={!!message}
          aria-describedby="banter-handle-help"
        />
        <p id="banter-handle-help" className={`banter-help ${message ? 'is-error' : ''}`} role={message ? 'alert' : undefined}>
          {message || `3 to ${HANDLE_MAX} characters: letters, numbers and underscores.`}
        </p>

        <span className="banter-label">Avatar</span>
        <div className="banter-avatars" role="radiogroup" aria-label="Avatar">
          {AVATAR_CHOICES.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={avatar === a}
              className={`banter-avatar ${avatar === a ? 'is-selected' : ''}`}
              onClick={() => setAvatar(a)}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="play-cta-row">
          <button type="submit" className="play-btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save username'}
          </button>
          {serverCode === 'no_access' && (
            <button type="button" className="banter-link" onClick={onUpgrade}>See plans</button>
          )}
        </div>
      </form>
    </section>
  );
}
