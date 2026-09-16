import React, { useState, useEffect } from 'react';
import {
  getAdBanners,
  subscribeToAdBanners,
  getMultiBannerDisplayMode,
  subscribeToDisplayMode,
  AdBannerItem,
  AdSlotType,
  MultiBannerDisplayMode
} from '../lib/adConfig';

interface AdBannerSlotProps {
  slotType: AdSlotType;
  customClass?: string;
  forceMode?: MultiBannerDisplayMode;
}

export const AdBannerSlot: React.FC<AdBannerSlotProps> = ({ slotType, customClass = '', forceMode }) => {
  const [allBanners, setAllBanners] = useState<AdBannerItem[]>(() => getAdBanners());
  const [activeRotIndex, setActiveRotIndex] = useState<number>(0);
  const [displayMode, setDisplayMode] = useState<MultiBannerDisplayMode>(() => getMultiBannerDisplayMode());

  useEffect(() => {
    const unsubBanners = subscribeToAdBanners((newBanners) => {
      setAllBanners(newBanners);
      setActiveRotIndex(0);
    });
    const unsubMode = subscribeToDisplayMode((newMode) => {
      setDisplayMode(newMode);
    });
    return () => {
      unsubBanners();
      unsubMode();
    };
  }, []);

  // Filter banners assigned to this slot that are active
  const eligibleBanners = allBanners.filter(
    (b) => b.isActive && Array.isArray(b.locations) && b.locations.includes(slotType)
  );

  const activeMode: MultiBannerDisplayMode = forceMode || displayMode;

  // Rotate through eligible banners every 12 seconds when in rotate mode
  useEffect(() => {
    if (activeMode !== 'rotate' || eligibleBanners.length <= 1) return;
    const interval = setInterval(() => {
      setActiveRotIndex((prev) => (prev + 1) % eligibleBanners.length);
    }, 12000);
    return () => clearInterval(interval);
  }, [activeMode, eligibleBanners.length]);

  if (eligibleBanners.length === 0) {
    return null;
  }

  const currentBanner = eligibleBanners[activeRotIndex % eligibleBanners.length] || eligibleBanners[0];
  const bannersToRender = (activeMode === 'stack' && eligibleBanners.length > 1)
    ? eligibleBanners
    : [currentBanner];

  // Helper: Top Leaderboard strip
  const renderLeaderboard = (banner: AdBannerItem, index: number, total: number) => {
    const sponsorUrl = banner.sponsorUrl || 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner';
    const iconEmoji = banner.iconEmoji || '🎓';
    return (
      <div key={banner.id || index} className={`ad-slot-leaderboard-container ${customClass}`}>
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-leaderboard-link"
          title={`Visit ${banner.brandTitle} — ${banner.brandSubtitle}`}
        >
          <div className="ad-leaderboard-content">
            <div className="ad-brand-col">
              <span className="ad-brand-icon">{iconEmoji}</span>
              <div className="ad-brand-names">
                <div className="ad-brand-header-inline">
                  <strong className="ad-brand-title">{banner.brandTitle}</strong>
                  <span className="ad-inline-sponsor-pill">{banner.brandBadge || 'SPONSORED'}</span>
                  {total > 1 && activeMode === 'rotate' && (
                    <span style={{ fontSize: '0.65rem', color: '#93c5fd', opacity: 0.8, marginLeft: '4px' }}>
                      ({(activeRotIndex % total) + 1}/{total})
                    </span>
                  )}
                </div>
                <span className="ad-brand-subtitle">{banner.brandSubtitle}</span>
              </div>
            </div>

            <div className="ad-copy-col">
              <span className="ad-tagline">{banner.brandTagline}</span>
            </div>

            <div className="ad-cta-col">
              <span className="ad-cta-btn">{banner.brandCtaText || 'Try Free ➔'}</span>
            </div>
          </div>
        </a>
      </div>
    );
  };

  // Helper: In-Feed Native Card
  const renderNativeCard = (banner: AdBannerItem, index: number, total: number) => {
    const sponsorUrl = banner.sponsorUrl || 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner';
    const iconEmoji = banner.iconEmoji || '🎓';
    return (
      <div key={banner.id || index} className={`ad-native-match-card ${customClass}`}>
        <div className="ad-native-header">
          <div className="ad-native-meta">
            <span className="ad-verified-tag">
              {iconEmoji} VERIFIED PARTNER • {banner.brandTitle.toUpperCase()}
            </span>
            <span className="ad-badge-gold">AI EDUCATION EDGE</span>
            {total > 1 && activeMode === 'rotate' && (
              <span style={{ fontSize: '0.68rem', color: '#cbd5e1', opacity: 0.85 }}>
                • Ad {(activeRotIndex % total) + 1} of {total}
              </span>
            )}
          </div>
          <span className="ad-sponsor-pill">{banner.brandBadge || 'Sponsored'}</span>
        </div>

        <div className="ad-native-body">
          <h4 className="ad-native-heading">{banner.nativeHeading}</h4>
          <p className="ad-native-text">{banner.nativeBody}</p>
        </div>

        <div className="ad-native-footer">
          <div className="ad-native-perks">
            {banner.nativePerk1 && <span className="perk-tag">{banner.nativePerk1}</span>}
            {banner.nativePerk2 && <span className="perk-tag">{banner.nativePerk2}</span>}
            {banner.nativePerk3 && <span className="perk-tag">{banner.nativePerk3}</span>}
          </div>
          <a
            href={sponsorUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="ad-native-cta-btn"
          >
            {banner.nativeCtaText || 'Launch Free AI Tool →'}
          </a>
        </div>
      </div>
    );
  };

  // Helper: Drawer banner
  const renderDrawerBanner = (banner: AdBannerItem, index: number) => {
    const sponsorUrl = banner.sponsorUrl || 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner';
    const iconEmoji = banner.iconEmoji || '🎓';
    return (
      <div key={banner.id || index} className={`ad-drawer-banner-wrap ${customClass}`}>
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-drawer-link"
        >
          <div className="ad-drawer-left">
            <span className="ad-mini-icon">{iconEmoji}</span>
            <div>
              <span className="ad-drawer-headline">{banner.drawerHeadline || banner.brandTitle}</span>
              <span className="ad-drawer-sub">{banner.drawerSub || banner.brandSubtitle}</span>
            </div>
          </div>
          <span className="ad-drawer-cta">{banner.drawerCta || 'Explore →'}</span>
        </a>
      </div>
    );
  };

  // Helper: Desktop Sidebar Card (Used for on/under Favorites and Bangers sidebars)
  const renderSidebarCard = (banner: AdBannerItem, index: number, total: number, isUnder: boolean) => {
    const sponsorUrl = banner.sponsorUrl || 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner';
    const iconEmoji = banner.iconEmoji || '🎓';
    return (
      <div
        key={banner.id || index}
        className={`ad-sidebar-card ${isUnder ? 'ad-under-sidebar-card' : 'ad-on-sidebar-card'} ${customClass}`}
      >
        <div className="ad-sidebar-card-top">
          <div className="ad-sidebar-card-brand">
            <span className="ad-sidebar-card-emoji">{iconEmoji}</span>
            <div className="ad-sidebar-brand-names">
              <div className="ad-sidebar-header-inline">
                <strong className="ad-sidebar-card-title">{banner.brandTitle}</strong>
                <span className="ad-inline-sponsor-pill">{banner.brandBadge || 'SPONSORED'}</span>
              </div>
              <span className="ad-sidebar-card-sub">{banner.brandSubtitle}</span>
            </div>
          </div>
          {total > 1 && activeMode === 'rotate' && (
            <span className="ad-sidebar-rot-badge">
              {(activeRotIndex % total) + 1}/{total}
            </span>
          )}
        </div>

        <p className="ad-sidebar-card-tagline">{banner.brandTagline}</p>

        {(banner.nativePerk1 || banner.nativePerk2) && (
          <div className="ad-sidebar-card-perks">
            {banner.nativePerk1 && <span className="perk-tag">{banner.nativePerk1}</span>}
            {banner.nativePerk2 && <span className="perk-tag">{banner.nativePerk2}</span>}
          </div>
        )}

        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-sidebar-card-cta"
        >
          {banner.brandCtaText || 'Claim Offer ➔'}
        </a>
      </div>
    );
  };

  // 1. TOP LEADERBOARD
  if (slotType === 'leaderboard') {
    return (
      <div className={bannersToRender.length > 1 ? 'ad-multi-stack-container' : ''}>
        {bannersToRender.map((b, i) => renderLeaderboard(b, i, eligibleBanners.length))}
      </div>
    );
  }

  // 2. IN-FEED NATIVE MATCH CARD
  if (slotType === 'native-card') {
    return (
      <div className={bannersToRender.length > 1 ? 'ad-multi-stack-container' : ''}>
        {bannersToRender.map((b, i) => renderNativeCard(b, i, eligibleBanners.length))}
      </div>
    );
  }

  // 3. ACCA DRAWER BANNER
  if (slotType === 'drawer-banner') {
    return (
      <div className={bannersToRender.length > 1 ? 'ad-multi-stack-container' : ''}>
        {bannersToRender.map((b, i) => renderDrawerBanner(b, i))}
      </div>
    );
  }

  // 4. DESKTOP SIDEBAR SLOTS (Favorites & Bangers, on & under)
  if (
    slotType === 'favorites-sidebar' ||
    slotType === 'under-favorites' ||
    slotType === 'bangers-sidebar' ||
    slotType === 'under-bangers'
  ) {
    const isUnder = slotType === 'under-favorites' || slotType === 'under-bangers';
    return (
      <div className={`ad-sidebar-desktop-only ${bannersToRender.length > 1 ? 'ad-multi-stack-container' : ''}`}>
        {bannersToRender.map((b, i) => renderSidebarCard(b, i, eligibleBanners.length, isUnder))}
      </div>
    );
  }

  return null;
};
