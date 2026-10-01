import React from 'react';
import { Link } from 'react-router-dom';

interface NavigationFooterProps {
  onOpenAuthModal?: (mode: 'signin' | 'register') => void;
  onOpenFaqModal?: () => void;
  onOpenLeaguesModal?: () => void;
  onSelectDateFilter?: (date: string) => void;
  userRole?: string;
  currentUser?: any;
}

export const NavigationFooter: React.FC<NavigationFooterProps> = ({
  onOpenAuthModal,
  onOpenFaqModal,
  onOpenLeaguesModal,
  userRole,
  currentUser
}) => {
  const currentYear = new Date().getFullYear();
  const targetPath = currentUser ? '/dashboard' : '/predictions';

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
              guarantees of sports outcomes, and Oddsbanta does not accept wagers or place bets on anyone's behalf. Sports predictive
              modeling entails variance and inherent risk; always make decisions responsibly. Oddsbanta accepts zero liability for
              financial losses. Strictly 18+ only.
            </div>
          </div>
        </div>

        <div className="footer-main-links-container">
          {/* Brand & Identity Column */}
          <div className="footer-brand-col">
            <div className="footer-brand-header">
              <img src="/oddsbanta-logo.svg" alt="Oddsbanta Prediction Engine" className="footer-brand-logo-img" />
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
                <Link to={targetPath} className="footer-nav-link">
                  📅 Match Predictions Schedule
                </Link>
              </li>
              <li>
                <Link to={targetPath} className="footer-nav-link">
                  ✓ Settled Match Win Ledger
                </Link>
              </li>
              <li>
                <Link to={targetPath} className="footer-nav-link">
                  🎯 Daily Banker Picks Radar
                </Link>
              </li>
              <li>
                <Link to={targetPath} className="footer-nav-link">
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
                  title="Sign In with Google / Gmail"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: '6px' }}>
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  Instant Google / Gmail Login
                </button>
              </li>
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
            <img src="/oddsbanta-logo.svg" alt="Oddsbanta Prediction Engine" className="footer-brand-logo-img" />
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
          🔞 18+ Only. Probabilistic simulation estimates for informational & educational research. Oddsbanta does not accept wagers.
        </p>
      </div>

      {/* Bottom Copyright and Telemetry Strip */}
      <div className="footer-bottom-strip">
        <div className="footer-bottom-left">
          <span>© {currentYear} Oddsbanta Quantitative Sports Analytics. All rights reserved.</span>
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
