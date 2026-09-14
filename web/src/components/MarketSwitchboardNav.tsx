import React from 'react';
import { MarketType } from '../lib/marketFeedService';

export interface MarketSwitchboardNavProps {
  activeMarket: MarketType;
  onSelectMarket: (market: MarketType) => void;
  counts?: Record<MarketType, number>;
  loading?: boolean;
}

interface MarketTabConfig {
  id: MarketType;
  label: string;
  icon: string;
  badgeTag: string;
  description: string;
  accentColor: string;
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
    id: 'home_win',
    label: 'Home Win',
    icon: '🏠',
    badgeTag: 'HVDI MODEL',
    description: 'Home Venue Dominance Index evaluating pitch familiarity & defensive fortress',
    accentColor: '#059669',
  },
  {
    id: 'away_win',
    label: 'Away Win',
    icon: '✈️',
    badgeTag: 'CARE MODEL',
    description: 'Counter-Attacking Road Efficiency tracking transition speed against high lines',
    accentColor: '#0284c7',
  },
  {
    id: 'draw',
    label: 'Draw Hunter',
    icon: '⚖️',
    badgeTag: 'SKELLAM TES',
    description: 'Zero-Inflated Skellam Equilibrium measuring low-scoring tactical symmetry',
    accentColor: '#7c3aed',
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
];

export const MarketSwitchboardNav: React.FC<MarketSwitchboardNavProps> = ({
  activeMarket,
  onSelectMarket,
  counts,
  loading = false,
}) => {
  return (
    <div className="market-switchboard-container">
      {/* Top Section Header - PREDICTED MARKETS */}
      <div className="switchboard-header">
        <div className="switchboard-title-group">
          <div className="switchboard-pill-title">
            <span className="switchboard-pulse-dot" />
            <span className="switchboard-main-title">PREDICTED MARKETS</span>
          </div>
        </div>
      </div>

      {/* Tactile Pill Navigation Bar */}
      <div className="market-switchboard-pills-bar" role="tablist" aria-label="Football Markets Switchboard">
        {MARKET_TABS.map((tab) => {
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

              {/* Dynamic Count Badge */}
              <span className={`pill-count-badge ${isActive ? 'active-count' : ''}`}>
                {count !== undefined ? count : (loading ? '...' : 0)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
