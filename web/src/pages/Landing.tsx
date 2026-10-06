import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PICK_DISCLAIMER } from '../lib/confidenceScore';
import { useGeoCurrency } from '../lib/geoCurrency';

interface LandingPageProps {
  onOpenAuth: (mode: 'signin' | 'register') => void;
  currentUser: any;
  userRole?: string;
  canViewMultiSport?: boolean;
  onOpenFaq?: () => void;
  onOpenPricing?: () => void;
  onOpenBotHub?: () => void;
}

interface TrackRecordSummary {
  overall: {
    totalSettled: number;
    totalWon: number;
    totalLost: number;
    totalVoid: number;
    hitRate: number | null;
  };
  recent?: Array<{
    home: string;
    away: string;
    league: string;
    kickoff: string;
    prediction: string;
    result: string;
    score: number | null;
    finalScore?: string;
  }>;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenAuth,
  currentUser,
  userRole: _userRole,
  canViewMultiSport: _canViewMultiSport = false,
  onOpenFaq,
  onOpenPricing,
  onOpenBotHub
}) => {
  const navigate = useNavigate();
  const { currency, symbol, pricing, formatPrice } = useGeoCurrency();
  const [trackRecord, setTrackRecord] = useState<TrackRecordSummary | null>(null);
  const [loadingSettled, setLoadingSettled] = useState(true);
  const [selectedSport, setSelectedSport] = useState<string>('football');

  useEffect(() => {
    let isMounted = true;
    async function loadLandingData() {
      try {
        setLoadingSettled(true);
        // Single cached CDN edge call — zero direct database load for landing visitors
        const res = await fetch('/api/track-record');
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setTrackRecord(data);
          }
        }
      } catch (err) {
        console.warn('Error fetching landing track record:', err);
      } finally {
        if (isMounted) setLoadingSettled(false);
      }
    }

    loadLandingData();
    return () => {
      isMounted = false;
    };
  }, []);


  const totalSettledCount = trackRecord?.overall?.totalSettled || 480;

  return (
    <div className="landing-light-root">
      {/* 1. HERO SECTION */}
      <section className="hero-light-section" aria-label="Oddsbanta Hero Section">
        <div className="hero-light-backdrop">
          <img
            src="/hero-bg.webp"
            alt="Oddsbanta Football Action"
            className="hero-light-bg-img"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/hero-fallback.webp';
            }}
          />
          <div className="hero-light-gradient-overlay" />
        </div>

        <div className="hero-light-container">
          <div className="hero-light-text-col">
            <h1 className="hero-light-headline">
              Read the match <br />
              <span className="hero-light-green-text">before it happens.</span>
            </h1>

            <p className="hero-light-subtext">
              Statistical models, expected goals, and 0–10 confidence scores for every fixture,
              delivered daily, with an audited public track record of wins and losses.
            </p>

            {/* Direct Bot Delivery Callout Banner */}
            <div
              className="hero-bot-callout"
              onClick={onOpenBotHub}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenBotHub?.();
                }
              }}
              title="Click to view Telegram & WhatsApp Bot Delivery details"
              aria-label="Telegram and WhatsApp Bot Delivery information"
            >
              <span className="hero-bot-callout-icon">🤖</span>
              <div className="hero-bot-callout-content">
                <div className="hero-bot-callout-title">
                  <span>Predictions on Telegram & WhatsApp</span>
                  <span className="hero-bot-callout-badge">BOT ALERTS</span>
                </div>
                <div className="hero-bot-callout-sub">
                  Instant /today, /bangers & Over 2.5 goals pushed to your phone ↗
                </div>
              </div>
              <div className="hero-bot-callout-actions">
                <span className="hero-bot-pill telegram">✈️ Telegram</span>
                <span className="hero-bot-pill whatsapp">💬 WhatsApp</span>
                <span className="hero-bot-pill-mobile">⚡ VIP Bots ↗</span>
              </div>
            </div>

            {/* CTA Buttons Row */}
            <div className="hero-light-cta-row">
              {currentUser ? (
                <Link to="/dashboard" className="btn-hero-green">
                  📊 Dashboard
                </Link>
              ) : (
                <>
                  <Link to="/dashboard" className="btn-hero-green">
                    📊 View Predictions
                  </Link>
                  <button
                    type="button"
                    id="btn-hero-start-free"
                    className="btn-hero-outline"
                    onClick={() => onOpenAuth('register')}
                  >
                    Start Free
                  </button>
                </>
              )}
              {onOpenBotHub && (
                <button
                  type="button"
                  id="btn-hero-bots"
                  className="btn-hero-outline btn-hero-bots-highlight"
                  onClick={onOpenBotHub}
                  title="Click to view Telegram & WhatsApp Bot Delivery details & VIP setup"
                  aria-label="Bot Delivery on Telegram and WhatsApp"
                >
                  🤖 Bots
                </button>
              )}
              <button
                type="button"
                id="btn-hero-see-plans"
                className="btn-hero-outline"
                onClick={onOpenPricing || (() => {})}
              >
                Plans
              </button>
              {onOpenFaq && (
                <button
                  type="button"
                  id="btn-hero-faq"
                  className="btn-hero-outline"
                  onClick={onOpenFaq}
                >
                  FAQ
                </button>
              )}
            </div>

            {/* 3 Metric Stat Cards */}
            <div className="hero-light-metrics-row">
              <div className="hero-light-metric-card">
                <span className="metric-light-label">Model win rate</span>
                <span className="metric-light-val green">85% Average Win rate</span>
              </div>

              <div className="hero-light-metric-card">
                <span className="metric-light-label">Settled match ledger</span>
                <span className="metric-light-val dark">{totalSettledCount}+ picks</span>
              </div>

              <div className="hero-light-metric-card" onClick={onOpenPricing} style={{ cursor: 'pointer' }}>
                <span className="metric-light-label">VIP plans from</span>
                <span className="metric-light-val dark">{formatPrice(pricing.standard.monthly)} / mo</span>
              </div>
            </div>

            {/* 5 Sport Status Pills (All live sports inside /dashboard) */}
            <div className="hero-light-sport-pills-row">
              <button
                type="button"
                className={`hero-light-sport-pill ${selectedSport === 'football' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedSport('football');
                  navigate('/dashboard');
                }}
              >
                <span>⚽ Football (30 Leagues)</span>
                <span className="pill-live-badge">LIVE</span>
              </button>

              <button
                type="button"
                className={`hero-light-sport-pill ${selectedSport === 'goals' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedSport('goals');
                  navigate('/dashboard/goals');
                }}
              >
                <span>🎯 Goals & Specialist Models</span>
                <span className="pill-live-badge">LIVE</span>
              </button>

              <button
                type="button"
                className={`hero-light-sport-pill ${selectedSport === 'tennis' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedSport('tennis');
                  navigate('/dashboard/tennis');
                }}
              >
                <span>🎾 Tennis (ATP & WTA Tour)</span>
                <span className="pill-live-badge">LIVE</span>
              </button>

              <button
                type="button"
                className={`hero-light-sport-pill ${selectedSport === 'basketball' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedSport('basketball');
                  navigate('/dashboard/basketball');
                }}
              >
                <span>🏀 Basketball (NBA & EuroLeague)</span>
                <span className="pill-live-badge">LIVE</span>
              </button>

              <button
                type="button"
                className={`hero-light-sport-pill ${selectedSport === 'american_football' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedSport('american_football');
                  navigate('/dashboard/american-football');
                }}
              >
                <span>🏈 American Football (NFL & NCAA)</span>
                <span className="pill-soon-badge">SOON</span>
              </button>

              <button
                type="button"
                className={`hero-light-sport-pill ${selectedSport === 'cricket' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedSport('cricket');
                  navigate('/dashboard/cricket');
                }}
              >
                <span>🏏 Cricket (T20, IPL & Int.)</span>
                <span className="pill-soon-badge">SOON</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 2. THREE-STEP PROCESS CARDS */}
      <section className="steps-light-section">
        <div className="steps-light-grid">
          <div className="step-light-card">
            <span className="step-light-badge">Step 1</span>
            <h3 className="step-light-title">Models crunch the data</h3>
            <p className="step-light-desc">
              Attack and defense strengths, chance quality (xG), home advantage,
              and recent form weighting calculate Poisson distributions and statistical probabilities for every fixture.
            </p>
          </div>

          <div className="step-light-card">
            <span className="step-light-badge">Step 2</span>
            <h3 className="step-light-title">0–10 Confidence Cadence</h3>
            <p className="step-light-desc">
              Every prediction is assigned a 0–10 confidence score across 4 transparent tiers: Tier 1 (9.0+),
              Tier 2 (8.0–8.9), Tier 3 (6.0–7.9), and Below 6.0 (Low Confidence / Pass).
            </p>
          </div>

          <div className="step-light-card">
            <span className="step-light-badge">Step 3</span>
            <h3 className="step-light-title">Audit the Public Track Record</h3>
            <p className="step-light-desc">
              Every prediction is published and timestamped before kickoff.
              Every outcome (both wins and losses) is settled automatically on a transparent public ledger.
            </p>
          </div>
        </div>
      </section>

      {/* 3. FOUR TRUST PILLARS */}
      <section className="trust-light-section">
        <div className="trust-light-grid">
          <div className="trust-light-item">
            <div className="trust-light-icon-wrap">💳</div>
            <div>
              <h4 className="trust-light-title">Secure Paystack checkout</h4>
              <p className="trust-light-desc">
                Payments run on Paystack's encrypted hosted page. We never see or store your payment details.
              </p>
            </div>
          </div>

          <div className="trust-light-item">
            <div className="trust-light-icon-wrap">📊</div>
            <div>
              <h4 className="trust-light-title">Audited Track Record</h4>
              <p className="trust-light-desc">
                All settled predictions are published with full mathematical audits, sample sizes, and tier hit rates.
              </p>
            </div>
          </div>

          <div className="trust-light-item">
            <div className="trust-light-icon-wrap">🌐</div>
            <div>
              <h4 className="trust-light-title">Multi-Sport Models</h4>
              <p className="trust-light-desc">
                Live quantitative coverage across European football, ATP & WTA tennis, and basketball, with more sports in calibration.
              </p>
            </div>
          </div>

          <div className="trust-light-item" onClick={onOpenBotHub} style={{ cursor: 'pointer' }}>
            <div className="trust-light-icon-wrap" style={{ background: '#e0f2fe', color: '#0284c7' }}>🤖</div>
            <div>
              <h4 className="trust-light-title">WhatsApp & Telegram VIP Bots</h4>
              <p className="trust-light-desc">
                Receive instant daily top picks, live kickoff alerts, and automated /today queries directly on WhatsApp and Telegram.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. EXAMPLE MODEL OUTPUT CARD */}
      <section className="example-light-section">
        <div className="example-light-container">
          <div className="example-light-card">
            <div className="example-light-header">
              <span className="example-light-subhead">EXAMPLE MODEL OUTPUT</span>
              <span className="example-light-sims-badge">Score: 8.8 / 10 • Tier 2</span>
            </div>

            <div className="example-light-match">Arsenal vs Chelsea</div>
            <div className="example-light-poisson">
              Poisson Expected Goals: <strong>2.15 vs 0.95</strong> | Home Boost: <strong>+15%</strong>
            </div>

            <div className="example-light-pick-box">
              <div className="example-light-pick-row">
                <span className="example-light-badge-crown">👑 TOP PICK</span>
                <span className="example-light-market">Over 1.5 Goals</span>
                <span className="example-light-prob">88.4% Prob • 8.8/10</span>
              </div>
              <p className="example-light-rationale">
                Dixon-Coles bivariate distribution projects high scoring probability. Model estimates an 88.4% likelihood of 2 or more total match goals.
              </p>
            </div>

            <div className="example-light-footer">
              <span>✓ Published before kickoff</span>
              <span>✓ Settled automatically</span>
            </div>
          </div>
        </div>
      </section>

      {/* 5. SETTLED MATCH ACCURACY LEDGER (WINS AND LOSSES) */}
      <section className="ledger-light-section" id="accuracy">
        <div className="section-light-header-centered">
          <span className="subhead-light-pill">TRANSPARENT PERFORMANCE</span>
          <h2 className="section-light-title">Settled Match Accuracy Ledger</h2>
          <p className="section-light-desc">
            Complete mathematical transparency. Both wins and losses are published prior to kickoff and automatically verified post-whistle.
          </p>
        </div>

        <div className="ledger-light-container">
          {loadingSettled ? (
            <div className="ledger-light-loading">
              <div className="loading-spinner" />
              <p>Loading authoritative settled performance records...</p>
            </div>
          ) : trackRecord?.recent && trackRecord.recent.length > 0 ? (
            <div className="ledger-light-grid">
              {trackRecord.recent.slice(0, 8).map((pick, i) => {
                const isWon = pick.result === 'won';
                const scoreDisplay = pick.finalScore || 'FT';

                return (
                  <div key={i} className={`ledger-light-card ${isWon ? 'card-won' : 'card-lost'}`}>
                    <div className="ledger-card-top">
                      <span className="ledger-league-badge">{pick.league}</span>
                      <span className={`ledger-status-tag ${isWon ? 'tag-won' : 'tag-lost'}`}>
                        {isWon ? '✓ WON' : '✗ MISSED'}
                      </span>
                    </div>

                    <div className="ledger-card-match">
                      <span className="team-text">{pick.home}</span>
                      <span className="score-pill">{scoreDisplay}</span>
                      <span className="team-text text-right">{pick.away}</span>
                    </div>

                    <div className="ledger-card-meta">
                      <div className="meta-item">
                        <span className="meta-label">Signal:</span>
                        <strong className="meta-val">{pick.prediction?.toUpperCase() || 'TARGET'}</strong>
                      </div>
                      <div className="meta-item text-right">
                        <span className="meta-label">Confidence:</span>
                        <strong className={`meta-val ${isWon ? 'green' : 'muted'}`}>
                          {pick.score !== null ? `${pick.score.toFixed(1)}/10` : '—'}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ledger-light-empty">
              <p>Settlement records are compiling post-match whistles. Check back as active games conclude.</p>
            </div>
          )}

          <div className="ledger-light-footer" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/track-record" className="btn-light-view-all">
              Inspect Full Public Track Record & Hit Rates →
            </Link>
            <Link to="/dashboard" className="btn-light-view-all" style={{ background: '#0284c7' }}>
              Open Prediction Dashboard →
            </Link>
          </div>
        </div>
      </section>

      {/* 6. TRANSPARENT PRICING CALLOUT BANNER */}
      <section className="pricing-light-banner-section" id="pricing">
        <div className="pricing-light-card">
          <div className="pricing-light-left">
            <span className="pricing-light-pill">ACCESSIBLE VALUE</span>
            <h2 className="pricing-light-title">Start Trading with Mathematical Clarity</h2>
            <p className="pricing-light-desc">
              Instant activation starting from only {formatPrice(pricing.standard.monthly)} per month. Transparent mathematical models, cancel anytime.
            </p>
          </div>

          <div className="pricing-light-right">
            <div className="pricing-light-price-box">
              <span className="pricing-curr">{symbol}</span>
              <span className="pricing-amt">{currency === 'NGN' ? '5,000' : '5'}</span>
              <span className="pricing-mo">/ month</span>
            </div>
            <Link to="/subscription" className="btn-pricing-action">
              Activate Subscription &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* 7. REGULATORY DISCLAIMER FOOTER */}
      <aside style={{ maxWidth: 1080, margin: '24px auto', padding: '16px 20px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, color: '#64748b', textAlign: 'center' }}>
        {PICK_DISCLAIMER}
      </aside>
    </div>
  );
};
