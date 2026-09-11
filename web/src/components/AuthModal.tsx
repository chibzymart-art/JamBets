import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
  initialMode?: 'signin' | 'register' | 'forgot';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'signin'
}) => {
  const [mode, setMode] = useState<'signin' | 'register' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  
  // Mandatory Legal & Regulatory Disclaimers (Phase 8 Section 15)
  const [ageAccepted, setAgeAccepted] = useState(false);
  const [financialAccepted, setFinancialAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        throw error;
      }

      if (data.user) {
        // Check if user has been soft-deleted / disabled
        const { data: userRecord } = await supabase
          .from('users')
          .select('is_deleted, status')
          .eq('id', data.user.id)
          .single();

        if (userRecord?.is_deleted || userRecord?.status === 'disabled') {
          await supabase.auth.signOut();
          setErrorMessage('This account has been deactivated. Please contact support.');
          return;
        }

        setSuccessMessage('Successfully signed in!');
        setTimeout(() => {
          onAuthSuccess();
          onClose();
        }, 500);
      }
    } catch (err: any) {
      console.error('Sign-in error:', err);
      setErrorMessage(err.message || 'Invalid email or password. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Strict validation: BOTH disclaimers MUST be explicitly checked (Cases A, B, C rejected)
    if (!ageAccepted && !financialAccepted) {
      setErrorMessage('You must confirm you are 18+ and accept the financial indemnity disclaimer to register.');
      return;
    }
    if (!ageAccepted) {
      setErrorMessage('You must confirm you are 18 years or older and at the legal age for sports betting.');
      return;
    }
    if (!financialAccepted) {
      setErrorMessage('You must accept the educational purpose and financial indemnity disclaimer to register.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);

    try {
      // Send verified disclaimers in user metadata to trigger the server-side database validation
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim() || email.split('@')[0],
            disclaimer_age_accepted: true,
            disclaimer_financial_accepted: true,
            disclaimer_version: 'v1.0',
            status: 'active',
            is_deleted: false
          }
        }
      });

      if (error) {
        throw error;
      }

      if (data.user) {
        setSuccessMessage('Account created successfully! Disclaimers recorded.');
        setTimeout(() => {
          onAuthSuccess();
          onClose();
        }, 700);
      }
    } catch (err: any) {
      console.error('Registration error:', err);
      setErrorMessage(err.message || 'Registration failed. Please check your inputs.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email.trim()) {
      setErrorMessage('Please enter your registered email address.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) {
        throw error;
      }

      setSuccessMessage('Password reset link sent! Check your inbox (and spam folder) for instructions.');
    } catch (err: any) {
      console.error('Forgot password error:', err);
      const msg = err.message || '';
      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('over_email_send_rate_limit')) {
        setErrorMessage('Email rate limit reached. Supabase limits password recovery emails to prevent abuse. Please wait a short while before requesting another link.');
      } else {
        setErrorMessage(msg || 'Failed to send reset link. Please check the email and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card auth-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-brand">
            <span className="modal-brand-badge">JB</span>
            <div>
              <h2 className="modal-title">
                {mode === 'signin' && 'Sign In to JamBets'}
                {mode === 'register' && 'Create Your JamBets Account'}
                {mode === 'forgot' && 'Reset Your Password'}
              </h2>
              <p className="modal-subtitle">
                {mode === 'signin' && 'Access your subscription and verified 250k predictions'}
                {mode === 'register' && 'Join the statistical football modeling community'}
                {mode === 'forgot' && 'Enter your email to receive recovery instructions'}
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Tab Selector (Hidden or adapted when in forgot password mode) */}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab-btn ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => {
              setMode('signin');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab-btn ${mode === 'register' ? 'active' : ''}`}
            onClick={() => {
              setMode('register');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
          >
            Create Account
          </button>
        </div>

        {/* Status Alerts */}
        {errorMessage && (
          <div className="auth-alert alert-error" role="alert">
            <span className="alert-icon">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="auth-alert alert-success" role="alert">
            <span className="alert-icon">✓</span>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Form Body: Sign In */}
        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="auth-form">
            <div className="form-group">
              <label htmlFor="signin-email" className="form-label">Email Address</label>
              <input
                id="signin-email"
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <div className="form-label-row">
                <label htmlFor="signin-password" className="form-label">Password</label>
                <button
                  type="button"
                  id="btn-forgot-password-link"
                  className="auth-forgot-link"
                  onClick={() => {
                    setMode('forgot');
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                >
                  Forgot Password?
                </button>
              </div>
              <input
                id="signin-password"
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="form-input"
              />
            </div>

            <button type="submit" id="btn-auth-signin" disabled={loading} className="auth-submit-btn">
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* Form Body: Register */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} className="auth-form">
            <div className="form-group">
              <label htmlFor="register-name" className="form-label">Full Name / Display Name</label>
              <input
                id="register-name"
                type="text"
                placeholder="e.g. John Doe"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-email" className="form-label">Email Address</label>
              <input
                id="register-email"
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-password" className="form-label">Password (min 6 chars)</label>
              <input
                id="register-password"
                type="password"
                required
                minLength={6}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="form-input"
              />
            </div>

            {/* MANDATORY LEGAL & AGE DISCLAIMERS (Section 15) */}
            <div className="disclaimer-container">
              <div className="disclaimer-header">
                <span className="disclaimer-badge">MANDATORY LEGAL ACKNOWLEDGMENTS</span>
                <span className="disclaimer-version">Version v1.0</span>
              </div>

              {/* Disclaimer 1 */}
              <label className="disclaimer-checkbox-label" htmlFor="disclaimer-age">
                <input
                  type="checkbox"
                  id="disclaimer-age"
                  checked={ageAccepted}
                  onChange={(e) => setAgeAccepted(e.target.checked)}
                  className="disclaimer-checkbox"
                  required
                />
                <span className="disclaimer-text">
                  <strong>Age Verification:</strong> I confirm I am 18 years and above and at the legal age for sports betting.
                </span>
              </label>

              {/* Disclaimer 2 */}
              <label className="disclaimer-checkbox-label" htmlFor="disclaimer-financial">
                <input
                  type="checkbox"
                  id="disclaimer-financial"
                  checked={financialAccepted}
                  onChange={(e) => setFinancialAccepted(e.target.checked)}
                  className="disclaimer-checkbox"
                  required
                />
                <span className="disclaimer-text">
                  <strong>Financial Indemnity & Educational Notice:</strong> I understand that the information provided is not financial advice, is for educational/informational purposes only, and I indemnify JamBets from financial losses arising from reliance on the information provided.
                </span>
              </label>
            </div>

            <button
              type="submit"
              id="btn-auth-register"
              disabled={loading || !ageAccepted || !financialAccepted}
              className={`auth-submit-btn ${(!ageAccepted || !financialAccepted) ? 'btn-disabled' : ''}`}
            >
              {loading ? 'Registering Account...' : 'Agree & Create Account'}
            </button>
          </form>
        )}

        {/* Form Body: Forgot Password */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="auth-form">
            <div className="form-group">
              <label htmlFor="forgot-email" className="form-label">Registered Email Address</label>
              <input
                id="forgot-email"
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="form-input"
              />
              <p className="form-hint">
                We will send an encrypted, one-time password reset link to this email address.
              </p>
            </div>

            <button
              type="submit"
              id="btn-auth-forgot"
              disabled={loading}
              className="auth-submit-btn"
            >
              {loading ? 'Sending Recovery Link...' : 'Send Password Reset Link'}
            </button>

            <div className="auth-footer-action-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                id="btn-back-to-signin"
                className="btn-link-action"
                onClick={() => {
                  setMode('signin');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
              >
                ← Back to Sign In
              </button>
              <a
                href="/reset-password"
                className="btn-link-action"
                onClick={onClose}
                style={{ fontSize: '12px', color: '#059669', textDecoration: 'underline' }}
              >
                Open Full Recovery Page ↗
              </a>
            </div>
          </form>
        )}

        {/* Modal Footer Note */}
        <div className="modal-footer">
          <p className="footer-disclaimer-note">
            JamBets is a statistical simulation platform utilizing Dixon-Coles bivariate Poisson modeling. Predictions are probabilistic and never guarantee sports outcomes.
          </p>
        </div>
      </div>
    </div>
  );
};
