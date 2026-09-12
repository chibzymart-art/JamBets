import React from 'react';
import { Link } from 'react-router-dom';

interface NavigationFooterProps {
  onOpenAuthModal?: (mode: 'signin' | 'register') => void;
  onOpenFaqModal?: () => void;
  onOpenLeaguesModal?: () => void;
  onSelectDateFilter?: (date: string) => void;
  userRole?: string;
}

export const NavigationFooter: React.FC<NavigationFooterProps> = ({
  onOpenAuthModal,
  onOpenFaqModal,
  onOpenLeaguesModal,
  userRole
}) => {
  const currentYear = new Date().getFullYear();

  const handleScrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="jambets-global-footer" role="contentinfo" aria-label="Platform Directory and Compliance Footer">
      {/* 1. DESKTOP VIEW: FULL MULTI-COLUMN DIRECTORY & NOTICE (HIDDEN ON MOBILE) */}
      <div className="footer-desktop-container">
        {/* Pinned Regulatory Notice Banner */}
        <div className="footer-regulatory-alert-box">
          <div className="regulatory-alert-inner">
            <div className="regulatory-badge-icon">🛡️</div>
            <div className="regulatory-alert-text">
              <strong>STRICT REGULATORY & FINANCIAL INDEMNITY NOTICE:</strong> Predictions are probabilistic estimates
              derived from quantitative mathematical modeling for informational and research purposes only. They are not
              guarantees of sports outcomes, and JamBets does not accept wagers or place bets on anyone's behalf. Sports predictive
              modeling entails variance and inherent risk; always make decisions responsibly. JamBets accepts zero liability for
              financial losses. Strictly 18+ only.
            </div>
          </div>
        </div>

        <div className="footer-main-links-container">
          {/* Brand & Identity Column */}
          <div className="footer-brand-col">
            <div className="footer-brand-header">
              <img src="/jambets-logo.svg" alt="JamBets Sniper Engine" className="footer-brand-logo-img" />
            </div>
            <p className="footer-brand-bio">
              Next-generation mathematical sports analytics platform. Rigorous bivariate modeling, verified post-match settlement
              ledgers, and transparent performance tracking.
            </p>
            <div className="footer-status-pill-row">
              <span className="footer-live-badge">
                <span className="status-live-dot" />
                <span>Platform Operational</span>
              </span>
              <span className="footer-wat-clock">WAT (UTC+1)</span>
            </div>
          </div>

          {/* Column 2: Predictions & Horizon */}
          <div className="footer-nav-col">
            <h4 className="footer-col-heading">PREDICTIONS & HORIZON</h4>
            <ul className="footer-nav-list">
              <li>
                <Link to="/dashboard" className="footer-nav-link">
                  📅 Match Predictions Schedule
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="footer-nav-link">
                  ✓ Settled Match Win Ledger
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="footer-nav-link">
                  🎯 Daily Banker Picks Radar
                </Link>
              </li>
              <li>
                <Link to="/goals" className="footer-nav-link">
                  ⚽ Over 2.5 & 1H Goal Hub
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="footer-nav-link">
                  🗓 4-Day Horizon Forward Queue
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  className="footer-link-button"
                  onClick={onOpenLeaguesModal}
                >
                  🏛 Browse 30 World Leagues Directory
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Analytics & Modeling */}
          <div className="footer-nav-col">
            <h4 className="footer-col-heading">ANALYTICS & MODELING</h4>
            <ul className="footer-nav-list">
              <li>
                <Link to="/#accuracy" className="footer-nav-link">
                  📈 Historical Win Rate Ledger
                </Link>
              </li>
              <li>
                <Link to="/dashboard" className="footer-nav-link">
                  ⭐ Consensus Radar (90%+ Confidence)
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  className="footer-link-button"
                  onClick={onOpenFaqModal}
                >
                  📐 Bivariate Poisson Methodology
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="footer-link-button"
                  onClick={onOpenFaqModal}
                >
                  🛡 Quantitative Model Architecture
                </button>
              </li>
            </ul>
          </div>

          {/* Column 4: Plans & Access */}
          <div className="footer-nav-col">
            <h4 className="footer-col-heading">PLANS & ACCESS</h4>
            <ul className="footer-nav-list">
              <li>
                <Link to="/subscription" className="footer-nav-link font-bold text-emerald">
                  ⚡ Standard Plan — ₦5,000 / mo
                </Link>
              </li>
              <li>
                <Link to="/subscription" className="footer-nav-link font-bold text-amber">
                  👑 BigBang VIP — ₦10,000 / mo
                </Link>
              </li>
              <li>
                <Link to="/subscription" className="footer-nav-link">
                  🎁 Free Tier (Historical Archive)
                </Link>
              </li>
              <li>
                <span className="footer-nav-static">
                  🔒 Secure Paystack Payment Gateway
                </span>
              </li>
            </ul>
          </div>

          {/* Column 5: Account & Governance */}
          <div className="footer-nav-col">
            <h4 className="footer-col-heading">ACCOUNT & GOVERNANCE</h4>
            <ul className="footer-nav-list">
              <li>
                <button
                  type="button"
                  className="footer-link-button"
                  onClick={() => onOpenAuthModal?.('signin')}
                >
                  👤 Member Sign-In & Security
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="footer-link-button"
                  onClick={onOpenFaqModal}
                >
                  ❓ Frequently Asked Questions
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="footer-link-button"
                  onClick={onOpenFaqModal}
                >
                  🛡 Legal Disclaimers & Compliance
                </button>
              </li>
              <li>
                <span className="footer-nav-static">
                  🔞 Strict Responsible Gaming (18+)
                </span>
              </li>

              {userRole === 'admin' && (
                <li>
                  <Link to="/admin" className="footer-nav-link text-purple font-bold">
                    🛡 Admin Command Deck
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* 2. MOBILE VIEW: STREAMLINED COMPACT APP FOOTER (ONLY SHOWN ON MOBILE <= 768px) */}
      <div className="footer-mobile-container">
        <div className="footer-mobile-brand-row">
          <div className="footer-mobile-logo">
            <img src="/jambets-logo.svg" alt="JamBets Sniper Engine" className="footer-brand-logo-img" />
          </div>
          <span className="footer-live-badge compact">
            <span className="status-live-dot" />
            <span>Operational</span>
          </span>
        </div>

        <div className="footer-mobile-quick-links">
          <Link to="/dashboard" className="footer-mobile-btn">
            📊 Predictions
          </Link>
          <Link to="/subscription" className="footer-mobile-btn">
            ⚡ Plans (₦5k)
          </Link>
          <button type="button" className="footer-mobile-btn" onClick={onOpenFaqModal}>
            ❓ FAQ
          </button>
          <button type="button" className="footer-mobile-btn" onClick={onOpenLeaguesModal}>
            🏛 Leagues
          </button>
        </div>

        <p className="footer-mobile-disclaimer">
          🔞 18+ Only. Probabilistic simulation estimates for informational & educational research. JamBets does not accept wagers.
        </p>
      </div>

      {/* Bottom Copyright and Telemetry Strip */}
      <div className="footer-bottom-strip">
        <div className="footer-bottom-left">
          <span>© {currentYear} JamBets Quantitative Sports Analytics. All rights reserved.</span>
        </div>
        <div className="footer-bottom-right">
          <button
            type="button"
            className="btn-footer-scroll-top"
            onClick={handleScrollToTop}
            aria-label="Scroll back to top of page"
          >
            ↑ Back to Top
          </button>
        </div>
      </div>
    </footer>
  );
};
