import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  INSTALLED_KEY,
  clearDeferredInstallPrompt,
  getDeferredInstallPrompt,
  isStandaloneApp,
  onInstallPromptChange,
} from '../lib/pwa';
import './install-app-prompt.css';

/**
 * "Add Oddsbanta to your home screen" card, phones only.
 *
 * - Android (Chrome, Edge, Samsung Internet): one tap opens the browser's real install dialog.
 * - iPhone / iPad: Safari has no install button, so the card shows the two Share-menu steps.
 * - Never shown inside the installed app, on desktop, in in-app browsers (Instagram, Facebook, TikTok…),
 *   on admin/sign-in/checkout pages, or before the cookie notice has been answered.
 * - "Not now" hides it for 30 days on this device; installing hides it for good.
 */

const DISMISS_KEY = 'oddsbanta_install_prompt_dismissed_v1';
const COOKIE_CONSENT_KEY = 'oddsbanta_cookie_consent_v1';
const DISMISS_DAYS = 30;
const SHOW_AFTER_MS = 15000;
const HIDDEN_PATH_PREFIXES = ['/admin', '/auth', '/reset-password', '/forgot-password', '/subscription'];

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

function isIosDevice(): boolean {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && (navigator.maxTouchPoints || 0) > 1);
}
function isInAppBrowser(): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter/i.test(navigator.userAgent || '');
}
function isPhoneScreen(): boolean {
  return !!window.matchMedia?.('(max-width: 768px)').matches;
}
function recentlyDismissed(): boolean {
  const raw = read(DISMISS_KEY);
  if (!raw) return false;
  const at = Date.parse(raw);
  return Number.isFinite(at) && Date.now() - at < DISMISS_DAYS * 86400000;
}

const ShareIcon = () => (
  <svg className="oba-install-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="M8 7l4-4 4 4" />
    <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
  </svg>
);

export function InstallAppPrompt() {
  const location = useLocation();
  const [mode, setMode] = useState<'none' | 'android' | 'ios'>('none');
  const [ready, setReady] = useState(false); // time on site has passed and cookie notice answered
  const [hasPrompt, setHasPrompt] = useState(() => !!getDeferredInstallPrompt());

  useEffect(() => onInstallPromptChange(() => setHasPrompt(!!getDeferredInstallPrompt())), []);

  // Wait a little, and never stack on top of the cookie notice.
  useEffect(() => {
    if (isStandaloneApp() || read(INSTALLED_KEY) || recentlyDismissed() || !isPhoneScreen() || isInAppBrowser()) return;
    let interval: number | undefined;
    const timer = window.setTimeout(() => {
      if (read(COOKIE_CONSENT_KEY)) { setReady(true); return; }
      interval = window.setInterval(() => {
        if (read(COOKIE_CONSENT_KEY)) { setReady(true); window.clearInterval(interval); }
      }, 3000);
    }, SHOW_AFTER_MS);
    return () => { window.clearTimeout(timer); if (interval) window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (hasPrompt) setMode('android');
    else if (isIosDevice()) setMode('ios');
    else setMode('none');
  }, [ready, hasPrompt]);

  const hiddenHere = HIDDEN_PATH_PREFIXES.some((p) => location.pathname.startsWith(p));
  if (mode === 'none' || hiddenHere) return null;

  const dismiss = () => {
    write(DISMISS_KEY, new Date().toISOString());
    setMode('none');
    setReady(false);
  };

  const install = async () => {
    const evt = getDeferredInstallPrompt();
    if (!evt) { setMode('none'); return; }
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === 'accepted') write(INSTALLED_KEY, new Date().toISOString());
      else write(DISMISS_KEY, new Date().toISOString());
    } catch { /* browser refused; nothing else to do */ }
    clearDeferredInstallPrompt(); // the browser's install event can be used only once
    setMode('none');
    setReady(false);
  };

  return (
    <div className="oba-install-card" role="dialog" aria-live="polite" aria-label="Add Oddsbanta to your home screen">
      <div className="oba-install-row">
        <img className="oba-install-icon" src="/icons/maskable-192.png" alt="" width={48} height={48} />
        <div className="oba-install-text">
          <p className="oba-install-title">Add Oddsbanta to your home screen</p>
          <p className="oba-install-sub">Open today's picks in one tap, full screen like an app. It uses almost no storage.</p>
        </div>
        <button type="button" className="oba-install-close" onClick={dismiss} aria-label="Close">×</button>
      </div>

      {mode === 'android' ? (
        <div className="oba-install-actions">
          <button type="button" className="oba-install-btn oba-install-btn--ghost" onClick={dismiss}>Not now</button>
          <button type="button" className="oba-install-btn oba-install-btn--primary" onClick={install}>Install app</button>
        </div>
      ) : (
        <>
          <ol className="oba-install-steps">
            <li><span className="oba-install-step-num">1</span>Tap the Share button <ShareIcon /> in Safari's toolbar</li>
            <li><span className="oba-install-step-num">2</span>Scroll down and tap <strong>&nbsp;Add to Home Screen</strong></li>
          </ol>
          <div className="oba-install-actions">
            <button type="button" className="oba-install-btn oba-install-btn--ghost" onClick={dismiss}>Got it</button>
          </div>
        </>
      )}
    </div>
  );
}
