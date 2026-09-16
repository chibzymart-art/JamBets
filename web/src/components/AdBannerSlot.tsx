import React, { useState, useEffect } from 'react';
import { getAdBanners, subscribeToAdBanners, AdBannerItem } from '../lib/adConfig';

export type AdSlotType = 'leaderboard' | 'native-card' | 'mobile-anchor' | 'drawer-banner';

interface AdBannerSlotProps {
  slotType: AdSlotType;
  customClass?: string;
}

export const AdBannerSlot: React.FC<AdBannerSlotProps> = ({ slotType, customClass = '' }) => {
  const [allBanners, setAllBanners] = useState<AdBannerItem[]>(() => getAdBanners());
  const [activeRotIndex, setActiveRotIndex] = useState<number>(0);

  useEffect(() => {
    const unsubscribe = subscribeToAdBanners((newBanners) => {
      setAllBanners(newBanners);
      setActiveRotIndex(0);
    });
    return unsubscribe;
  }, []);

  // 4. MOBILE STICKY BOTTOM ANCHOR — Permanently disabled per UX requirement
  if (slotType === 'mobile-anchor') {
    return null;
  }

  // Filter banners assigned to this slot that are active
  const eligibleBanners = allBanners.filter(
    (b) => b.isActive && Array.isArray(b.locations) && b.locations.includes(slotType as any)
  );

  // Rotate through eligible banners every 12 seconds if multiple are assigned to this slot
  useEffect(() => {
    if (eligibleBanners.length <= 1) return;
    const interval = setInterval(() => {
      setActiveRotIndex((prev) => (prev + 1) % eligibleBanners.length);
    }, 12000);
    return () => clearInterval(interval);
  }, [eligibleBanners.length]);

  if (eligibleBanners.length === 0) {
    return null;
  }

  const currentBanner = eligibleBanners[activeRotIndex % eligibleBanners.length] || eligibleBanners[0];
  const sponsorUrl = currentBanner.sponsorUrl || 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner';
  const iconEmoji = currentBanner.iconEmoji || '🎓';

  // 1. COMPACT & BRIGHT TOP LEADERBOARD BANNER (Slim horizontal strip)
  if (slotType === 'leaderboard') {
    return (
      <div className={`ad-slot-leaderboard-container ${customClass}`}>
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-leaderboard-link"
          title={`Visit ${currentBanner.brandTitle} — ${currentBanner.brandSubtitle}`}
        >
          <div className="ad-leaderboard-content">
            <div className="ad-brand-col">
              <span className="ad-brand-icon">{iconEmoji}</span>
              <div className="ad-brand-names">
                <div className="ad-brand-header-inline">
                  <strong className="ad-brand-title">{currentBanner.brandTitle}</strong>
                  <span className="ad-inline-sponsor-pill">{currentBanner.brandBadge || 'SPONSORED'}</span>
                  {eligibleBanners.length > 1 && (
                    <span style={{ fontSize: '0.65rem', color: '#93c5fd', opacity: 0.8, marginLeft: '4px' }}>
                      ({(activeRotIndex % eligibleBanners.length) + 1}/{eligibleBanners.length})
                    </span>
                  )}
                </div>
                <span className="ad-brand-subtitle">{currentBanner.brandSubtitle}</span>
              </div>
            </div>

            <div className="ad-copy-col">
              <span className="ad-tagline">
                {currentBanner.brandTagline}
              </span>
            </div>

            <div className="ad-cta-col">
              <span className="ad-cta-btn">{currentBanner.brandCtaText || 'Try Free ➔'}</span>
            </div>
          </div>
        </a>
      </div>
    );
  }

  // 2. IN-FEED NATIVE SPONSORED MATCH CARD (Blends with StandaloneGoalCard)
  if (slotType === 'native-card') {
    return (
      <div className={`ad-native-match-card ${customClass}`}>
        <div className="ad-native-header">
          <div className="ad-native-meta">
            <span className="ad-verified-tag">
              {iconEmoji} VERIFIED PARTNER • {currentBanner.brandTitle.toUpperCase()}
            </span>
            <span className="ad-badge-gold">AI EDUCATION EDGE</span>
            {eligibleBanners.length > 1 && (
              <span style={{ fontSize: '0.68rem', color: '#cbd5e1', opacity: 0.85 }}>
                • Ad {(activeRotIndex % eligibleBanners.length) + 1} of {eligibleBanners.length}
              </span>
            )}
          </div>
          <span className="ad-sponsor-pill">{currentBanner.brandBadge || 'Sponsored'}</span>
        </div>

        <div className="ad-native-body">
          <h4 className="ad-native-heading">
            {currentBanner.nativeHeading}
          </h4>
          <p className="ad-native-text">
            {currentBanner.nativeBody}
          </p>
        </div>

        <div className="ad-native-footer">
          <div className="ad-native-perks">
            {currentBanner.nativePerk1 && <span className="perk-tag">{currentBanner.nativePerk1}</span>}
            {currentBanner.nativePerk2 && <span className="perk-tag">{currentBanner.nativePerk2}</span>}
            {currentBanner.nativePerk3 && <span className="perk-tag">{currentBanner.nativePerk3}</span>}
          </div>
          <a
            href={sponsorUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="ad-native-cta-btn"
          >
            {currentBanner.nativeCtaText || 'Launch Free AI Tool →'}
          </a>
        </div>
      </div>
    );
  }

  // 3. ACCA DRAWER BANNER (Inside Favorites Drawer)
  if (slotType === 'drawer-banner') {
    return (
      <div className={`ad-drawer-banner-wrap ${customClass}`}>
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-drawer-link"
        >
          <div className="ad-drawer-left">
            <span className="ad-mini-icon">{iconEmoji}</span>
            <div>
              <span className="ad-drawer-headline">{currentBanner.drawerHeadline || currentBanner.brandTitle}</span>
              <span className="ad-drawer-sub">{currentBanner.drawerSub || currentBanner.brandSubtitle}</span>
            </div>
          </div>
          <span className="ad-drawer-cta">{currentBanner.drawerCta || 'Explore →'}</span>
        </a>
      </div>
    );
  }

  return null;
};
