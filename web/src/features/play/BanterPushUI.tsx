import { useEffect, useState } from 'react';
import {
  currentSubscription,
  dismissPrompt,
  fetchPushSettings,
  permission,
  promptDismissed,
  pushSupport,
  savePushSettings,
  setLeagueMute,
  turnOffPush,
  turnOnPush,
  type PushSettings,
  type TurnOnResult,
} from './banterPush';
import './banter.css';

function resultMessage(r: TurnOnResult): string {
  switch (r) {
    case 'on': return 'Notifications are on for this device.';
    case 'denied': return 'Notifications are blocked for this site. Allow them in your browser settings, then try again.';
    case 'ios_needs_home_screen': return IOS_HELP;
    case 'unsupported': return "This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.";
    case 'not_ready': return "Notifications aren't switched on yet. Please check back soon.";
    default: return "Couldn't turn notifications on. Please try again.";
  }
}

const IOS_HELP =
  'On iPhone, add Oddsbanta to your Home Screen first: tap Share, then "Add to Home Screen". Open it from there and turn notifications on.';

/**
 * One-tap "Turn on notifications" card at the top of the Banter Hub. Shown until turned on or
 * dismissed (once per browser). Hidden when notifications are already on or blocked.
 */
export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const support = pushSupport();

  useEffect(() => {
    let live = true;
    if (promptDismissed() || support === 'unsupported') return;
    if (support === 'supported' && permission() === 'denied') return;
    (async () => {
      const sub = support === 'supported' && permission() === 'granted' ? await currentSubscription() : null;
      if (live && !sub) setShow(true);
    })();
    return () => { live = false; };
  }, [support]);

  if (!show) return null;

  const on = async () => {
    setBusy(true);
    const r = await turnOnPush();
    setBusy(false);
    setMsg(resultMessage(r));
    if (r === 'on' || r === 'denied') {
      dismissPrompt();
      setTimeout(() => setShow(false), 2500);
    }
  };
  const later = () => { dismissPrompt(); setShow(false); };

  return (
    <div className="bh-card bh-push-card" role="region" aria-label="Notifications">
      <span className="bh-push-icon" aria-hidden="true">🔔</span>
      <div className="bh-push-main">
        <b>Get notified instantly</b>
        <small>
          {support === 'ios_needs_home_screen'
            ? IOS_HELP
            : 'Replies, tags and messages in your leagues, even when Oddsbanta is closed. You can change this any time in Profile.'}
        </small>
        {msg && <small className="bh-push-msg" role="status">{msg}</small>}
        <div className="bh-inline">
          {support === 'supported' && (
            <button type="button" className="bh-btn" onClick={on} disabled={busy}>{busy ? 'Turning on…' : 'Turn on notifications'}</button>
          )}
          <button type="button" className="bh-link" onClick={later}>{support === 'supported' ? 'Not now' : 'Got it'}</button>
        </div>
      </div>
    </div>
  );
}

/** Profile: notifications on this device, plus what to be notified about. */
export function PushSettingsCard() {
  const support = pushSupport();
  const [deviceOn, setDeviceOn] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [sub, s] = await Promise.all([
        support === 'supported' && permission() === 'granted' ? currentSubscription() : Promise.resolve(null),
        fetchPushSettings(),
      ]);
      if (!live) return;
      setDeviceOn(!!sub);
      if (s) setSettings(s); else setNotReady(true);
    })();
    return () => { live = false; };
  }, [support]);

  const toggleDevice = async () => {
    setBusy(true);
    setMsg(null);
    if (deviceOn) {
      await turnOffPush();
      setDeviceOn(false);
      setMsg('Notifications are off for this device.');
    } else {
      const r = await turnOnPush();
      setDeviceOn(r === 'on');
      setMsg(resultMessage(r));
      if (r === 'on') dismissPrompt();
    }
    setBusy(false);
  };

  const flip = async (key: 'replies' | 'league_messages' | 'league_activity' | 'thread_messages' | 'follows') => {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    if (!(await savePushSettings(next))) {
      setSettings(settings);
      setMsg("Couldn't save that. Please try again.");
    }
  };

  return (
    <div className="bh-card bh-push-settings">
      <div className="bh-vis-row">
        <span>
          <b>🔔 Notifications on this device</b>
          <small>
            {support === 'ios_needs_home_screen' ? IOS_HELP
              : support === 'unsupported' ? "This browser can't show notifications."
              : deviceOn ? 'On' : 'Off'}
          </small>
        </span>
        {support === 'supported' && deviceOn !== null && (
          <button type="button" className="bh-btn" onClick={toggleDevice} disabled={busy}>
            {busy ? '…' : deviceOn ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
      {msg && <p className="bh-note" role="status">{msg}</p>}
      {notReady ? (
        <p className="bh-note">Notification settings aren't switched on yet.</p>
      ) : settings && (
        <ul className="bh-push-toggles">
          {([
            ['replies', 'Replies and tags', 'Someone replies to you or tags you'],
            ['league_messages', 'League messages', 'New messages on your league walls'],
            ['league_activity', 'League activity', 'Someone joins one of your leagues'],
            ['thread_messages', 'Topic messages', 'New messages in topics you started or replied to'],
            ['follows', 'People you follow', 'Their picks, topics and posts, and new followers'],
          ] as const).filter(([key]) => settings[key] !== undefined).map(([key, label, hint]) => (
            <li key={key}>
              <label className="bh-switch">
                <input type="checkbox" checked={!!settings[key]} onChange={() => flip(key)} />
                <span>
                  <b>{label}</b>
                  <small>{hint}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="bh-note">You can also mute a single league from inside that league.</p>
    </div>
  );
}

/** Inside a league: mute or unmute its notifications for yourself. */
export function LeagueMuteButton({ leagueId }: { leagueId: string }) {
  const [muted, setMuted] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetchPushSettings().then((s) => { if (live && s) setMuted(s.muted_leagues.includes(leagueId)); });
    return () => { live = false; };
  }, [leagueId]);
  if (muted === null) return null;
  const toggle = async () => {
    const next = !muted;
    setMuted(next);
    if (!(await setLeagueMute(leagueId, next))) setMuted(!next);
  };
  return (
    <button type="button" className="bh-link" onClick={toggle} aria-pressed={muted}>
      {muted ? '🔕 Muted (tap to unmute)' : '🔔 Mute this league'}
    </button>
  );
}
