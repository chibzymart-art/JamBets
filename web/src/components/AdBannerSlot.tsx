import React, { useState } from 'react';

export type AdSlotType = 'leaderboard' | 'native-card' | 'mobile-anchor' | 'drawer-banner';

interface AdBannerSlotProps {
  slotType: AdSlotType;
  customClass?: string;
}

export const AdBannerSlot: React.FC<AdBannerSlotProps> = ({ slotType, customClass = '' }) => {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  // Master Test Partner: mybrainpadi.com
  const sponsorUrl = 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner&utm_campaign=student_sports_crossover';

  // 1. COMPACT & BRIGHT TOP LEADERBOARD BANNER (Slim horizontal strip)
  if (slotType === 'leaderboard') {
    return (
      <div className={`ad-slot-leaderboard-container ${customClass}`}>
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-leaderboard-link"
          title="Visit MyBrainPadi.com — AI Study & Thesis Assistant"
        >
          <div className="ad-leaderboard-content">
            <div className="ad-brand-col">
              <span className="ad-brand-icon">🎓</span>
              <div className="ad-brand-names">
                <div className="ad-brand-header-inline">
                  <strong className="ad-brand-title">MyBrainPadi.com</strong>
                  <span className="ad-inline-sponsor-pill">SPONSORED</span>
                </div>
                <span className="ad-brand-subtitle">AI Academic & Research Assistant</span>
              </div>
            </div>

            <div className="ad-copy-col">
              <span className="ad-tagline">
                Writing a Project, Thesis, or Exam Prep? Let AI Structure Literature & Verified Citations.
              </span>
            </div>

            <div className="ad-cta-col">
              <span className="ad-cta-btn">Try Free ➔</span>
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
            <span className="ad-verified-tag">🎓 VERIFIED PARTNER • MYBRAINPADI</span>
            <span className="ad-badge-gold">AI EDUCATION EDGE</span>
          </div>
          <span className="ad-sponsor-pill">Sponsored</span>
        </div>

        <div className="ad-native-body">
          <h4 className="ad-native-heading">
            Tired of Manual Referencing? Get Instant Verified Academic Citations.
          </h4>
          <p className="ad-native-text">
            From thesis proposals to assignment structuring, <strong>MyBrainPadi</strong> equips university students with verified, accurate citations and AI research structuring in seconds.
          </p>
        </div>

        <div className="ad-native-footer">
          <div className="ad-native-perks">
            <span className="perk-tag">✓ Thesis Outlines</span>
            <span className="perk-tag">✓ Verified Sources</span>
            <span className="perk-tag">✓ Free Access</span>
          </div>
          <a
            href={sponsorUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="ad-native-cta-btn"
          >
            Launch Free AI Tool →
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
            <span className="ad-mini-icon">🎓</span>
            <div>
              <span className="ad-drawer-headline">MyBrainPadi.com</span>
              <span className="ad-drawer-sub">Ace coursework while waiting for kickoff</span>
            </div>
          </div>
          <span className="ad-drawer-cta">Explore →</span>
        </a>
      </div>
    );
  }

  // 4. MOBILE STICKY BOTTOM ANCHOR (320x50 Mobile Floating)
  if (slotType === 'mobile-anchor') {
    return (
      <div className={`ad-mobile-sticky-anchor ${customClass}`}>
        <a
          href={sponsorUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="ad-mobile-anchor-link"
        >
          <span className="ad-anchor-icon">🎓</span>
          <div className="ad-anchor-text">
            <span className="ad-anchor-title">Ace Your Exams & Thesis with AI</span>
            <span className="ad-anchor-brand">MyBrainPadi.com • Free Assistant</span>
          </div>
          <span className="ad-anchor-cta">Try ➔</span>
        </a>
        <button
          type="button"
          className="ad-anchor-close-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsDismissed(true);
          }}
          aria-label="Close ad"
        >
          ✕
        </button>
      </div>
    );
  }

  return null;
};
