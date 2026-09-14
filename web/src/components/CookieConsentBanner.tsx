import React, { useState, useEffect } from 'react';
import { captureIncomingAttribution } from '../lib/attribution';

const CONSENT_KEY = 'oddsbanta_cookie_consent_v1';

export const CookieConsentBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Capture any incoming referral attribution tags immediately
    captureIncomingAttribution();

    // Check if consent has already been granted
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) {
      // Delay appearance slightly for natural entrance
      const timer = setTimeout(() => setIsVisible(true), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = (type: 'all' | 'essential') => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({
      status: type,
      timestamp: new Date().toISOString()
    }));
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="cookie-consent-floating-pill" role="region" aria-label="Cookie and Privacy Notice">
      <div className="cookie-consent-content">
        <span className="cookie-icon">🍪</span>
        <div className="cookie-text-wrap">
          <p className="cookie-title">
            <strong>Cookie & Analytical Notice:</strong> We use privacy-friendly local storage and cookies to calibrate your betting predictions, preserve your custom Acca slip, and track referral attribution.
          </p>
          <span className="cookie-legal-badge">NDPR & GDPR Compliant</span>
        </div>
      </div>

      <div className="cookie-consent-actions">
        <button
          type="button"
          className="cookie-btn cookie-accept-btn"
          onClick={() => handleAccept('all')}
        >
          Accept All
        </button>
        <button
          type="button"
          className="cookie-btn cookie-essential-btn"
          onClick={() => handleAccept('essential')}
        >
          Essential Only
        </button>
      </div>
    </div>
  );
};
