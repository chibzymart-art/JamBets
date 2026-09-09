import React from 'react';
import { SchedulerJob, SettlementJob } from '../types';

interface NavigationFooterProps {
  onSelectDate: (date: string) => void;
  onOpenPricing: () => void;
  onOpenFaq: () => void;
  onOpenAllLeagues: () => void;
  onOpenProfileOrAuth: () => void;
  onFilterTier: (tier: string) => void;
  onNavigateView: (view: 'fixtures' | 'analytics' | 'admin') => void;
  watDateStr: string;
  latencyMs: number | null;
  todayDate: string;
  yesterdayDate: string;
  tomorrowDate: string;
  schedulerJob?: SchedulerJob | null;
  settlementJob?: SettlementJob | null;
  lastRefreshed?: Date;
}

export const NavigationFooter: React.FC<NavigationFooterProps> = ({
  onSelectDate,
  onOpenPricing,
  onOpenFaq,
  onOpenAllLeagues,
  onOpenProfileOrAuth,
  onFilterTier,
  onNavigateView,
  watDateStr,
  latencyMs,
  todayDate,
  yesterdayDate,
  tomorrowDate,
  schedulerJob,
  settlementJob,
  lastRefreshed
}) => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="site-navigation-footer" aria-label="JamBets Global Navigation & Compliance">
      {/* 1. Universal Regulatory Disclaimer Box (Pinned across all pages) */}
      <div className="regulatory-disclaimer-box">
        <div className="regulatory-disclaimer-content">
          <span className="regulatory-warning-icon">⚠️</span>
          <div className="regulatory-text-group">
            <strong className="regulatory-lead">STRICT REGULATORY & FINANCIAL NOTICE:</strong>
            <span>
              Predictions are probabilistic estimates derived from Dixon-Coles mathematical simulations for informational and educational purposes only. They are not guarantees of sports outcomes, and JamBets does not accept bets or place wagers on anyone's behalf. Predictive sports modeling entails variance and inherent risk; always make decisions responsibly. JamBets accepts zero liability for financial losses. This platform is strictly for research and statistical analysis and NOT financial or betting advice.
            </span>
          </div>
        </div>
      </div>

      {/* 2. Main Multi-Column Links Section */}
      <div className="footer-links-container">
        {/* Brand Column */}
        <div className="footer-brand-column">
          <div className="footer-brand-row">
            <span className="footer-brand-badge">JB</span>
            <span className="footer-brand-name">JamBets</span>
          </div>
          <p className="footer-brand-tagline">
            Next-generation mathematical football simulation engine. 250,000 Monte Carlo iterations per fixture. Real-time 15-minute automated settlement ledger. Zero human tampering.
          </p>
          <div className="footer-brand-metrics">
            <div className="footer-metric-pill">
              <span className="dot-pulse-green" />
              <span>Cloud Supabase Engine Online</span>
            </div>
            <div className="footer-metric-pill">
              <span>{watDateStr ? `WAT Live: ${watDateStr}` : 'Africa/Lagos Timezone'}</span>
            </div>
          </div>
        </div>

        {/* Column 1: Platforms & Predictions */}
        <div className="footer-links-col">
          <h4 className="footer-col-title">Predictions & Horizon</h4>
          <ul className="footer-links-list">
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={() => { onNavigateView('fixtures'); onSelectDate(todayDate); scrollToTop(); }}
              >
                📅 Today's Verified Predictions
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={() => { onNavigateView('fixtures'); onSelectDate(yesterdayDate); scrollToTop(); }}
              >
                ✓ Yesterday's Settled Matches
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={() => { onNavigateView('fixtures'); onSelectDate(tomorrowDate); scrollToTop(); }}
              >
                🔮 Tomorrow's Upcoming Banker Picks
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={() => { onNavigateView('fixtures'); onSelectDate('all'); scrollToTop(); }}
              >
                📊 4-Day Horizon Complete Queue
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenAllLeagues}
              >
                🏛 Browse All 30 Leagues Directory
              </button>
            </li>
          </ul>
        </div>

        {/* Column 2: Analytics & Models */}
        <div className="footer-links-col">
          <h4 className="footer-col-title">Analytics & Modeling</h4>
          <ul className="footer-links-list">
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={() => { onNavigateView('analytics'); scrollToTop(); }}
              >
                📈 Win Rate & Transparency Ledger
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={() => { onNavigateView('fixtures'); onFilterTier('BANGER'); scrollToTop(); }}
              >
                ⭐ 96%+ BANGER Consensus Radar
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={() => { onNavigateView('fixtures'); onFilterTier('TOP PICK'); scrollToTop(); }}
              >
                👑 90%+ Daily Top Picks
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenFaq}
              >
                📐 Dixon-Coles Poisson Methodology
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenFaq}
              >
                🛡 250,000 Monte Carlo Simulation Specs
              </button>
            </li>
          </ul>
        </div>

        {/* Column 3: Pricing & Subscriptions */}
        <div className="footer-links-col">
          <h4 className="footer-col-title">Plans & Access</h4>
          <ul className="footer-links-list">
            <li>
              <button
                type="button"
                className="footer-link-btn highlight"
                onClick={onOpenPricing}
              >
                ⚡ Flat Rate ₦5,000 / Month
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenPricing}
              >
                Standard Subscription
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenPricing}
              >
                BigBang VIP Pro Pass
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenPricing}
              >
                Free Tier Teaser Previews
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenPricing}
              >
                🔒 Secure Paystack Checkout Gateway
              </button>
            </li>
          </ul>
        </div>

        {/* Column 4: Governance & Portal */}
        <div className="footer-links-col">
          <h4 className="footer-col-title">Account & Governance</h4>
          <ul className="footer-links-list">
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenProfileOrAuth}
              >
                👤 Member Account Settings & Security
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenFaq}
              >
                ❓ Frequently Asked Questions (FAQ)
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenProfileOrAuth}
              >
                🛡 Legal Disclaimers & Compliance Record
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn"
                onClick={onOpenFaq}
              >
                🎲 Responsible Gaming Code (18+)
              </button>
            </li>
            <li>
              <button
                type="button"
                className="footer-link-btn admin-link"
                onClick={() => { onNavigateView('admin'); scrollToTop(); }}
              >
                ⚙ Admin & System Health Portal
              </button>
            </li>
          </ul>
        </div>
      </div>

      {/* 3. Bottom Copyright & Technical Telemetry Bar */}
      <div className="footer-bottom-telemetry-bar">
        <div className="telemetry-left">
          <span>© 2026 JamBets Predictive Analytics Platform. Dixon-Coles 250,000 Monte Carlo Simulation Engine.</span>
          {schedulerJob && <span> • 6h Scheduler: {schedulerJob.status}</span>}
          {settlementJob && <span> • 15m Settle: {settlementJob.status}</span>}
        </div>
        <div className="telemetry-right">
          <span>Authoritative Sync: {latencyMs !== null ? `${latencyMs}ms` : 'Online'}</span>
          <span className="telemetry-separator">•</span>
          <span>Updated {lastRefreshed ? lastRefreshed.toLocaleTimeString() : watDateStr}</span>
          <span className="telemetry-separator">•</span>
          <span className="badge-wat-time">WAT (UTC+1)</span>
        </div>
      </div>
    </footer>
  );
};
