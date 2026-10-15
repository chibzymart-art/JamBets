import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DesktopSidebarLayout } from '../components/DesktopSidebarLayout';
import { FavoritePredictionItem } from '../components/FavoritesDrawer';
import { useGeoCurrency } from '../lib/geoCurrency';
import { supabase } from '../lib/supabase';

// Bachs.io Browser SDK Global Interface
declare global {
  interface Window {
    Bachs?: {
      Initialize: (opts: { baseUrl?: string; onEvent?: (event: { type: string; data: any }) => void }) => void;
      Checkout: {
        open: (opts: {
          checkoutUrl?: string;
          token?: string;
          onEvent?: (event: { type: string; data: any }) => void;
        }) => Promise<any>;
        close: () => void;
        isOpen: () => boolean;
      };
    };
  }
}

// Resilient loader for Bachs Overlay SDK
const ensureBachsLoaded = (): Promise<void> => {
  if (typeof window !== 'undefined' && window.Bachs?.Checkout) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve();
    const existing = document.querySelector('script[src*="bachs.js"]');
    if (existing) {
      if (window.Bachs?.Checkout) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => resolve());
      setTimeout(resolve, 1500);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.bachs.io/bachs.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.body.appendChild(script);
    setTimeout(resolve, 1500);
  });
};

interface SubscriptionPageProps {
  currentUser: any;
  userRole?: string;
  subscription?: any;
  onRefreshUser?: () => void;
  onOpenAuth: (mode: 'signin' | 'register') => void;
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  onOpenFavoritesDrawer?: () => void;
}

export const SubscriptionPage: React.FC<SubscriptionPageProps> = ({
  currentUser,
  userRole,
  subscription,
  onRefreshUser,
  onOpenAuth,
  favoriteItems = [],
  onToggleFavoriteItem,
  onOpenFavoritesDrawer,
}) => {
  const [searchParams] = useSearchParams();
  const highlightedTier = searchParams.get('tier')?.toLowerCase();

  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [subscribeSuccess, setSubscribeSuccess] = useState<string | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  const { currency, symbol, setCurrency } = useGeoCurrency();

  // Scroll to focused tier if query parameter provided
  useEffect(() => {
    if (highlightedTier === 'standard' || highlightedTier === 'bigbang' || highlightedTier === 'free') {
      const timer = setTimeout(() => {
        const el = document.getElementById(`plan-${highlightedTier}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [highlightedTier]);

  // Handle Return Status from Bachs Checkout Session
  useEffect(() => {
    const status = searchParams.get('status');
    if (status === 'success') {
      setSubscribeSuccess(
        '🎉 Payment verified! Your subscription is active. All VIP bankers and predictive models are unlocked.'
      );
      if (onRefreshUser) {
        onRefreshUser();
      }
    } else if (status === 'cancelled') {
      setSubscribeError('Checkout was cancelled. No charges were made to your account.');
    }
  }, [searchParams, onRefreshUser]);

  // 1. Authoritative Bachs Checkout Session Handler
  const handleSubscribe = async (tier: 'standard' | 'bigbang') => {
    if (!currentUser) {
      onOpenAuth('register');
      return;
    }

    setProcessingPlan(tier);
    setSubscribeError(null);
    setSubscribeSuccess(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        onOpenAuth('signin');
        setProcessingPlan(null);
        return;
      }

      const planName = tier === 'bigbang' ? 'BigBang VIP' : 'Standard VIP';
      setSubscribeSuccess(`Connecting to secure Bachs payment gateway for ${planName}...`);

      const res = await fetch('/api/checkout/bachs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tier, currency }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize checkout session with Bachs.');
      }

      if (!data.checkout_url) {
        throw new Error('No checkout URL received from payment provider.');
      }

      // First attempt: Open Bachs Overlay Modal SDK (Zero page navigation)
      try {
        await ensureBachsLoaded();
        if (window.Bachs?.Checkout) {
          setSubscribeSuccess('Opening secure Bachs checkout overlay...');
          await window.Bachs.Checkout.open({
            checkoutUrl: data.checkout_url,
            onEvent: (event: any) => {
              if (event.type === 'checkout.completed') {
                setSubscribeSuccess('✨ Payment confirmed! Activating your VIP features...');
                if (onRefreshUser) onRefreshUser();
                setTimeout(() => {
                  window.location.href = '/subscription?status=success';
                }, 1200);
              } else if (event.type === 'checkout.closed') {
                setProcessingPlan(null);
              }
            },
          });
          return;
        }
      } catch (overlayErr) {
        console.warn('Bachs overlay checkout unavailable, redirecting directly:', overlayErr);
      }

      // Second attempt / Fallback: Direct Redirect (PCI compliant, Bachs-hosted)
      setSubscribeSuccess('Redirecting to secure Bachs payment gateway...');
      window.location.href = data.checkout_url;
    } catch (err: any) {
      console.error('[Subscription] Checkout initiation error:', err);
      setSubscribeError(err.message || 'Payment initiation failed. Please try again or contact support.');
      setProcessingPlan(null);
    }
  };

  // 2. Self-Service Bachs Customer Portal Handler
  const handleOpenBillingPortal = async () => {
    if (!currentUser) {
      onOpenAuth('signin');
      return;
    }

    setIsOpeningPortal(true);
    setSubscribeError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        onOpenAuth('signin');
        return;
      }

      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to load customer billing portal.');
      }

      if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        throw new Error('Billing portal URL was not returned.');
      }
    } catch (err: any) {
      console.error('[Subscription] Billing portal error:', err);
      setSubscribeError(err.message || 'Could not open billing portal. Please contact support.');
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const hasActiveSub = currentUser && (userRole === 'standard' || userRole === 'bigbang' || userRole === 'admin');

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
            {currency === 'NGN'
              ? 'Unlock daily calibrated banker signals, 4-day forecast horizons, and verified quantitative models. Pay in Nigerian Naira (NGN) via Instant Bank Transfer or Local Card.'
              : 'Unlock daily calibrated banker signals, 4-day forecast horizons, and verified quantitative models. Billed in US Dollars (USD) via Bachs with global card auto-renewal.'}
          </p>

          {/* Payment & Currency Selector */}
          <div className="sub-currency-bar">
            <span className="sub-currency-title">Select Billing Currency:</span>
            <div className="sub-currency-switcher" role="group" aria-label="Currency selection">
              <button
                type="button"
                className={`currency-toggle-btn ${currency === 'NGN' ? 'active' : ''}`}
                onClick={() => setCurrency('NGN')}
              >
                🇳🇬 ₦ NGN (Bank Transfer & Cards)
              </button>
              <button
                type="button"
                className={`currency-toggle-btn ${currency === 'USD' ? 'active' : ''}`}
                onClick={() => setCurrency('USD')}
              >
                🌐 $ USD (Global Cards)
              </button>
            </div>
          </div>

          {/* Payment Method Badges Banner */}
          <div className="sub-payment-pill-row">
            {currency === 'NGN' ? (
              <>
                <span className="sub-payment-tag">🏦 Instant Bank Transfer (Virtual Accounts)</span>
                <span className="sub-payment-tag">💳 Local Naira Cards (Verve, Mastercard, Visa)</span>
                <span className="sub-payment-tag">🛡️ 30-Day VIP Pass (No Auto-Debit Surprises)</span>
              </>
            ) : (
              <>
                <span className="sub-payment-tag">💳 Global Credit & Debit Cards</span>
                <span className="sub-payment-tag">🔄 Automated Monthly Renewal</span>
                <span className="sub-payment-tag">⚙️ Cancel Anytime via Self-Service Portal</span>
              </>
            )}
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

        {/* Active Subscription Banner (Bachs Self-Service Customer Portal) */}
        {hasActiveSub && (
          <div className="sub-active-management-card">
            <div>
              <div className="sub-active-badge">
                <span>✓</span> ACTIVE {userRole.toUpperCase()} SUBSCRIPTION
              </div>
              <h3 className="sub-active-title">
                You are currently on {userRole === 'bigbang' ? 'BigBang VIP' : userRole === 'standard' ? 'Standard VIP' : 'Admin'}
              </h3>
              <p className="sub-active-desc">
                Your subscription renews automatically{subscription?.current_period_end ? ` (Current period ends ${new Date(subscription.current_period_end).toLocaleDateString()})` : ''}. Update payment cards, view invoices, or cancel renewal anytime with zero card data stored on our servers.
              </p>
            </div>
            <button
              type="button"
              className="btn-manage-portal"
              onClick={handleOpenBillingPortal}
              disabled={isOpeningPortal}
            >
              {isOpeningPortal ? 'Opening Portal...' : '⚙️ Manage Billing & Cards'}
            </button>
          </div>
        )}

        {/* Pricing Cards Grid */}
        <div className="pricing-cards-grid">
          {/* Free Plan Card */}
          <div id="plan-free" className={`pricing-card free-card ${highlightedTier === 'free' ? 'highlighted-focus' : ''}`}>
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
          <div id="plan-standard" className={`pricing-card standard-card featured ${highlightedTier === 'standard' ? 'highlighted-focus' : ''}`}>
            <div className="featured-ribbon">MOST POPULAR</div>
            <div className="pricing-card-header">
              <span className="plan-badge featured-badge">{userRole === 'standard' ? 'CURRENT PLAN' : 'ESSENTIAL ACCESS'}</span>
              <h3 className="plan-name">Standard Plan</h3>
              <p className="plan-summary">
                Full unredacted access to everything Football: All 30+ World Leagues, Goals & Corners specialist models, and verified settlements.
              </p>
            </div>

            <div className="plan-price-block">
              <span className="price-currency">{symbol}</span>
              <span className="price-number">
                {currency === 'NGN' ? '7,500' : '5'}
              </span>
              <span className="price-interval">
                {currency === 'NGN' ? '/ 30-day pass' : '/ month'}
              </span>
              <div className="plan-sub-billed">
                {currency === 'NGN'
                  ? 'Instant Bank Transfer & Local Cards'
                  : 'Renews monthly • Cancel anytime'}
              </div>
            </div>

            <ul className="plan-features-list">
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Everything Football:</strong> All 30+ World Leagues Unlocked</span>
              </li>
              <li className="feature-item active">
                <span className="check-icon">✓</span>
                <span><strong>Specialist Engines:</strong> Over 2.5 Goals, HT 0.5 & Corners</span>
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
                <span>Multi-Sport VIP Models (Tennis & Basketball reserved for BigBang VIP)</span>
              </li>
            </ul>

            <div className="plan-action-box">
              <button
                type="button"
                className="btn-plan-primary"
                disabled={processingPlan === 'standard'}
                onClick={() => {
                  if (userRole === 'standard') {
                    handleOpenBillingPortal();
                  } else {
                    handleSubscribe('standard');
                  }
                }}
              >
                {userRole === 'standard'
                  ? 'Current Plan (Manage)'
                  : processingPlan === 'standard'
                  ? 'Connecting to Bachs...'
                  : currency === 'NGN'
                  ? 'Get Standard 30-Day Pass — ₦7,500'
                  : 'Subscribe Standard — $5/mo'}
              </button>
            </div>
          </div>

          {/* BigBang VIP Plan Card */}
          <div id="plan-bigbang" className={`pricing-card vip-card ${highlightedTier === 'bigbang' ? 'highlighted-focus' : ''}`}>
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
                {currency === 'NGN' ? '15,000' : '10'}
              </span>
              <span className="price-interval">
                {currency === 'NGN' ? '/ 30-day pass' : '/ month'}
              </span>
              <div className="plan-sub-billed">
                {currency === 'NGN'
                  ? 'Instant Bank Transfer & Local Cards'
                  : 'Renews monthly • Cancel anytime'}
              </div>
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
                onClick={() => {
                  if (userRole === 'bigbang') {
                    handleOpenBillingPortal();
                  } else {
                    handleSubscribe('bigbang');
                  }
                }}
              >
                {userRole === 'bigbang'
                  ? 'Current Plan (Manage)'
                  : processingPlan === 'bigbang'
                  ? 'Connecting to Bachs...'
                  : userRole === 'standard'
                  ? currency === 'NGN'
                    ? 'Upgrade BigBang 30-Day Pass — ₦15,000'
                    : 'Upgrade BigBang VIP — $10/mo'
                  : currency === 'NGN'
                  ? 'Unlock BigBang 30-Day Pass — ₦15,000'
                  : 'Unlock BigBang VIP — $10/mo'}
              </button>
            </div>
          </div>
        </div>

        {/* Security and Trust Badges */}
        <div className="sub-trust-banner">
          <div className="trust-item">
            <span className="trust-icon">🔒</span>
            <div>
              <strong>Bachs Zero-Card-Data Security</strong>
              <p>Card numbers and sensitive details are tokenized directly with Bachs.io (PCI-DSS Level 1). No card details ever touch Oddsbanta servers.</p>
            </div>
          </div>

          <div className="trust-item">
            <span className="trust-icon">⚡</span>
            <div>
              <strong>Instant Automated Activation</strong>
              <p>Database-level permissions and VIP signals unlock automatically the moment your invoice is confirmed.</p>
            </div>
          </div>

          <div className="trust-item">
            <span className="trust-icon">🛡</span>
            <div>
              <strong>Transparent & Flexible</strong>
              <p>
                {currency === 'NGN'
                  ? '30-Day non-recurring passes with zero surprise auto-debits. Renew whenever you choose.'
                  : 'Manage cards, view monthly receipts, or cancel anytime with one click in your dedicated Bachs Customer Portal.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </DesktopSidebarLayout>
  );
};
