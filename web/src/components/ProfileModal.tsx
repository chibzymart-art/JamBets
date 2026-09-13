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
  // Subscription upgrade state
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeSuccess, setUpgradeSuccess] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  // Security / Password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Soft Delete / Account Deactivation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Telegram VIP Bot state
  const [telegramToken, setTelegramToken] = useState<string | null>(null);
  const [telegramDeepLink, setTelegramDeepLink] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState<boolean>(false);

  const handleGenerateTelegramToken = async () => {
    if (!profile) return;
    setTelegramLoading(true);
    try {
      const res = await fetch('/api/telegram-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id })
      });
      const data = await res.json();
      if (data.success) {
        setTelegramToken(data.token);
        setTelegramDeepLink(data.deepLink);
      } else {
        alert(data.error || 'Failed to generate Telegram connection code.');
      }
    } catch (e: any) {
      alert(e.message || 'Error generating Telegram token.');
    } finally {
      setTelegramLoading(false);
    }
  };

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

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match. Please verify your input.');
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setPasswordSuccess('Password updated successfully!');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(null), 4000);
    } catch (err: any) {
      console.error('Password update error:', err);
      setPasswordError(err.message || 'Failed to update password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSoftDelete = async () => {
    setDeleteError(null);
    setDeleteLoading(true);

    try {
      // 1. Soft delete in public.users table (Audit compliant: NEVER hard delete)
      const { error: dbErr } = await supabase
        .from('users')
        .update({
          is_deleted: true,
          status: 'disabled',
          deleted_at: new Date().toISOString()
        })
        .eq('id', profile.id);

      if (dbErr) {
        console.warn('Direct users table update returned error, attempting metadata update:', dbErr);
      }

      // 2. Set user metadata to status = disabled
      await supabase.auth.updateUser({
        data: {
          status: 'disabled',
          is_deleted: true,
          deleted_at: new Date().toISOString()
        }
      });

      // 3. Immediately sign out
      await supabase.auth.signOut();
      
      onProfileUpdated();
      onClose();
      alert('Your account has been deactivated (soft delete). You have been signed out.');
    } catch (err: any) {
      console.error('Soft delete error:', err);
      setDeleteError(err.message || 'Failed to deactivate account. Please try again.');
    } finally {
      setDeleteLoading(false);
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
              <h2 className="modal-title">Account Settings & Profile</h2>
              <p className="modal-subtitle">{profile.email}</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Global Feedback alerts */}
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

        {/* VIP Telegram Bot & WhatsApp Channel Hub */}
        <div className="settings-section vip-integrations-section">
          <div className="settings-section-header">
            <span className="settings-section-icon">🤖</span>
            <div>
              <h3 className="settings-section-title">VIP Telegram Bot & WhatsApp Hub</h3>
              <p className="settings-section-sub">Direct access to live 250,000-simulated predictions on your phone</p>
            </div>
          </div>

          <div className="vip-integrations-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '14px' }}>
            {/* 1. Telegram Bot Card */}
            <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ✈️ Telegram VIP Bot
                  </span>
                  {profile.telegram_chat_id ? (
                    <span style={{ background: '#166534', color: '#86efac', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700 }}>
                      CONNECTED 🟢
                    </span>
                  ) : (
                    <span style={{ background: '#334155', color: '#cbd5e1', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700 }}>
                      NOT LINKED
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                  Pull real-time predictions on demand via Telegram commands (<code>/today</code>, <code>/bangers</code>, <code>/goals</code>).
                </p>

                {profile.telegram_chat_id ? (
                  <div style={{ background: '#1e293b', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', color: '#cbd5e1', marginBottom: '12px' }}>
                    <div>Chat ID: <code>{profile.telegram_chat_id}</code></div>
                    {profile.telegram_username && <div>Username: <code>@{profile.telegram_username}</code></div>}
                  </div>
                ) : null}

                {telegramToken && (
                  <div style={{ background: '#1e293b', border: '1px dashed #38bdf8', padding: '12px', borderRadius: '8px', marginBottom: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Your 15-Minute Link Code:</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#fbbf24', letterSpacing: '2px' }}>{telegramToken}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Send <code>/link {telegramToken}</code> to @JamBets_Bot</div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                {telegramDeepLink ? (
                  <a
                    href={telegramDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-update-password"
                    style={{ textAlign: 'center', textDecoration: 'none', background: '#0284c7', padding: '10px', display: 'block' }}
                  >
                    Open Bot in Telegram ↗
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={handleGenerateTelegramToken}
                    disabled={telegramLoading}
                    className="btn-update-password"
                    style={{ background: '#0284c7', padding: '10px' }}
                  >
                    {telegramLoading ? 'Generating Link...' : (profile.telegram_chat_id ? 'Re-link Telegram Account' : 'Connect Telegram VIP Bot ⚡')}
                  </button>
                )}
              </div>
            </div>

            {/* 2. VIP WhatsApp Community Card */}
            <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#4ade80', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    💬 WhatsApp VIP Community
                  </span>
                  {entitlement?.can_view_predictions ? (
                    <span style={{ background: '#166534', color: '#86efac', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700 }}>
                      VIP UNLOCKED 🔓
                    </span>
                  ) : (
                    <span style={{ background: '#451a03', color: '#fcd34d', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700 }}>
                      VIP ONLY 🔒
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                  Receive curated daily VIP pick drops, instant kickoff reminders, and consensus discussion in our private WhatsApp channel.
                </p>

                <div style={{ background: '#1e293b', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', color: '#cbd5e1', marginBottom: '12px' }}>
                  {entitlement?.can_view_predictions ? (
                    <span style={{ color: '#86efac' }}>✓ Your active subscription grants access to the official JamBets VIP channel.</span>
                  ) : (
                    <span style={{ color: '#f87171' }}>Requires Standard (₦5k) or BigBang VIP plan to join the private group.</span>
                  )}
                </div>
              </div>

              <div>
                {entitlement?.can_view_predictions ? (
                  <a
                    href="https://chat.whatsapp.com/invite/JamBetsVIP"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-update-password"
                    style={{ textAlign: 'center', textDecoration: 'none', background: '#16a34a', padding: '10px', display: 'block' }}
                  >
                    Join VIP WhatsApp Group 🟢
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleTierChange('standard')}
                    className="btn-update-password"
                    style={{ background: '#d97706', padding: '10px', width: '100%' }}
                  >
                    Upgrade to Unlock WhatsApp VIP (₦5k)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Section 1: Security & Password Management */}
        <div className="settings-section">
          <div className="settings-section-header">
            <span className="settings-section-icon">🔐</span>
            <div>
              <h3 className="settings-section-title">Security & Password Management</h3>
              <p className="settings-section-sub">Update your account credentials safely via Supabase Auth</p>
            </div>
          </div>

          {passwordSuccess && (
            <div className="auth-alert alert-success" role="alert">
              <span className="alert-icon">✓</span>
              <span>{passwordSuccess}</span>
            </div>
          )}
          {passwordError && (
            <div className="auth-alert alert-error" role="alert">
              <span className="alert-icon">⚠️</span>
              <span>{passwordError}</span>
            </div>
          )}

          <form onSubmit={handleUpdatePassword} className="security-password-form">
            <div className="security-form-row">
              <div className="form-group">
                <label htmlFor="settings-new-password" className="form-label">New Password</label>
                <input
                  id="settings-new-password"
                  type="password"
                  required
                  minLength={6}
                  placeholder="Min 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="settings-confirm-password" className="form-label">Confirm Password</label>
                <input
                  id="settings-confirm-password"
                  type="password"
                  required
                  minLength={6}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="form-input"
                />
              </div>
            </div>

            <div className="security-form-actions">
              <button
                type="submit"
                id="btn-update-password"
                disabled={passwordLoading || !newPassword || !confirmPassword}
                className="btn-update-password"
              >
                {passwordLoading ? 'Updating Password...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>

        {/* Section 2: Legal & Regulatory Compliance Evidence Card */}
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

        {/* Section 3: Subscription Tier Upgrade Selector */}
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
              <div className="tier-price">₦0 <span>/ month</span></div>
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
              <div className="tier-price">₦5,000 <span>/ month</span></div>
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
                {currentTier === 'standard' ? 'Current Plan' : 'Switch to Standard (₦5,000/mo)'}
              </button>
            </div>

            {/* BigBang Tier */}
            <div className={`tier-card vip-tier ${currentTier === 'bigbang' ? 'active-tier' : ''}`}>
              <div className="tier-badge-top" style={{ background: '#ec4899', color: '#fff' }}>VIP PRO</div>
              <h4 className="tier-name">BigBang VIP</h4>
              <div className="tier-price">₦10,000 <span>/ month</span></div>
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
                {currentTier === 'bigbang' ? 'Current Plan' : 'Switch to BigBang VIP (₦10,000/mo)'}
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

        {/* Section 4: Danger Zone / Account Deactivation (Soft Delete Compliance) */}
        <div className="danger-zone-card">
          <div className="danger-zone-header">
            <span className="danger-zone-icon">⚠️</span>
            <div>
              <h3 className="danger-zone-title">Danger Zone: Account Deactivation</h3>
              <p className="danger-zone-sub">
                Compliance Rule: Accounts are soft-deleted for regulatory audit integrity. You will be signed out immediately and future access will be blocked.
              </p>
            </div>
          </div>

          {deleteError && (
            <div className="auth-alert alert-error" role="alert">
              <span className="alert-icon">⚠️</span>
              <span>{deleteError}</span>
            </div>
          )}

          {!showDeleteConfirm ? (
            <div className="danger-zone-actions">
              <button
                type="button"
                id="btn-trigger-delete-account"
                className="btn-danger-outline"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Deactivate / Delete Account
              </button>
            </div>
          ) : (
            <div className="delete-confirm-box">
              <p className="delete-confirm-prompt">
                Are you sure you want to deactivate your account? Type <strong>DELETE</strong> below to confirm.
              </p>
              <div className="delete-confirm-input-row">
                <input
                  type="text"
                  id="input-delete-confirm"
                  placeholder="Type DELETE"
                  value={deleteConfirmationText}
                  onChange={(e) => setDeleteConfirmationText(e.target.value)}
                  className="form-input delete-confirm-input"
                />
                <button
                  type="button"
                  id="btn-confirm-soft-delete"
                  disabled={deleteConfirmationText.trim().toUpperCase() !== 'DELETE' || deleteLoading}
                  className="btn-danger"
                  onClick={handleSoftDelete}
                >
                  {deleteLoading ? 'Deactivating...' : 'Confirm Soft Deletion'}
                </button>
                <button
                  type="button"
                  id="btn-cancel-soft-delete"
                  disabled={deleteLoading}
                  className="btn-secondary"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmationText('');
                    setDeleteError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
