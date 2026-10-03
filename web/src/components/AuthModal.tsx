import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  initGoogleIdentityServices,
  renderBrandedGoogleButton,
  onGoogleAuthSuccess,
  onGoogleAuthError,
  triggerOAuthFallback
} from '../lib/googleAuth';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
  initialMode?: 'signin' | 'register' | 'forgot';
}

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, maxRetries: number, delayMs: number) => void;
}

function isRetryableAuthError(error: any): boolean {
  if (!error) return false;
  const status = error.status || error.statusCode;
  if (status === 429 || status === 503 || status === 504 || status === 502) {
    return true;
  }
  const msg = (error.message || error.error_description || '').toLowerCase();
  if (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('over_request_rate_limit') ||
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('gateway timeout') ||
    msg.includes('service unavailable')
  ) {
    return true;
  }
  return false;
}

async function executeAuthWithRetry<T>(
  action: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.initialDelayMs ?? 600;
  const maxDelay = options.maxDelayMs ?? 3500;

  let attempt = 0;
  while (true) {
    try {
      return await action();
    } catch (err: any) {
      attempt++;
      if (attempt > maxRetries || !isRetryableAuthError(err)) {
        throw err;
      }
      const backoff = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = Math.floor(Math.random() * 300);
      const delayMs = backoff + jitter;

      if (options.onRetry) {
        options.onRetry(attempt, maxRetries, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
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
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Google Identity Services (GIS) Button Container Refs & Loaded State
  const signinGoogleBtnRef = useRef<HTMLDivElement>(null);
  const registerGoogleBtnRef = useRef<HTMLDivElement>(null);
  const [gisLoaded, setGisLoaded] = useState(false);

  // Synchronize mode with initialMode and reset status on open
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMessage(null);
      setSuccessMessage(null);
      setQueueNotice(null);
      setLoading(false);
    }
  }, [isOpen, initialMode]);

  // Initialize Google Identity Services & Render Branded Button
  useEffect(() => {
    if (!isOpen) return;

    const unsubSuccess = onGoogleAuthSuccess(() => {
      setLoading(false);
      onAuthSuccess();
      onClose();
    });

    const unsubError = onGoogleAuthError((err: Error) => {
      setLoading(false);
      setErrorMessage(err.message || 'Google sign-in encountered an issue. Please try again.');
    });

    let isMounted = true;
    initGoogleIdentityServices().then((ready) => {
      if (!isMounted) return;
      if (ready) {
        setGisLoaded(true);
        // Small delay to allow container to mount in DOM
        setTimeout(() => {
          if (!isMounted) return;
          if (mode === 'signin' && signinGoogleBtnRef.current) {
            renderBrandedGoogleButton(signinGoogleBtnRef.current, {
              theme: 'filled_black',
              size: 'large',
              text: 'continue_with',
              shape: 'pill',
              width: 320,
            });
          } else if (mode === 'register' && registerGoogleBtnRef.current) {
            renderBrandedGoogleButton(registerGoogleBtnRef.current, {
              theme: 'filled_black',
              size: 'large',
              text: 'signup_with',
              shape: 'pill',
              width: 320,
            });
          }
        }, 50);
      }
    });

    return () => {
      isMounted = false;
      unsubSuccess();
      unsubError();
    };
  }, [isOpen, mode, onAuthSuccess, onClose]);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    if (loading) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setQueueNotice(null);
    setLoading(true);

    try {
      const { error } = await triggerOAuthFallback();
      if (error) {
        throw error;
      }
    } catch (err: any) {
      console.error('Google OAuth error:', err);
      const msg = err.message || '';
      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
        setErrorMessage('Server is receiving high traffic. Please wait a moment and try again.');
      } else {
        setErrorMessage(msg || 'Failed to initiate Google authentication. Please try again.');
      }
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // Prevent duplicate concurrent requests
    setErrorMessage(null);
    setSuccessMessage(null);
    setQueueNotice(null);
    setLoading(true);

    try {
      const { data, error } = await executeAuthWithRetry(async () => {
        const res = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (res.error) {
          throw res.error;
        }
        return res;
      }, {
        maxRetries: 3,
        initialDelayMs: 600,
        onRetry: (attempt, max) => {
          setQueueNotice(`High server demand — securing your session in queue... (Attempt ${attempt} of ${max})`);
        }
      });

      if (error) {
        throw error;
      }

      if (data?.user) {
        // High-concurrency optimization: check metadata to eliminate redundant DB roundtrip
        if (data.user.user_metadata?.status === 'disabled' || data.user.user_metadata?.is_deleted === true) {
          await supabase.auth.signOut();
          setErrorMessage('This account has been deactivated. Please contact support.');
          return;
        }

        setQueueNotice(null);
        setSuccessMessage('Successfully signed in!');
        setTimeout(() => {
          onAuthSuccess();
          onClose();
        }, 400);
      }
    } catch (err: any) {
      console.error('Sign-in error:', err);
      setQueueNotice(null);
      const msg = err.message || '';
      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
        setErrorMessage('Server is receiving unusually high traffic. Please wait a moment and try again.');
      } else {
        setErrorMessage(msg || 'Invalid email or password. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // Prevent duplicate concurrent requests
    setErrorMessage(null);
    setSuccessMessage(null);
    setQueueNotice(null);

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
      const { data, error } = await executeAuthWithRetry(async () => {
        // Send verified disclaimers in user metadata to trigger the server-side database validation
        const res = await supabase.auth.signUp({
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
        if (res.error) {
          throw res.error;
        }
        return res;
      }, {
        maxRetries: 3,
        initialDelayMs: 800,
        onRetry: (attempt, max) => {
          setQueueNotice(`Processing registration in queue due to high demand... (Attempt ${attempt} of ${max})`);
        }
      });

      if (error) {
        throw error;
      }

      if (data?.user) {
        setQueueNotice(null);
        setSuccessMessage('Account created successfully! Disclaimers recorded.');
        setTimeout(() => {
          onAuthSuccess();
          onClose();
        }, 600);
      }
    } catch (err: any) {
      console.error('Registration error:', err);
      setQueueNotice(null);
      const msg = err.message || '';
      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
        setErrorMessage('Server is receiving unusually high registration volume. Please wait a few seconds and try again.');
      } else {
        setErrorMessage(msg || 'Registration failed. Please check your inputs.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setQueueNotice(null);

    if (!email.trim()) {
      setErrorMessage('Please enter your registered email address.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await executeAuthWithRetry(async () => {
        const res = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`
        });
        if (res.error) {
          throw res.error;
        }
        return res;
      }, {
        maxRetries: 2,
        initialDelayMs: 1000,
        onRetry: (attempt, max) => {
          setQueueNotice(`Sending secure recovery link... (Attempt ${attempt} of ${max})`);
        }
      });

      if (error) {
        throw error;
      }

      setQueueNotice(null);
      setSuccessMessage('Password reset link sent! Check your inbox (and spam folder) for instructions.');
    } catch (err: any) {
      console.error('Forgot password error:', err);
      setQueueNotice(null);
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

  const handleModalClose = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setQueueNotice(null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleModalClose}>
      <div className="modal-card auth-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-brand">
            <img src="/oddsbanta-logo.svg" alt="Oddsbanta" className="modal-brand-logo-img" />
            <div>
              <h2 className="modal-title">
                {mode === 'signin' && 'Sign In to Oddsbanta'}
                {mode === 'register' && 'Create Your Oddsbanta Account'}
                {mode === 'forgot' && 'Reset Your Password'}
              </h2>
              <p className="modal-subtitle">
                {mode === 'signin' && 'Access your subscription and verified predictions'}
                {mode === 'register' && 'Join the statistical football modeling community'}
                {mode === 'forgot' && 'Enter your email to receive recovery instructions'}
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={handleModalClose} aria-label="Close modal">
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
              setQueueNotice(null);
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
              setQueueNotice(null);
            }}
          >
            Create Account
          </button>
        </div>

        {/* Status Alerts */}
        {queueNotice && (
          <div className="auth-alert alert-queue" role="status">
            <span className="alert-icon">⏳</span>
            <span>{queueNotice}</span>
          </div>
        )}
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
          <div className="auth-form-wrapper">
            {/* Google / Gmail 1-Click Sign In (GIS Branded - Zero Supabase URL Exposure) */}
            <div className="social-auth-section">
              <div
                ref={signinGoogleBtnRef}
                className="gis-btn-wrapper"
                style={{ display: 'flex', justifyContent: 'center', width: '100%', minHeight: '44px' }}
              />

              {!gisLoaded && (
                <button
                  type="button"
                  id="btn-google-signin"
                  disabled={loading}
                  onClick={handleGoogleSignIn}
                  className="google-oauth-btn"
                  title="Instant 1-Click Sign In with Gmail / Google"
                >
                  <svg className="google-icon-svg" viewBox="0 0 24 24" width="20" height="20">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  <span>Continue with Google / Gmail</span>
                </button>
              )}

              <div className="auth-divider">
                <span className="auth-divider-line" />
                <span className="auth-divider-text">or continue with email</span>
                <span className="auth-divider-line" />
              </div>
            </div>

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
          </div>
        )}

        {/* Form Body: Register */}
        {mode === 'register' && (
          <div className="auth-form-wrapper">
            {/* Google / Gmail 1-Click Registration (GIS Branded - Zero Supabase URL Exposure) */}
            <div className="social-auth-section">
              <div
                ref={registerGoogleBtnRef}
                className="gis-btn-wrapper"
                style={{ display: 'flex', justifyContent: 'center', width: '100%', minHeight: '44px' }}
              />

              {!gisLoaded && (
                <button
                  type="button"
                  id="btn-google-signup"
                  disabled={loading}
                  onClick={handleGoogleSignIn}
                  className="google-oauth-btn"
                  title="Instant 1-Click Sign Up with Gmail / Google"
                >
                  <svg className="google-icon-svg" viewBox="0 0 24 24" width="20" height="20">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  <span>Sign Up with Google / Gmail</span>
                </button>
              )}

              <p className="google-oauth-disclaimer">
                By continuing with Google, you verify you are 18+ and agree to Oddsbanta's Terms of Service & Financial Indemnity.
              </p>

              <div className="auth-divider">
                <span className="auth-divider-line" />
                <span className="auth-divider-text">or register with email</span>
                <span className="auth-divider-line" />
              </div>
            </div>

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
                    <strong>Financial Indemnity & Educational Notice:</strong> I understand that the information provided is not financial advice, is for educational/informational purposes only, and I indemnify Oddsbanta from financial losses arising from reliance on the information provided.
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
          </div>
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
            Oddsbanta is a statistical simulation platform utilizing Dixon-Coles bivariate Poisson modeling. Predictions are probabilistic and never guarantee sports outcomes.
          </p>
        </div>
      </div>
    </div>
  );
};
