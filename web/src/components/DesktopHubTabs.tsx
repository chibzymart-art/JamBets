import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DASHBOARD_PATHS } from '../lib/routeMeta';
import { isPlayPath, PLAY_BASE_PATH } from './HubSwitch';
import './desktop-hub-tabs.css';

/** Where the Virtual Life preview page lives. */
export const VIRTUAL_LIFE_PATH = '/virtual-life';

export const isVirtualLifePath = (pathname: string) =>
  pathname === VIRTUAL_LIFE_PATH || pathname.startsWith(`${VIRTUAL_LIFE_PATH}/`);

/** Same key the header HubSwitch writes, so going back to Predictions lands where the user was. */
const LAST_PREDICTIONS_PATH_KEY = 'oddsbanta_last_predictions_path';

type HubId = 'predictions' | 'banter' | 'virtual';

function PredictionsSymbol() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <rect x="3" y="13" width="4" height="8" rx="1.2" fill="currentColor" opacity="0.55" />
      <rect x="10" y="8" width="4" height="13" rx="1.2" fill="currentColor" opacity="0.8" />
      <rect x="17" y="3" width="4" height="18" rx="1.2" fill="currentColor" />
      <path d="M3 10.5 9 6l4 2.5L21 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

function BanterSymbol() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h8A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H8l-3.6 2.8c-.4.3-.9 0-.9-.4V13A2.5 2.5 0 0 1 3 10.5v-5Z" fill="currentColor" />
      <path d="M18 8h.5A2.5 2.5 0 0 1 21 10.5v4.5a2.5 2.5 0 0 1-1.5 2.3v2.3c0 .4-.5.7-.9.4L15.5 17.5H12a2.5 2.5 0 0 1-2.3-1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
      <circle cx="7" cy="8" r="1.1" fill="#fff" />
      <circle cx="9.5" cy="8" r="1.1" fill="#fff" />
      <circle cx="12" cy="8" r="1.1" fill="#fff" />
    </svg>
  );
}

function VirtualLifeSymbol() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="6.5" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="10.5" ry="3.6" transform="rotate(-20 12 12)" stroke="currentColor" strokeWidth="1.7" opacity="0.75" />
      <circle cx="9.6" cy="9.8" r="1.6" fill="#fff" opacity="0.55" />
      <path d="M19.5 2.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Desktop-only hub navigation in the top menu bar: three raised (3D) tabs filling the bar's centre.
 * Hidden on phones by CSS, where the existing mobile navigation stays as it is.
 * Only reads the URL and navigates; it does not touch any hub's state.
 */
export function DesktopHubTabs() {
  const location = useLocation();
  const navigate = useNavigate();

  const current: HubId = isPlayPath(location.pathname)
    ? 'banter'
    : isVirtualLifePath(location.pathname)
      ? 'virtual'
      : 'predictions';

  const go = (hub: HubId) => {
    if (hub === current) return;
    if (hub === 'banter') return navigate(PLAY_BASE_PATH);
    if (hub === 'virtual') return navigate(VIRTUAL_LIFE_PATH);
    let target: string = DASHBOARD_PATHS.football;
    try {
      const saved = window.sessionStorage.getItem(LAST_PREDICTIONS_PATH_KEY);
      if (saved && saved.startsWith('/dashboard')) target = saved;
    } catch {}
    navigate(target);
  };

  const tabs: { id: HubId; label: string; sub: string; Symbol: () => ReactElement; badge?: string }[] = [
    { id: 'predictions', label: 'Prediction Hub', sub: 'Data-driven picks', Symbol: PredictionsSymbol },
    { id: 'banter', label: 'Banter Hub', sub: 'Predict, chat and banter with members', Symbol: BanterSymbol },
    { id: 'virtual', label: 'Virtual Life', sub: 'Your fan world', Symbol: VirtualLifeSymbol, badge: 'New' },
  ];

  return (
    <nav className="dhub-tabs" role="tablist" aria-label="Choose hub">
      {tabs.map(({ id, label, sub, Symbol, badge }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`dhub-tab-${id}`}
          aria-selected={current === id}
          className={`dhub-tab dhub-tab--${id}${current === id ? ' is-active' : ''}`}
          onClick={() => go(id)}
        >
          <span className="dhub-tab-symbol">
            <Symbol />
          </span>
          <span className="dhub-tab-text">
            <span className="dhub-tab-label">{label}</span>
            <span className="dhub-tab-sub">{sub}</span>
          </span>
          {badge && <span className="dhub-tab-badge">{badge}</span>}
        </button>
      ))}
    </nav>
  );
}
