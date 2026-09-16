import React from 'react';
import { BangersSidebar } from './BangersSidebar';
import { WatchlistSidebar } from './WatchlistSidebar';
import { FavoritePredictionItem } from './FavoritesDrawer';

export interface DesktopSidebarLayoutProps {
  children: React.ReactNode;
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  onOpenFavoritesDrawer?: () => void;
  bangersList?: any[];
  predsByFixture?: Map<string, any[]>;
  onSelectFixture?: (fixture: any) => void;
  className?: string;
}

export const DesktopSidebarLayout: React.FC<DesktopSidebarLayoutProps> = ({
  children,
  favoriteItems = [],
  onToggleFavoriteItem,
  onOpenFavoritesDrawer,
  bangersList,
  predsByFixture,
  onSelectFixture,
  className = ''
}) => {
  return (
    <div className={`desktop-page-grid ${className}`}>
      {/* 1. LEFT SIDEBAR: DAILY 90%+ BANGERS (NO AD BANNERS) */}
      <BangersSidebar
        bangersList={bangersList}
        predsByFixture={predsByFixture}
        onSelectFixture={onSelectFixture}
      />

      {/* 2. CENTER CONTENT COLUMN */}
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
