import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
  initialMode?: 'signin' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'signin'
}) => {
  const [mode, setMode] = useState<'signin' | 'register'>(initialMode);
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
            disclaimer_version: 'v1.0'
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card auth-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-brand">
            <span className="modal-brand-badge">JB</span>
            <div>
              <h2 className="modal-title">
                {mode === 'signin' ? 'Sign In to JamBets' : 'Create Your JamBets Account'}
              </h2>
              <p className="modal-subtitle">
                {mode === 'signin'
                  ? 'Access your subscription and verified 250k predictions'
                  : 'Join the statistical football modeling community'}
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Tab Selector */}
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

        {/* Form Body */}
        {mode === 'signin' ? (
          <form onSubmit={handleSignIn} className="auth-form">
            <div className="form-group">
              <label htmlFor="signin-email">Email Address</label>
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
              <label htmlFor="signin-password">Password</label>
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

            <button type="submit" disabled={loading} className="auth-submit-btn">
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="auth-form">
            <div className="form-group">
              <label htmlFor="register-name">Full Name / Display Name</label>
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
              <label htmlFor="register-email">Email Address</label>
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
              <label htmlFor="register-password">Password (min 6 chars)</label>
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
              <label className="disclaimer-checkbox-label">
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
              <label className="disclaimer-checkbox-label">
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
              disabled={loading || !ageAccepted || !financialAccepted}
              className={`auth-submit-btn ${(!ageAccepted || !financialAccepted) ? 'btn-disabled' : ''}`}
            >
              {loading ? 'Registering Account...' : 'Agree & Create Account'}
            </button>
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
