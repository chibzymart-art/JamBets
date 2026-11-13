import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DASHBOARD_PATHS } from '../lib/routeMeta';
import './hub-switch.css';

/** Where the Play Hub lives. Everything under /dashboard is the Predictions Hub. */
export const PLAY_BASE_PATH = '/play';

const LAST_PREDICTIONS_PATH_KEY = 'oddsbanta_last_predictions_path';

export const isPlayPath = (pathname: string) =>
  pathname === PLAY_BASE_PATH || pathname.startsWith(`${PLAY_BASE_PATH}/`);

/**
 * Top-level switch between the two hubs.
 * Predictions Hub = the existing dashboard, untouched. Play Hub = /play.
 * Only reads the URL and navigates; it does not change any dashboard state.
 */
export function HubSwitch() {
  const location = useLocation();
  const navigate = useNavigate();
  const onPlay = isPlayPath(location.pathname);

  // Remember the last Predictions page (with its query) so switching back lands where the user was.
  useEffect(() => {
    if (!onPlay) {
      try {
        window.sessionStorage.setItem(LAST_PREDICTIONS_PATH_KEY, `${location.pathname}${location.search}`);
      } catch {}
    }
  }, [onPlay, location.pathname, location.search]);

  const goPredictions = () => {
    if (!onPlay) return;
    let target: string = DASHBOARD_PATHS.football;
    try {
      const saved = window.sessionStorage.getItem(LAST_PREDICTIONS_PATH_KEY);
      if (saved && saved.startsWith('/dashboard')) target = saved;
    } catch {}
    navigate(target);
  };

  const goPlay = () => {
    if (onPlay) return;
    navigate(PLAY_BASE_PATH);
  };

  return (
    <div className="hub-switch-wrap">
      <div className="hub-switch" role="tablist" aria-label="Choose hub">
        <button
          type="button"
          role="tab"
          id="btn-hub-predictions"
          aria-selected={!onPlay}
          className={`hub-switch-btn ${!onPlay ? 'active' : ''}`}
          onClick={goPredictions}
        >
          <span className="hub-switch-icon" aria-hidden="true">📊</span>
          <span className="hub-switch-dot hub-switch-dot--pred" aria-hidden="true" />
          <span>Predictions<span className="hub-switch-word"> Hub</span></span>
        </button>
        <button
          type="button"
          role="tab"
          id="btn-hub-play"
          aria-selected={onPlay}
          className={`hub-switch-btn ${onPlay ? 'active' : ''}`}
          onClick={goPlay}
        >
          <span className="hub-switch-icon" aria-hidden="true">🎯</span>
          <span className="hub-switch-dot hub-switch-dot--play" aria-hidden="true" />
          <span>Play<span className="hub-switch-word"> Hub</span></span>
          <span className="hub-switch-new">New</span>
        </button>
      </div>
    </div>
  );
}
