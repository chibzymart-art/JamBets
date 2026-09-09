import React from 'react';

interface HeroSectionProps {
  onStartFree: () => void;
  onSeePlans: () => void;
  onSelectSport: (sportId: string) => void;
  selectedSport: string;
  modelWinRate: number | string;
  settledCount: number | string;
  onScrollToFixtures: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onStartFree,
  onSeePlans,
  onSelectSport,
  selectedSport,
  modelWinRate,
  settledCount,
  onScrollToFixtures
}) => {
  return (
    <section className="hero-section" aria-label="JamBets Predictive Analytics Platform">
      {/* Dynamic Background with Floodlit Soccer Stadium & Action Photo (Picture 3) */}
      <div className="hero-bg-wrapper">
        <img
          src="/hero-bg.jpg"
          alt="JamBets Live Football Prediction Engine"
          className="hero-bg-image"
          onError={(e) => {
            // Fallback to absolute or public path if needed
            (e.target as HTMLImageElement).src = '/Gemini_Generated_Image_9yaair9yaair9yaa.jpg';
          }}
        />
        <div className="hero-gradient-overlay" />
      </div>

      <div className="hero-content-container">
        {/* Left / Main Hero Banner */}
        <div className="hero-main-column">
          <div className="hero-tagline-badge">
            <span className="badge-pulse-dot" />
            <span>250,000 MONTE CARLO DRAWS • DIXON-COLES ENGINE</span>
          </div>

          <h1 className="hero-headline">
            Read the match <br />
            <span className="hero-green-highlight">before it happens.</span>
          </h1>

          <p className="hero-subtext">
            Statistical models, expected goals and probability analysis for every fixture,
            delivered daily, with a public track record you can audit.
          </p>

          <div className="hero-cta-group">
            <button
              type="button"
              id="btn-hero-start-free"
              className="btn-hero-primary"
              onClick={onStartFree}
            >
              Start free
            </button>
            <button
              type="button"
              id="btn-hero-see-plans"
              className="btn-hero-secondary"
              onClick={onSeePlans}
            >
              See plans
            </button>
            <button
              type="button"
              id="btn-hero-browse-fixtures"
              className="btn-hero-ghost"
              onClick={onScrollToFixtures}
            >
              Browse Fixtures ↓
            </button>
          </div>

          {/* 3 Metric Stat Cards (Picture 2) */}
          <div className="hero-metrics-grid">
            <div className="hero-metric-card">
              <span className="metric-label">Model win rate</span>
              <span className="metric-value win-rate">{modelWinRate}%</span>
              <span className="metric-sub">Verified Consensus</span>
            </div>

            <div className="hero-metric-card">
              <span className="metric-label">Settled picks</span>
              <span className="metric-value">{settledCount}+</span>
              <span className="metric-sub">Transparent Ledger</span>
            </div>

            <div className="hero-metric-card" onClick={onSeePlans} style={{ cursor: 'pointer' }}>
              <span className="metric-label">Paid plans from</span>
              <span className="metric-value plan-price">₦5,000 <small>/ mo</small></span>
              <span className="metric-sub">Flat Rate • All Leagues</span>
            </div>
          </div>

          {/* 5 Sport Pill Badges (Picture 2) */}
          <div className="hero-sports-pills-row">
            <button
              type="button"
              className={`hero-sport-pill ${selectedSport === 'football' ? 'active' : ''}`}
              onClick={() => { onSelectSport('football'); onScrollToFixtures(); }}
            >
              <span>⚽ Football (16 Leagues)</span>
              <span className="pill-live-tag">LIVE</span>
            </button>

            <button
              type="button"
              className={`hero-sport-pill ${selectedSport === 'american_football' ? 'active' : ''}`}
              onClick={() => onSelectSport('american_football')}
            >
              <span>🏈 American Football (NFL & NCAA)</span>
              <span className="pill-live-tag coming">LIVE</span>
            </button>

            <button
              type="button"
              className={`hero-sport-pill ${selectedSport === 'basketball' ? 'active' : ''}`}
              onClick={() => onSelectSport('basketball')}
            >
              <span>🏀 Basketball (NBA & EuroLeague)</span>
              <span className="pill-live-tag coming">LIVE</span>
            </button>

            <button
              type="button"
              className={`hero-sport-pill ${selectedSport === 'tennis' ? 'active' : ''}`}
              onClick={() => onSelectSport('tennis')}
            >
              <span>🎾 Tennis (ATP & WTA Tour)</span>
              <span className="pill-live-tag coming">LIVE</span>
            </button>

            <button
              type="button"
              className={`hero-sport-pill ${selectedSport === 'cricket' ? 'active' : ''}`}
              onClick={() => onSelectSport('cricket')}
            >
              <span>🏏 Cricket (T20, CPL, IPL & Int.)</span>
              <span className="pill-live-tag coming">LIVE</span>
            </button>
          </div>
        </div>

        {/* Right Column: Live Example Model Output Card (Picture 1) */}
        <div className="hero-preview-column">
          <div className="hero-example-card">
            <div className="example-header">
              <div className="example-badge">EXAMPLE MODEL OUTPUT</div>
              <div className="example-sims-tag">250,000 Sims Verified</div>
            </div>

            <div className="example-match-title">
              Arsenal vs Chelsea
            </div>
            <div className="example-poisson-stats">
              Poisson Expected Goals: <strong>2.15 vs 0.95</strong> | Home Boost: <strong>+15%</strong>
            </div>

            <div className="example-prediction-box">
              <div className="example-pick-row">
                <span className="example-tier-badge">👑 TOP PICK</span>
                <span className="example-market">Over 1.5 Goals</span>
                <span className="example-prob">88.4% Prob</span>
              </div>
              <p className="example-rationale">
                Dixon-Coles bivariate distribution projects high scoring probability. 
                221,000 of 250,000 simulated outcomes converged on ≥2 total goals.
              </p>
            </div>

            <div className="example-footer-features">
              <span>✓ Published 6h before kickoff</span>
              <span>✓ Settled automatically</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Step Engine Process Cards (Picture 1) */}
      <div className="hero-steps-section">
        <div className="hero-steps-grid">
          <div className="hero-step-card">
            <span className="step-number-tag">Step 1</span>
            <h3 className="step-card-title">Models crunch the data</h3>
            <p className="step-card-desc">
              Attack and defense strengths, chance quality (xG), home advantage boost (+15%),
              and recent form weighting (last 5–10 games) calculate Poisson and statistical probabilities for every fixture.
            </p>
          </div>

          <div className="hero-step-card">
            <span className="step-number-tag">Step 2</span>
            <h3 className="step-card-title">250,000 Monte Carlo runs</h3>
            <p className="step-card-desc">
              The engine simulates each fixture 250,000 times before kickoff.
              The outcome with the highest statistical occurrence is selected as your verified Key Pick.
            </p>
          </div>

          <div className="hero-step-card">
            <span className="step-number-tag">Step 3</span>
            <h3 className="step-card-title">Track it publicly</h3>
            <p className="step-card-desc">
              Every prediction is published and timestamped before kickoff.
              Every outcome is settled automatically on an immutable public ledger. Zero human tampering.
            </p>
          </div>
        </div>
      </div>

      {/* 4 Trust Pillars (Picture 1) */}
      <div className="hero-trust-pillars-section">
        <div className="trust-pillars-grid">
          <div className="trust-pillar-item">
            <div className="pillar-icon">💳</div>
            <div>
              <h4 className="pillar-title">Secure Paystack checkout</h4>
              <p className="pillar-desc">
                Payments run on Paystack's encrypted hosted page. We never see or store your payment details.
              </p>
            </div>
          </div>

          <div className="trust-pillar-item">
            <div className="pillar-icon">📊</div>
            <div>
              <h4 className="pillar-title">Transparent track record</h4>
              <p className="pillar-desc">
                All settled predictions are published with full mathematical audits and ROI benchmarks.
              </p>
            </div>
          </div>

          <div className="trust-pillar-item">
            <div className="pillar-icon">🌐</div>
            <div>
              <h4 className="pillar-title">5 Sports & 25+ Leagues</h4>
              <p className="pillar-desc">
                Live coverage across European football, NFL, NCAA Football, NBA & EuroLeague Basketball, ATP/WTA Tennis, and T20/IPL Cricket.
              </p>
            </div>
          </div>

          <div className="trust-pillar-item">
            <div className="pillar-icon">🎧</div>
            <div>
              <h4 className="pillar-title">Human support</h4>
              <p className="pillar-desc">
                Real sports analytics professionals answer billing and model questions every day of the week.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
