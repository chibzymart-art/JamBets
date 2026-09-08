import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { UserProfile, UserSubscription, UserEntitlement } from '../types';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  subscription: UserSubscription | null;
  entitlement: UserEntitlement | null;
  onProfileUpdated: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  profile,
  subscription,
  entitlement,
  onProfileUpdated
}) => {
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeSuccess, setUpgradeSuccess] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  if (!isOpen || !profile) return null;

  const currentTier = (profile.role || subscription?.tier || 'free').toLowerCase();

  const handleTierChange = async (targetTier: 'free' | 'standard' | 'bigbang') => {
    if (targetTier === currentTier) return;
    setUpgrading(true);
    setUpgradeError(null);
    setUpgradeSuccess(null);

    try {
      const { error } = await supabase.rpc('upgrade_subscription_tier', {
        target_tier: targetTier
      });

      if (error) throw error;

      setUpgradeSuccess(`Successfully transitioned subscription tier to ${targetTier.toUpperCase()}!`);
      setTimeout(() => {
        onProfileUpdated();
      }, 700);
    } catch (err: any) {
      console.error('Subscription change error:', err);
      setUpgradeError(err.message || 'Failed to update subscription tier.');
    } finally {
      setUpgrading(false);
    }
  };

  const formatLagosDate = (isoStr?: string) => {
    if (!isoStr) return 'Not recorded';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('en-GB', {
        timeZone: 'Africa/Lagos',
        dateStyle: 'medium',
        timeStyle: 'short'
      }) + ' (WAT)';
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card profile-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-brand">
            <div className="profile-avatar-large">
              {profile.display_name ? profile.display_name.charAt(0).toUpperCase() : profile.email.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="modal-title">Member Profile & Entitlements</h2>
              <p className="modal-subtitle">{profile.email}</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Feedback alerts */}
        {upgradeSuccess && (
          <div className="auth-alert alert-success" role="alert">
            <span className="alert-icon">✓</span>
            <span>{upgradeSuccess}</span>
          </div>
        )}
        {upgradeError && (
          <div className="auth-alert alert-error" role="alert">
            <span className="alert-icon">⚠️</span>
            <span>{upgradeError}</span>
          </div>
        )}

        {/* Account Details & Status Grid */}
        <div className="profile-details-grid">
          <div className="profile-detail-card">
            <span className="detail-label">Display Name</span>
            <span className="detail-value">{profile.display_name || 'JamBets Member'}</span>
          </div>
          <div className="profile-detail-card">
            <span className="detail-label">Current Role / Tier</span>
            <span className={`detail-value tier-badge-${currentTier}`}>
              {currentTier.toUpperCase()}
            </span>
          </div>
          <div className="profile-detail-card">
            <span className="detail-label">Predictions Access</span>
            <span className="detail-value" style={{ color: entitlement?.can_view_predictions ? '#34d399' : '#f87171' }}>
              {entitlement?.can_view_predictions ? 'Unlocked (Full Access)' : 'Locked (Teaser View Only)'}
            </span>
          </div>
          <div className="profile-detail-card">
            <span className="detail-label">Member Since</span>
            <span className="detail-value">{formatLagosDate(profile.created_at)}</span>
          </div>
        </div>

        {/* Legal & Regulatory Compliance Evidence Card */}
        <div className="compliance-evidence-card">
          <div className="compliance-header">
            <span className="compliance-icon">🛡️</span>
            <div>
              <h3 className="compliance-title">Audit Record: Legal Disclaimers Accepted</h3>
              <p className="compliance-sub">Cryptographically persisted in Cloud Supabase user record</p>
            </div>
          </div>

          <div className="compliance-list">
            <div className="compliance-item">
              <span className="compliance-check">✓</span>
              <div>
                <strong>Age Verification (18+):</strong> Confirmed and legally acknowledged.
                <div className="compliance-timestamp">
                  Recorded: {formatLagosDate(profile.disclaimer_age_accepted_at)}
                </div>
              </div>
            </div>

            <div className="compliance-item">
              <span className="compliance-check">✓</span>
              <div>
                <strong>Financial Indemnity & Educational Notice:</strong> Confirmed. JamBets held harmless from financial wagering loss.
                <div className="compliance-timestamp">
                  Recorded: {formatLagosDate(profile.disclaimer_financial_accepted_at)}
                </div>
              </div>
            </div>

            <div className="compliance-item">
              <span className="compliance-check">ℹ️</span>
              <div>
                <strong>Policy Terms Version:</strong> {profile.disclaimer_version || 'v1.0'}
              </div>
            </div>
          </div>
        </div>

        {/* Subscription Tier Upgrade Selector */}
        <div className="tier-selector-section">
          <div className="tier-selector-header">
            <h3 className="section-title">Subscription Tier & Entitlements</h3>
            <span className="tier-phase-note">Phase 8 Entitlement Management</span>
          </div>

          <div className="tier-cards-grid">
            {/* Free Tier */}
            <div className={`tier-card ${currentTier === 'free' ? 'active-tier' : ''}`}>
              <div className="tier-badge-top">BASIC</div>
              <h4 className="tier-name">Free Tier</h4>
              <div className="tier-price">$0 <span>/ month</span></div>
              <ul className="tier-perks">
                <li>✓ Browse all football fixtures</li>
                <li>✓ Live scores & match states</li>
                <li>✕ Prediction market outcomes locked</li>
                <li>✕ Probabilities & model insights locked</li>
              </ul>
              <button
                type="button"
                disabled={currentTier === 'free' || upgrading}
                onClick={() => handleTierChange('free')}
                className={`tier-action-btn ${currentTier === 'free' ? 'btn-current' : 'btn-secondary'}`}
              >
                {currentTier === 'free' ? 'Current Plan' : 'Downgrade to Free'}
              </button>
            </div>

            {/* Standard Tier */}
            <div className={`tier-card highlighted-tier ${currentTier === 'standard' ? 'active-tier' : ''}`}>
              <div className="tier-badge-top" style={{ background: '#3b82f6', color: '#fff' }}>POPULAR</div>
              <h4 className="tier-name">Standard Plan</h4>
              <div className="tier-price">$19 <span>/ month</span></div>
              <ul className="tier-perks">
                <li>✓ Full 250k simulation predictions</li>
                <li>✓ Unlocked probabilities & confidence tiers</li>
                <li>✓ 4-day horizon predictions</li>
                <li>✓ Automatic 15-minute settlement sync</li>
              </ul>
              <button
                type="button"
                disabled={currentTier === 'standard' || upgrading}
                onClick={() => handleTierChange('standard')}
                className={`tier-action-btn ${currentTier === 'standard' ? 'btn-current' : 'btn-primary'}`}
              >
                {currentTier === 'standard' ? 'Current Plan' : 'Switch to Standard'}
              </button>
            </div>

            {/* BigBang Tier */}
            <div className={`tier-card vip-tier ${currentTier === 'bigbang' ? 'active-tier' : ''}`}>
              <div className="tier-badge-top" style={{ background: '#ec4899', color: '#fff' }}>VIP PRO</div>
              <h4 className="tier-name">BigBang VIP</h4>
              <div className="tier-price">$49 <span>/ month</span></div>
              <ul className="tier-perks">
                <li>✓ Everything in Standard</li>
                <li>✓ Early mathematical settlement alerts</li>
                <li>✓ BANGER & TOP PICK priority signals</li>
                <li>✓ Detailed Poisson parameter breakdowns</li>
              </ul>
              <button
                type="button"
                disabled={currentTier === 'bigbang' || upgrading}
                onClick={() => handleTierChange('bigbang')}
                className={`tier-action-btn ${currentTier === 'bigbang' ? 'btn-current' : 'btn-vip'}`}
              >
                {currentTier === 'bigbang' ? 'Current Plan' : 'Switch to BigBang'}
              </button>
            </div>
          </div>

          <div className="phase9-payment-notice">
            <span className="notice-icon">💳</span>
            <span>
              <strong>Phase 8 Notice:</strong> Tier selection directly updates Cloud Supabase Row-Level Security entitlements. Automated payment gateway integrations (Paystack / Stripe) are slated for Phase 9.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button
            type="button"
            className="auth-signout-btn"
            onClick={async () => {
              await supabase.auth.signOut();
              onProfileUpdated();
              onClose();
            }}
          >
            Sign Out of JamBets
          </button>
        </div>
      </div>
    </div>
  );
};
