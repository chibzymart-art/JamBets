import React, { useState, useEffect } from 'react';
import { getAdConfig, subscribeToAdConfig, AdBannerConfig } from '../lib/adConfig';

export type AdSlotType = 'leaderboard' | 'native-card' | 'mobile-anchor' | 'drawer-banner';

interface AdBannerSlotProps {
  slotType: AdSlotType;
  customClass?: string;
}

export const AdBannerSlot: React.FC<AdBannerSlotProps> = ({ slotType, customClass = '' }) => {
  const [config, setConfig] = useState<AdBannerConfig>(getAdConfig());

  useEffect(() => {
    const unsubscribe = subscribeToAdConfig((newConfig) => {
      setConfig(newConfig);
    });
    return unsubscribe;
  }, []);

  // 4. MOBILE STICKY BOTTOM ANCHOR — Permanently disabled per UX requirement
  if (slotType === 'mobile-anchor') {
    return null;
  }

  const sponsorUrl = config.sponsorUrl || 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner&utm_campaign=student_sports_crossover';

  // 1. COMPACT & BRIGHT TOP LEADERBOARD BANNER (Slim horizontal strip)
  if (slotType === 'leaderboard') {
    if (!config.isLeaderboardEnabled) return null;

    return (
      <div className={`ad-slot-leaderboard-container ${customClass}`}>
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-leaderboard-link"
          title={`Visit ${config.brandTitle} — ${config.brandSubtitle}`}
        >
          <div className="ad-leaderboard-content">
            <div className="ad-brand-col">
              <span className="ad-brand-icon">🎓</span>
              <div className="ad-brand-names">
                <div className="ad-brand-header-inline">
                  <strong className="ad-brand-title">{config.brandTitle}</strong>
                  <span className="ad-inline-sponsor-pill">{config.brandBadge || 'SPONSORED'}</span>
                </div>
                <span className="ad-brand-subtitle">{config.brandSubtitle}</span>
              </div>
            </div>

            <div className="ad-copy-col">
              <span className="ad-tagline">
                {config.brandTagline}
              </span>
            </div>

            <div className="ad-cta-col">
              <span className="ad-cta-btn">{config.brandCtaText || 'Try Free ➔'}</span>
            </div>
          </div>
        </a>
      </div>
    );
  }

  // 2. IN-FEED NATIVE SPONSORED MATCH CARD (Blends with StandaloneGoalCard)
  if (slotType === 'native-card') {
    if (!config.isNativeCardEnabled) return null;

    return (
      <div className={`ad-native-match-card ${customClass}`}>
        <div className="ad-native-header">
          <div className="ad-native-meta">
            <span className="ad-verified-tag">🎓 VERIFIED PARTNER • {config.brandTitle.toUpperCase()}</span>
            <span className="ad-badge-gold">AI EDUCATION EDGE</span>
          </div>
          <span className="ad-sponsor-pill">{config.brandBadge || 'Sponsored'}</span>
        </div>

        <div className="ad-native-body">
          <h4 className="ad-native-heading">
            {config.nativeHeading}
          </h4>
          <p className="ad-native-text">
            {config.nativeBody}
          </p>
        </div>

        <div className="ad-native-footer">
          <div className="ad-native-perks">
            {config.nativePerk1 && <span className="perk-tag">{config.nativePerk1}</span>}
            {config.nativePerk2 && <span className="perk-tag">{config.nativePerk2}</span>}
            {config.nativePerk3 && <span className="perk-tag">{config.nativePerk3}</span>}
          </div>
          <a
            href={sponsorUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="ad-native-cta-btn"
          >
            {config.nativeCtaText || 'Launch Free AI Tool →'}
          </a>
        </div>
      </div>
    );
  }

  // 3. ACCA DRAWER BANNER (Inside Favorites Drawer)
  if (slotType === 'drawer-banner') {
    if (!config.isDrawerBannerEnabled) return null;

    return (
      <div className={`ad-drawer-banner-wrap ${customClass}`}>
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-drawer-link"
        >
          <div className="ad-drawer-left">
            <span className="ad-mini-icon">🎓</span>
            <div>
              <span className="ad-drawer-headline">{config.drawerHeadline || config.brandTitle}</span>
              <span className="ad-drawer-sub">{config.drawerSub || config.brandSubtitle}</span>
            </div>
          </div>
          <span className="ad-drawer-cta">{config.drawerCta || 'Explore →'}</span>
        </a>
      </div>
    );
  }

  return null;
};

