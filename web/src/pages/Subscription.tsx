import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { DesktopSidebarLayout } from '../components/DesktopSidebarLayout';
import { FavoritePredictionItem } from '../components/FavoritesDrawer';
import { useGeoCurrency, BillingCycle } from '../lib/geoCurrency';

interface SubscriptionPageProps {
  currentUser: any;
  userRole?: string;
  onOpenAuth: (mode: 'signin' | 'register') => void;
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  onOpenFavoritesDrawer?: () => void;
}

export const SubscriptionPage: React.FC<SubscriptionPageProps> = ({
  currentUser,
  userRole,
  onOpenAuth,
  favoriteItems = [],
  onToggleFavoriteItem,
  onOpenFavoritesDrawer,
}) => {
  const [selectedBilling, setSelectedBilling] = useState<BillingCycle>('monthly');
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [subscribeSuccess, setSubscribeSuccess] = useState<string | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  const { currency, symbol, pricing, setCurrency, formatPrice } = useGeoCurrency();

  const handleSubscribe = async (tier: 'standard' | 'bigbang') => {
    if (!currentUser) {
      onOpenAuth('register');
      return;
    }

    setProcessingPlan(tier);
    setSubscribeError(null);
    setSubscribeSuccess(null);

    try {
      const activeAmount = selectedBilling === 'quarterly' ? pricing[tier].quarterly : pricing[tier].monthly;
      const formattedAmount = formatPrice(activeAmount);
      const planTitle = tier === 'bigbang' ? 'BigBang VIP' : 'Standard VIP';
      const cycleTitle = selectedBilling === 'quarterly' ? '3-Month Plan (10% Discount)' : 'Monthly Plan';

      const promptText = `Hello Oddsbanta Billing! I would like to activate ${planTitle} [${cycleTitle}] for ${formattedAmount} (${currency}).\n\nAccount Email: ${currentUser.email}\nUser ID: ${currentUser.id}`;
      const waUrl = `https://wa.me/?text=${encodeURIComponent(promptText)}`;

      setSubscribeSuccess(
        `💳 Redirecting to Oddsbanta VIP Billing Concierge to complete payment (${formattedAmount}) and instantly activate your ${planTitle} entitlement...`
      );

      // Open payment concierge in new tab
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      console.error('Subscription error:', err);
      setSubscribeError(err.message || 'Payment initiation error. Please contact billing support.');
    } finally {
      setProcessingPlan(null);
    }
  };

  const isQuarterly = selectedBilling === 'quarterly';

  return (
    <DesktopSidebarLayout
      favoriteItems={favoriteItems}
      onToggleFavoriteItem={onToggleFavoriteItem}
      onOpenFavoritesDrawer={onOpenFavoritesDrawer}
    >
      <div className="subscription-page-root" style={{ maxWidth: '100%', padding: '20px 0 80px 0' }}>
        {/* Page Header */}
        <div className="sub-header-container">
          <div className="sub-pill-tag">TRANSPARENT PRICING • NO HIDDEN COMMISSIONS</div>
          <h1 className="sub-header-title">Invest in Mathematical Edge</h1>
          <p className="sub-header-subtitle">
            Unlock daily calibrated banker signals, 4-day forecast horizons, and verified quantitative models.
            Billed in {currency === 'NGN' ? 'Nigerian Naira (NGN)' : 'US Dollars (USD)'}.
          </p>

          {/* Billing Period Toggle & Geolocation Currency Switcher */}
          <div className="sub-billing-toggle-wrap">
            <div className="sub-billing-toggle">
              <button
                type="button"
                className={`billing-toggle-btn ${!isQuarterly ? 'active' : ''}`}
                onClick={() => setSelectedBilling('monthly')}
              >
                Monthly Billing
              </button>
              <button
                type="button"
                className={`billing-toggle-btn ${isQuarterly ? 'active' : ''}`}
                onClick={() => setSelectedBilling('quarterly')}
              >
                3-Month Plan <span className="billing-save-pill">Save 10%</span>
              </button>
            </div>

            <div className="sub-currency-switcher" title="Select display & billing currency">
              <span className="sub-currency-label">Currency:</span>
              <button
                type="button"
                className={`currency-toggle-btn ${currency === 'NGN' ? 'active' : ''}`}
                onClick={() => setCurrency('NGN')}
              >
                ₦ NGN
              </button>
              <button
                type="button"
                className={`currency-toggle-btn ${currency === 'USD' ? 'active' : ''}`}
                onClick={() => setCurrency('USD')}
              >
                $ USD
              </button>
            </div>
          </div>

          {/* Notification Toasts */}
          {subscribeSuccess && (
            <div className="sub-toast success" role="alert">
              <span>✨ {subscribeSuccess}</span>
            </div>
          )}
          {subscribeError && (
            <div className="sub-toast error" role="alert">
              <span>⚠️ {subscribeError}</span>
            </div>
          )}
        </div>

        {/* Pricing Cards Grid */}
        <div className="pricing-cards-grid">
          {/* Free Plan Card */}
          <div className="pricing-card free-card">
            <div className="pricing-card-header">
              <span className="plan-badge">{userRole === 'free' ? 'CURRENT PLAN' : 'STARTER AUDIT'}</span>
              <h3 className="plan-name">Free Tier</h3>
              <p className="plan-summary">
                Inspect historical accuracy and explore upcoming match dates with predictions locked.
              </p>
            </div>

            <div className="plan-price-block">
              <span className="price-currency">{symbol}</span>
              <span className="price-number">0</span>
              <span className="price-interval">/ forever</span>
            </div>

            <ul className="plan-features-list">
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span>100% Public Historical Settlement Ledger</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span>Complete 4-Day Match Kickoff Schedule</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span>Post-Whistle Result Verification & Hit Rates</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span>Daily Public Teaser & Sample Signals</span>
              </li>
              <li className="feature-item disabled">
                <span className="check-icon">✕</span>
                <span>Full Match Predictions & Models (Locked)</span>
              </li>
              <li className="feature-item disabled">
                <span className="check-icon">✕</span>
                <span>Very High Confidence Banker Picks (Locked)</span>
              </li>
            </ul>

            <div className="plan-action-box">
              {currentUser ? (
                <Link to="/dashboard" className="btn-plan-secondary">
                  Browse Fixtures & Past Wins
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenAuth('register')}
                  className="btn-plan-secondary"
                  style={{ width: '100%', cursor: 'pointer' }}
                >
                  Create Free Account
                </button>
              )}
            </div>
          </div>

          {/* Standard Plan Card */}
          <div className="pricing-card standard-card featured">
            <div className="featured-ribbon">MOST POPULAR</div>
            <div className="pricing-card-header">
              <span className="plan-badge featured-badge">{userRole === 'standard' ? 'CURRENT PLAN' : 'ESSENTIAL ACCESS'}</span>
              <h3 className="plan-name">Standard Plan</h3>
              <p className="plan-summary">
                Full unredacted access to all Football predictions, Goal specialists & High-Confidence models.
              </p>
            </div>

            <div className="plan-price-block">
              <span className="price-currency">{symbol}</span>
              <span className="price-number">
                {isQuarterly
                  ? currency === 'NGN' ? '13,500' : '13.50'
                  : currency === 'NGN' ? '5,000' : '5'}
              </span>
              <span className="price-interval">
                {isQuarterly ? '/ 3 months' : '/ month'}
              </span>
              {isQuarterly && (
                <div className="plan-sub-billed">
                  {formatPrice(pricing.standard.monthlyEquivalent)}/mo — Save 10%
                </div>
              )}
            </div>

            <ul className="plan-features-list">
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Football (Soccer):</strong> All 30+ World Leagues Unlocked</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Goals Specialist:</strong> Over 2.5 & First Half Over 0.5</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>High-Confidence Signals:</strong> Consensus Picks (Score ≥ 8.0)</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>4-Day Horizon:</strong> Forward match queue populated daily</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Automated Settlements:</strong> Verified post-match scores every 15 min</span>
              </li>
              <li className="feature-item disabled">
                <span className="check-icon">✕</span>
                <span>Multi-Sport VIP Models (Tennis & Basketball)</span>
              </li>
            </ul>

            <div className="plan-action-box">
              <button
                type="button"
                className="btn-plan-primary"
                disabled={processingPlan === 'standard' || userRole === 'standard'}
                onClick={() => handleSubscribe('standard')}
              >
                {userRole === 'standard'
                  ? 'Current Active Plan'
                  : processingPlan === 'standard'
                  ? 'Processing...'
                  : `Subscribe Standard — ${isQuarterly ? formatPrice(pricing.standard.quarterly) + ' for 3 mo' : formatPrice(pricing.standard.monthly) + '/mo'}`}
              </button>
            </div>
          </div>

          {/* BigBang VIP Plan Card */}
          <div className="pricing-card vip-card">
            <div className="pricing-card-header">
              <span className="plan-badge vip-badge">{userRole === 'bigbang' ? 'CURRENT PLAN' : 'ELITE TRADER'}</span>
              <h3 className="plan-name">BigBang VIP</h3>
              <p className="plan-summary">
                Maximum statistical edge. Everything in Standard plus full multi-sport coverage and priority alerts.
              </p>
            </div>

            <div className="plan-price-block">
              <span className="price-currency">{symbol}</span>
              <span className="price-number">
                {isQuarterly
                  ? currency === 'NGN' ? '27,000' : '27.00'
                  : currency === 'NGN' ? '10,000' : '10'}
              </span>
              <span className="price-interval">
                {isQuarterly ? '/ 3 months' : '/ month'}
              </span>
              {isQuarterly && (
                <div className="plan-sub-billed">
                  {formatPrice(pricing.bigbang.monthlyEquivalent)}/mo — Save 10%
                </div>
              )}
            </div>

            <ul className="plan-features-list">
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Everything in Standard:</strong> Full Football & Goal Specialists</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Multi-Sport VIP Access:</strong> Tennis (ATP/WTA) & Basketball (NBA)</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Very High Confidence Radar:</strong> Top Mathematical Picks (Score 9.0–10.0)</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Full Probability Distributions:</strong> Poisson & Dixon-Coles parameters</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>VIP Instant Alerts:</strong> Telegram & WhatsApp signal push</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Dedicated Concierge:</strong> Priority model assistance</span>
              </li>
            </ul>

            <div className="plan-action-box">
              <button
                type="button"
                className="btn-plan-vip"
                disabled={processingPlan === 'bigbang'}
                onClick={() => handleSubscribe('bigbang')}
              >
                {processingPlan === 'bigbang'
                  ? 'Processing...'
                  : `Upgrade BigBang VIP — ${isQuarterly ? formatPrice(pricing.bigbang.quarterly) + ' for 3 mo' : formatPrice(pricing.bigbang.monthly) + '/mo'}`}
              </button>
            </div>
          </div>
        </div>

        {/* Security and Trust Badges */}
        <div className="sub-trust-banner">
          <div className="trust-item">
            <span className="trust-icon">🔒</span>
            <div>
              <strong>Secure Payment Processing</strong>
              <p>Direct bank card, bank transfer, and international payment support with PCI-DSS Level 1 compliance.</p>
            </div>
          </div>

          <div className="trust-item">
            <span className="trust-icon">⚡</span>
            <div>
              <strong>Instant Activation</strong>
              <p>Database-level permissions activate immediately upon transaction confirmation.</p>
            </div>
          </div>

          <div className="trust-item">
            <span className="trust-icon">🛡</span>
            <div>
              <strong>Transparent & Accountable</strong>
              <p>Every prediction timestamped before kickoff and settled on a public track record without alteration.</p>
            </div>
          </div>
        </div>
      </div>
    </DesktopSidebarLayout>
  );
};
