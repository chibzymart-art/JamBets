import React from 'react';
import { MarketType } from '../lib/marketFeedService';

export interface MarketSwitchboardNavProps {
  activeMarket: MarketType;
  onSelectMarket: (market: MarketType) => void;
  counts?: Record<MarketType, number>;
  loading?: boolean;
  embedded?: boolean;
  hideGeneral?: boolean;
  title?: string;
}

interface MarketTabConfig {
  id: MarketType;
  label: string;
  icon: string;
  badgeTag: string;
  description: string;
  accentColor: string;
  isComingSoon?: boolean;
}

const MARKET_TABS: MarketTabConfig[] = [
  {
    id: 'general',
    label: 'General Market',
    icon: '🌐',
    badgeTag: 'CORE 1X2',
    description: 'Comprehensive fixture schedule with core 1X2 predictions, verified odds & results',
    accentColor: '#10b981',
  },
  {
    id: 'over_2.5_goals',
    label: 'Over 2.5 Goals',
    icon: '🎯',
    badgeTag: 'POISSON xG',
    description: 'Calibrated Bivariate Poisson goal expectancy & box penalty area density',
    accentColor: '#dc2626',
  },
  {
    id: 'ht_over_0.5_goals',
    label: '1H Blitz',
    icon: '⏱️',
    badgeTag: '1H HAZARD',
    description: 'First-Half Survival Hazard measuring early lead conversion & press intensity',
    accentColor: '#e11d48',
  },
  {
    id: 'corners',
    label: 'Corners Specialist',
    icon: '🚩',
    badgeTag: 'NB GLM',
    description: 'Negative Binomial Set-Piece GLM analyzing wing width & cross deflection volume',
    accentColor: '#d97706',
  },
  {
    id: 'home_win',
    label: 'Home Win',
    icon: '🏠',
    badgeTag: 'SOON',
    description: 'Home Advantage & Pitch Familiarity GLM',
    accentColor: '#6366f1',
    isComingSoon: true,
  },
  {
    id: 'away_win',
    label: 'Away Win',
    icon: '✈️',
    badgeTag: 'SOON',
    description: 'Counter-Attack & Travel Fatigue Discrepancy Model',
    accentColor: '#8b5cf6',
    isComingSoon: true,
  },
  {
    id: 'draw',
    label: 'Draw Hunter',
    icon: '🤝',
    badgeTag: 'SOON',
    description: 'Low-Variance Poisson Convergence & Stalemate Classifier',
    accentColor: '#64748b',
    isComingSoon: true,
  },
];

export const MarketSwitchboardNav: React.FC<MarketSwitchboardNavProps> = ({
  activeMarket,
  onSelectMarket,
  counts,
  loading = false,
  embedded = false,
  hideGeneral = false,
  title = 'MARKETS',
}) => {
  const visibleTabs = hideGeneral
    ? MARKET_TABS.filter((t) => t.id !== 'general')
    : MARKET_TABS;

  return (
    <div className={`market-switchboard-container ${embedded ? 'embedded' : ''}`}>
      {/* Top Section Header */}
      <div className="switchboard-header">
        <div className="switchboard-title-group">
          <div className="switchboard-pill-title">
            <span className="switchboard-pulse-dot" />
            <span className="switchboard-main-title">{title}</span>
          </div>
        </div>
      </div>

      {/* Tactile Pill Navigation Bar */}
      <div className="market-switchboard-pills-bar" role="tablist" aria-label="Football Markets Switchboard">
        {visibleTabs.map((tab) => {
          const isActive = activeMarket === tab.id;
          const count = counts ? counts[tab.id] : undefined;

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              type="button"
              className={`market-switchboard-pill ${isActive ? 'active' : ''}`}
              onClick={() => onSelectMarket(tab.id)}
              style={{
                '--tab-accent': tab.accentColor,
              } as React.CSSProperties}
            >
              <span className="pill-icon">{tab.icon}</span>
              <span className="pill-label">{tab.label}</span>

              {/* Dynamic Count Badge or Coming Soon */}
              {tab.isComingSoon ? (
                <span className="pill-count-badge pill-soon-badge" style={{ background: '#f1f5f9', color: '#64748b' }}>
                  Soon
                </span>
              ) : (
                <span className={`pill-count-badge ${isActive ? 'active-count' : ''}`}>
                  {count !== undefined ? count : (loading ? '...' : 0)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
