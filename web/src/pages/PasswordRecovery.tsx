import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export const PasswordRecoveryPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Detect if user landed with a recovery token / session
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  useEffect(() => {
    // Check if the URL has recovery tokens (from Supabase password reset email)
    const hash = window.location.hash;
    if (hash && (hash.includes('type=recovery') || hash.includes('access_token='))) {
      setIsResettingPassword(true);
    }

    // Also listen to Supabase auth state change for recovery event
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsResettingPassword(true);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Handler for requesting password reset email
  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage('Please enter your registered email address.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(
        'Password recovery email has been sent! Please check your inbox and spam folder for instructions to create a new password.'
      );
    } catch (err: any) {
      console.error('Password reset request error:', err);
      const msg = err.message || '';
      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('over_email_send_rate_limit')) {
        setErrorMessage('Email rate limit reached. Supabase limits password recovery emails to a few per hour for security. Please wait a short while before requesting another link, or log in directly with your password.');
      } else {
        setErrorMessage(msg || 'Failed to send recovery email. Please verify your address and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Handler for setting a new password once authenticated with recovery token
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (newPassword.length < 6) {
      setErrorMessage('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please retype carefully.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        throw error;
      }

      setSuccessMessage('🎉 Your password has been successfully updated! Directing you to the Dashboard...');
      setTimeout(() => {
        navigate('/dashboard');
      }, 1500);
    } catch (err: any) {
      console.error('Update password error:', err);
      setErrorMessage(err.message || 'Failed to update password. Your recovery link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="recovery-page-wrapper">
      <div className="recovery-card">
        {/* Brand Header */}
        <div className="recovery-header">
          <Link to="/" className="recovery-brand-link" title="Return to JamBets Home">
            <div className="brand-icon-sq" style={{ width: 44, height: 44, fontSize: 20 }}>J</div>
            <div>
              <span className="brand-text-name" style={{ fontSize: 22 }}>JamBets</span>
              <span className="brand-text-tag">Account Security</span>
            </div>
          </Link>
          <h1 className="recovery-title">
            {isResettingPassword ? 'Set New Password' : 'Password Recovery'}
          </h1>
          <p className="recovery-subtitle">
            {isResettingPassword
              ? 'Choose a strong, secure password with at least 6 characters.'
              : 'Enter your registered email and we will send you a secure link to reset your account credentials.'}
          </p>
        </div>

        {/* Feedback Messages */}
        {errorMessage && (
          <div className="auth-error-banner" role="alert">
            <span className="error-icon">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="auth-success-banner" role="status">
            <span className="success-icon">✓</span>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Form: Mode A (Request Email) */}
        {!isResettingPassword && (
          <form onSubmit={handleRequestReset} className="recovery-form">
            <div className="auth-form-group">
              <label htmlFor="recovery-email" className="auth-label">
                Registered Email Address
              </label>
              <input
                id="recovery-email"
                type="email"
                className="auth-input"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn-auth-submit"
              disabled={loading}
            >
              {loading ? 'Sending Recovery Link...' : '⚡ Send Recovery Link'}
            </button>

            <div className="recovery-footer-links">
              <Link to="/" className="recovery-back-link">
                ← Back to Home
              </Link>
              <Link to="/dashboard" className="recovery-back-link">
                Launch Dashboard →
              </Link>
            </div>
          </form>
        )}

        {/* Form: Mode B (Set New Password with Token) */}
        {isResettingPassword && (
          <form onSubmit={handleUpdatePassword} className="recovery-form">
            <div className="auth-form-group">
              <label htmlFor="new-password" className="auth-label">
                New Password
              </label>
              <div className="password-input-wrapper" style={{ position: 'relative' }}>
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  className="auth-input"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: '#64748b'
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="auth-form-group">
              <label htmlFor="confirm-password" className="auth-label">
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                placeholder="Retype your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn-auth-submit"
              disabled={loading}
            >
              {loading ? 'Updating Password...' : '🔒 Save New Password & Sign In'}
            </button>

            <div className="recovery-footer-links">
              <button
                type="button"
                className="recovery-back-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={() => setIsResettingPassword(false)}
              >
                Request another reset link
              </button>
            </div>
          </form>
        )}

        <div className="recovery-security-note">
          <span>🔒 Protected by 256-bit SSL encryption & Supabase Auth Security.</span>
        </div>
      </div>
    </div>
  );
};
