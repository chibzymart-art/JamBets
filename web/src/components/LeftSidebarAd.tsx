import React from 'react';
import { AdBannerSlot } from './AdBannerSlot';

export interface LeftSidebarAdProps {
  customClass?: string;
}

export const LeftSidebarAd: React.FC<LeftSidebarAdProps> = ({ customClass = '' }) => {
  return (
    <aside className={`dashboard-left-sidebar-col ${customClass}`}>
      <div className="under-sidebar-ad-wrap">
        <AdBannerSlot slotType="left-sidebar" />
      </div>
    </aside>
  );
};
