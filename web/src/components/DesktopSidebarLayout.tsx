import React from 'react';
import { WatchlistSidebar } from './WatchlistSidebar';
import { LeftSidebarAd } from './LeftSidebarAd';
import { FavoritePredictionItem } from './FavoritesDrawer';

export interface DesktopSidebarLayoutProps {
  children: React.ReactNode;
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  onOpenFavoritesDrawer?: () => void;
  className?: string;
}

export const DesktopSidebarLayout: React.FC<DesktopSidebarLayoutProps> = ({
  children,
  favoriteItems = [],
  onToggleFavoriteItem,
  onOpenFavoritesDrawer,
  className = ''
}) => {
  return (
    <div className={`desktop-page-grid ${className}`}>
      {/* 1. LEFT SIDEBAR: AD BANNER */}
      <LeftSidebarAd />

      {/* 2. MAIN CONTENT STREAM */}
      <div className="desktop-page-main-column" style={{ minWidth: 0, width: '100%' }}>
        {children}
      </div>

      {/* 3. RIGHT SIDEBAR: FAVORITES & ACCA SLIP */}
      <WatchlistSidebar
        favoriteItems={favoriteItems}
        onToggleFavoriteItem={onToggleFavoriteItem}
        onOpenFavoritesDrawer={onOpenFavoritesDrawer}
      />
    </div>
  );
};
