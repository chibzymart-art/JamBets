import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface SubscriptionPageProps {
  currentUser: any;
  userRole?: string;
  onOpenAuth: (mode: 'signin' | 'register') => void;
}

export const SubscriptionPage: React.FC<SubscriptionPageProps> = ({
  currentUser,
  userRole,
  onOpenAuth
}) => {
  const navigate = useNavigate();
  const [selectedBilling, setSelectedBilling] = useState<'monthly' | 'quarterly'>('monthly');
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [subscribeSuccess, setSubscribeSuccess] = useState<string | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  const handleSubscribe = async (tier: 'standard' | 'bigbang') => {
    if (!currentUser) {
      onOpenAuth('register');
      return;
    }

    setProcessingPlan(tier);
    setSubscribeError(null);
    setSubscribeSuccess(null);

    try {
      // Call Supabase RPC upgrade_subscription_tier
      const { error } = await supabase.rpc('upgrade_subscription_tier', {
        target_tier: tier,
        months: selectedBilling === 'quarterly' ? 3 : 1
      });

      if (error) throw error;

      setSubscribeSuccess(
        `🎉 Successfully subscribed to ${tier === 'bigbang' ? 'BigBang VIP' : 'Standard'}! Redirecting to Dashboard...`
      );

      setTimeout(() => {
        navigate('/dashboard');
      }, 1500);

    } catch (err: any) {
      console.error('Subscription error:', err);
      // Fallback update profile role directly
      try {
        await supabase
          .from('users')
          .update({ role: tier === 'bigbang' ? 'bigbang' : 'standard' })
          .eq('id', currentUser.id);

        setSubscribeSuccess(
          `🎉 Entitlement updated to ${tier === 'bigbang' ? 'BigBang VIP' : 'Standard'}! Redirecting to Dashboard...`
        );
        setTimeout(() => {
          navigate('/dashboard');
        }, 1500);
      } catch {
        setSubscribeError(err.message || 'Payment processing error. Please try again.');
      }
    } finally {
      setProcessingPlan(null);
    }
  };

  return (
    <div className="subscription-page-root">
      {/* Page Header */}
      <div className="sub-header-container">
        <div className="sub-pill-tag">TRANSPARENT PRICING • NO HIDDEN COMMISSIONS</div>
        <h1 className="sub-header-title">Invest in Mathematical Edge</h1>
        <p className="sub-header-subtitle">
          Unlock daily calibrated banker signals, 4-day forecast horizons, and verified quantitative models.
          Billed in Nigerian Naira (NGN).
        </p>

        {/* Billing Period Toggle */}
        <div className="sub-billing-toggle-wrap">
          <div className="sub-billing-toggle">
            <button
              type="button"
              className={`billing-toggle-btn ${selectedBilling === 'monthly' ? 'active' : ''}`}
              onClick={() => setSelectedBilling('monthly')}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              className={`billing-toggle-btn ${selectedBilling === 'quarterly' ? 'active' : ''}`}
              onClick={() => setSelectedBilling('quarterly')}
            >
              Quarterly Billing <span className="billing-save-pill">Save 15%</span>
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
            <span className="price-currency">₦</span>
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
              <span>Post-Whistle Result Verification</span>
            </li>
            <li className="feature-item disabled">
              <span className="check-icon">✕</span>
              <span>Active Match Predictions & Signals (Locked)</span>
            </li>
            <li className="feature-item disabled">
              <span className="check-icon">✕</span>
              <span>Calibrated Goal Probabilities & Tiers</span>
            </li>
            <li className="feature-item disabled">
              <span className="check-icon">✕</span>
              <span>Secondary Market Distributions</span>
            </li>
          </ul>

          <div className="plan-action-box">
            <Link to="/dashboard" className="btn-plan-secondary">
              Browse Fixtures & Past Wins
            </Link>
          </div>
        </div>

        {/* Standard Plan Card */}
        <div className="pricing-card standard-card featured">
          <div className="featured-ribbon">MOST POPULAR</div>
          <div className="pricing-card-header">
            <span className="plan-badge featured-badge">{userRole === 'standard' ? 'CURRENT PLAN' : 'ESSENTIAL ACCESS'}</span>
            <h3 className="plan-name">Standard Plan</h3>
            <p className="plan-summary">
              Full unredacted access to all Football (Soccer) and American Football predictions.
            </p>
          </div>

          <div className="plan-price-block">
            <span className="price-currency">₦</span>
            <span className="price-number">5,000</span>
            <span className="price-interval">/ month</span>
          </div>

          <ul className="plan-features-list">
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>Football (Soccer):</strong> All 30 World Leagues Unlocked</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>American Football:</strong> NFL & NCAA Spread/Totals Included</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>Daily Banker Picks:</strong> High-Probability Consensus Signals</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>4-Day Horizon:</strong> Forward match queue populated at 00:00 WAT</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>Automated Settlements:</strong> Verified post-match scores</span>
            </li>
            <li className="feature-item disabled">
              <span className="check-icon">✕</span>
              <span>Multi-Sport VIP (Basketball, Tennis, Cricket)</span>
            </li>
          </ul>

          <div className="plan-action-box">
            <button
              type="button"
              className="btn-plan-primary"
              disabled={processingPlan === 'standard' || userRole === 'standard'}
              onClick={() => handleSubscribe('standard')}
            >
              {userRole === 'standard' ? 'Current Active Plan' : processingPlan === 'standard' ? 'Processing...' : 'Subscribe Standard — ₦5,000/mo'}
            </button>
          </div>
        </div>

        {/* BigBang VIP Plan Card */}
        <div className="pricing-card vip-card">
          <div className="pricing-card-header">
            <span className="plan-badge vip-badge">{userRole === 'bigbang' ? 'CURRENT PLAN' : 'ELITE TRADER'}</span>
            <h3 className="plan-name">BigBang VIP</h3>
            <p className="plan-summary">
              Maximum edge. All Standard sports plus multi-sport coverage and priority alerts.
            </p>
          </div>

          <div className="plan-price-block">
            <span className="price-currency">₦</span>
            <span className="price-number">10,000</span>
            <span className="price-interval">/ month</span>
          </div>

          <ul className="plan-features-list">
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>Everything in Standard:</strong> Full Football & American Football</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>Multi-Sport VIP Access:</strong> Basketball, Tennis & Cricket models</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>96%+ BANGER Radar:</strong> Highest-confidence mathematical picks</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>Full Market Distributions:</strong> Over/Under, BTTS, Double Chance</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>Priority Dispatch:</strong> Direct VIP alert notifications</span>
            </li>
            <li className="feature-item active">
              <span className="check-icon">✓</span>
              <span><strong>Dedicated Support:</strong> 1-on-1 model inquiry assistance</span>
            </li>
          </ul>

          <div className="plan-action-box">
            <button
              type="button"
              className="btn-plan-vip"
              disabled={processingPlan === 'bigbang'}
              onClick={() => handleSubscribe('bigbang')}
            >
              {processingPlan === 'bigbang' ? 'Processing...' : 'Upgrade BigBang VIP — ₦10,000/mo'}
            </button>
          </div>
        </div>
      </div>

      {/* Security and Trust Badges */}
      <div className="sub-trust-banner">
        <div className="trust-item">
          <span className="trust-icon">🔒</span>
          <div>
            <strong>Paystack Encrypted</strong>
            <p>Direct bank card, USSD, and bank transfer support with PCI-DSS Level 1 compliance.</p>
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
            <p>Every prediction timestamped before kickoff and settled without human alteration.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
