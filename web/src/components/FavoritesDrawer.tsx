import React, { useState } from 'react';
import { AdBannerSlot } from './AdBannerSlot';

export interface FavoritePredictionItem {
  id: string; // unique `${fixtureId}::${market}::${prediction}`
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  targetKickoffAt: string;
  market: string;
  prediction: string;
  probability: number;
  confidenceCategory?: string;
}

interface FavoritesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  favorites: FavoritePredictionItem[];
  onRemoveItem: (item: FavoritePredictionItem) => void;
  onClearAll: () => void;
  onViewMatch?: (fixtureId: string) => void;
}

export const FavoritesDrawer: React.FC<FavoritesDrawerProps> = ({
  isOpen,
  onClose,
  favorites,
  onRemoveItem,
  onClearAll,
  onViewMatch,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopySlip = () => {
    if (favorites.length === 0) return;

    let text = `🔥 *ODDSBANTA FAVORITES SLIP*\n`;
    text += `📅 ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} • ${favorites.length} Selection${favorites.length > 1 ? 's' : ''}\n\n`;

    favorites.forEach((fav, idx) => {
      const timeStr = fav.targetKickoffAt
        ? new Date(fav.targetKickoffAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) + ' WAT'
        : 'Scheduled';
      const probStr = fav.probability ? `${Math.round(fav.probability)}%` : '';

      text += `*${idx + 1}. ${fav.homeTeam || 'Home'} vs ${fav.awayTeam || 'Away'}*\n`;
      text += `🏆 ${fav.league || 'League'} • ⏰ ${timeStr}\n`;
      text += `🎯 Pick: *${fav.prediction}* (${fav.market})${probStr ? ` • ${probStr}` : ''}\n\n`;
    });

    text += `🔒 Verified with 250,000 Monte Carlo Simulations\n`;
    text += `👉 https://oddsbanta.com/dashboard\n`;
    text += `_Oddsbanta — Smart Sport Analysis and Prediction_`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const avgProb = favorites.length > 0
    ? Math.round(favorites.reduce((acc, f) => acc + (f.probability || 0), 0) / favorites.length)
    : 0;

  return (
    <div className="favorites-drawer-overlay" onClick={onClose}>
      <aside className="favorites-drawer-container" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="favorites-drawer-header">
          <div className="favorites-drawer-title-group">
            <div className="favorites-drawer-icon-box">⭐</div>
            <div>
              <h3 className="favorites-drawer-heading">Favorites & Custom Slip</h3>
              <p className="favorites-drawer-subheading">
                {favorites.length} saved prediction{favorites.length === 1 ? '' : 's'}
                {favorites.length > 0 && ` • Avg certainty: ${avgProb}%`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="favorites-drawer-close-btn"
            onClick={onClose}
            aria-label="Close favorites drawer"
          >
            ✕
          </button>
        </div>

        {/* Acca Summary Card */}
        {favorites.length > 0 && (
          <div className="favorites-acca-card">
            <div className="favorites-acca-header">
              <span className="acca-title-badge">🎯 ACCUMULATOR MULTIPLIER</span>
              <span className="acca-picks-count">{favorites.length} Selection{favorites.length > 1 ? 's' : ''}</span>
            </div>
            <div className="favorites-acca-metrics">
              <div className="acca-metric-item">
                <span className="acca-metric-label">Combined Confidence</span>
                <strong className="acca-metric-val acca-prob">
                  {favorites.reduce((acc, f) => acc * ((f.probability || 75) / 100), 1) * 100 < 1
                    ? '< 1%'
                    : `${(favorites.reduce((acc, f) => acc * ((f.probability || 75) / 100), 1) * 100).toFixed(1)}%`}
                </strong>
              </div>
              <div className="acca-metric-divider" />
              <div className="acca-metric-item">
                <span className="acca-metric-label">Selections</span>
                <strong className="acca-metric-val">
                  {favorites.length} {favorites.length === 1 ? 'Pick' : 'Picks'}
                </strong>
              </div>
            </div>

            {/* Acca Action Buttons */}
            <div className="favorites-acca-actions">
              <a
                href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                  `🔥 *ODDSBANTA ACCA SLIP* (${favorites.length} Picks)\n\n` +
                  favorites.map((f, i) => `${i + 1}. *${f.homeTeam} vs ${f.awayTeam}*\n   🎯 Pick: *${f.prediction}* (${f.market}) • ${Math.round(f.probability || 0)}%\n`).join('\n') +
                  `\n🔒 Verified by Oddsbanta AI Engine\n👉 https://oddsbanta.com/dashboard`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="favorites-whatsapp-btn"
              >
                <span>📲</span> Share Acca to WhatsApp
              </a>

              <button
                type="button"
                className={`favorites-copy-slip-btn ${copied ? 'copied' : ''}`}
                onClick={handleCopySlip}
              >
                {copied ? '✓ Copied!' : '📋 Copy Slip'}
              </button>

              <button
                type="button"
                className="favorites-clear-btn"
                onClick={onClearAll}
                title="Remove all saved selections"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* SPONSORED PARTNER BANNER (mybrainpadi.com test) */}
        <AdBannerSlot slotType="drawer-banner" />

        {/* Drawer Body Items */}
        <div className="favorites-drawer-body">
          {favorites.length === 0 ? (
            <div className="favorites-empty-state">
              <div className="favorites-empty-icon">⭐</div>
              <h4>No Predictions Saved Yet</h4>
              <p>
                You can add any <strong>Primary Banker</strong> or <strong>Secondary Lean</strong> (Over 1.5, Both Teams to Score, Double Chance) directly to this custom slip.
              </p>
              <div className="favorites-empty-tip">
                💡 Look for the <strong>★ FAVORITE</strong> or <strong>+ Add</strong> button on any match card in the dashboard.
              </div>
            </div>
          ) : (
            <div className="favorites-items-list">
              {favorites.map((fav, index) => {
                const kickoffFormatted = fav.targetKickoffAt
                  ? new Date(fav.targetKickoffAt).toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Africa/Lagos'
                    }) + ' WAT'
                  : 'Kickoff Scheduled';

                const probRound = Math.round(fav.probability || 0);

                return (
                  <div key={fav.id || `${fav.fixtureId}-${index}`} className="favorites-item-card">
                    <div className="favorites-item-header">
                      <div className="favorites-item-meta">
                        <span className="favorites-league-pill">{fav.league || 'League'}</span>
                        <span className="favorites-time-pill">⏰ {kickoffFormatted}</span>
                      </div>
                      <button
                        type="button"
                        className="favorites-remove-item-btn"
                        onClick={() => onRemoveItem(fav)}
                        title="Remove prediction from slip"
                        aria-label="Remove item"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="favorites-match-row">
                      <span className="favorites-team-name">{fav.homeTeam}</span>
                      <span className="favorites-vs-badge">VS</span>
                      <span className="favorites-team-name">{fav.awayTeam}</span>
                    </div>

                    <div className="favorites-pick-row">
                      <div className="favorites-pick-details">
                        <span className="favorites-market-tag">{fav.market}</span>
                        <span className="favorites-pick-val">{fav.prediction}</span>
                      </div>
                      {probRound > 0 && (
                        <div className="favorites-prob-badge">
                          <span className="favorites-prob-number">{probRound}%</span>
                          <span className="favorites-prob-label">Simulated</span>
                        </div>
                      )}
                    </div>

                    {probRound > 0 && (
                      <div className="favorites-prob-bar-track">
                        <div
                          className="favorites-prob-bar-fill"
                          style={{
                            width: `${Math.min(100, probRound)}%`,
                            backgroundColor: probRound >= 80 ? '#10b981' : probRound >= 70 ? '#38bdf8' : '#f59e0b'
                          }}
                        />
                      </div>
                    )}

                    {onViewMatch && (
                      <button
                        type="button"
                        className="favorites-view-match-link"
                        onClick={() => {
                          onClose();
                          onViewMatch(fav.fixtureId);
                        }}
                      >
                        Inspect Match in Predictions →
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        {favorites.length > 0 && (
          <div className="favorites-drawer-footer">
            <div className="favorites-footer-summary">
              <span>{favorites.length} Match Selection{favorites.length > 1 ? 's' : ''}</span>
              <span className="favorites-footer-brand">Oddsbanta Engine</span>
            </div>
            <p className="favorites-footer-note">
              Probabilistic estimates for educational research. Not financial or wagering advice.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
};
