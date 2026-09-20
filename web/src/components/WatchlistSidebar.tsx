import React from 'react';
import { formatKickoff } from '../lib/dateUtils';
import { FavoritePredictionItem } from './FavoritesDrawer';
import { AdBannerSlot } from './AdBannerSlot';

export interface WatchlistSidebarProps {
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  onOpenFavoritesDrawer?: () => void;
  customClass?: string;
}

export const WatchlistSidebar: React.FC<WatchlistSidebarProps> = ({
  favoriteItems = [],
  onToggleFavoriteItem,
  onOpenFavoritesDrawer,
  customClass = ''
}) => {
  return (
    <div className={`dashboard-right-sidebar-col ${customClass}`}>
      <aside className="watchlist-sidebar-card">
        {/* Watchlist Header: Permanently at top of card */}
        <div className="watchlist-sidebar-header">
          <span className="watchlist-header-title">
            <span>★</span> FAVORITES / WATCHLIST
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="watchlist-count-badge">
              {favoriteItems.length} Saved
            </span>
            {favoriteItems.length > 0 && onOpenFavoritesDrawer && (
              <button
                type="button"
                onClick={onOpenFavoritesDrawer}
                style={{
                  background: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 7px',
                  cursor: 'pointer'
                }}
                title="Open Custom Slip Drawer"
              >
                Open Slip →
              </button>
            )}
          </div>
        </div>

        {/* Watchlist Content Box (Internally scrollable when multiple fixtures added) */}
        <div className="watchlist-content-box">
          {favoriteItems.length === 0 ? (
            <div className="watchlist-empty-wrap">
              <div className="watchlist-empty-icon">★</div>
              <div className="watchlist-empty-title">Slip Empty</div>
              <p className="watchlist-empty-sub">
                Click the star icon (☆) or "+ Add" on any match card to pin predictions here or build your custom slip.
              </p>
            </div>
          ) : (
            <div className="watchlist-items-scroll-list">
              {favoriteItems.map((fav) => {
                const time = fav.targetKickoffAt ? formatKickoff(fav.targetKickoffAt) : null;
                return (
                  <div
                    key={fav.id}
                    className="banger-item-tile"
                    onClick={() => onOpenFavoritesDrawer && onOpenFavoritesDrawer()}
                  >
                    <div className="banger-item-meta">
                      <span>{fav.league}</span>
                      <span>{time ? `${time.timeStr} WAT` : 'Scheduled'}</span>
                    </div>
                    <div className="banger-item-teams">
                      {fav.homeTeam} vs {fav.awayTeam}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#0284c7' }}>
                        🎯 {fav.prediction} <span style={{ fontSize: 10, color: '#64748b' }}>({fav.market})</span>
                      </span>
                      {onToggleFavoriteItem && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavoriteItem(fav);
                          }}
                          style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pinned Footer Action: Always visible at bottom of sidebar card */}
        {favoriteItems.length > 0 && onOpenFavoritesDrawer && (
          <div className="watchlist-sidebar-footer">
            <button
              type="button"
              onClick={onOpenFavoritesDrawer}
              className="btn-paywall-unlock-prominent"
              style={{ width: '100%', padding: '9px 12px', fontSize: 12, textAlign: 'center', display: 'block' }}
            >
              📋 View Full Slip ({favoriteItems.length}) →
            </button>
          </div>
        )}
      </aside>

      {/* UNDER FAVORITES SIDEBAR AD SLOT (DESKTOP, EXACT SAME WIDTH) */}
      <div className="under-sidebar-ad-wrap">
        <AdBannerSlot slotType="under-favorites" />
      </div>
    </div>
  );
};
