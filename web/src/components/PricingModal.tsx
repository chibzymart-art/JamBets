import React from 'react';
import { useGeoCurrency } from '../lib/geoCurrency';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade?: (tier: 'standard' | 'bigbang') => void;
}

export const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose, onUpgrade }) => {
  const { currency, symbol, pricing, formatPrice } = useGeoCurrency();

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card pricing-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-brand">
            <img src="/logo.svg" alt="Oddsbanta" className="modal-brand-logo-img" style={{ width: 44, height: 44, borderRadius: 10 }} />
            <div>
              <h2 className="modal-title">Oddsbanta Subscriptions</h2>
              <p className="modal-subtitle">Instant mathematical edge — transparent 0–10 confidence scores and audited track record</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="pricing-banner-pill">
          <span className="pricing-flash-tag">⚡ SPECIAL FLAT RATE</span>
          <span>Access all European & World League predictions for <strong>{formatPrice(pricing.standard.monthly)} / month</strong></span>
        </div>

        <div className="pricing-tiers-grid">
          {/* Standard Tier */}
          <div className="pricing-plan-card">
            <div className="plan-header">
              <span className="plan-badge standard">STANDARD</span>
              <div className="plan-price">
                <span className="currency">{symbol}</span>
                <span className="amount">{currency === 'NGN' ? '5,000' : '5'}</span>
                <span className="period">/ month</span>
              </div>
              <p className="plan-desc">Complete access to daily football predictions, goal specialists and simulation models.</p>
            </div>

            <ul className="plan-features">
              <li>✓ Full Football access (Over 2.5 & First Half Goals)</li>
              <li>✓ Unlocks all 4-Day Horizon predictions</li>
              <li>✓ Top Picks & High Confidence edges (Score ≥ 8.0)</li>
              <li>✓ Mid & Low confidence value markets</li>
              <li>✓ Live match scoring & settlement alerts</li>
              <li>✓ 15-Minute automated live settlement sync</li>
            </ul>

            <button
              type="button"
              className="btn-select-plan standard"
              onClick={() => {
                if (onUpgrade) onUpgrade('standard');
                onClose();
              }}
            >
              Select Standard ({formatPrice(pricing.standard.monthly)} / month)
            </button>
          </div>

          {/* BigBang VIP Tier */}
          <div className="pricing-plan-card popular">
            <div className="popular-ribbon">MOST POPULAR</div>
            <div className="plan-header">
              <span className="plan-badge bigbang">BIGBANG VIP</span>
              <div className="plan-price">
                <span className="currency">{symbol}</span>
                <span className="amount">{currency === 'NGN' ? '10,000' : '10'}</span>
                <span className="period">/ month</span>
              </div>
              <p className="plan-desc">VIP algorithmic suite with multi-sport coverage and priority alerts.</p>
            </div>

            <ul className="plan-features">
              <li>✓ <strong>Everything in Standard (All Football & Goals)</strong></li>
              <li>✓ <strong>Multi-Sport VIP: Tennis (ATP/WTA) & Basketball (NBA)</strong></li>
              <li>✓ <strong>Exclusive Top Mathematical Signals (Score 9.0–10.0)</strong></li>
              <li>✓ Full Poisson & Model parameter breakdowns</li>
              <li>✓ Priority settlement & instant match access</li>
              <li>✓ VIP Telegram & WhatsApp instant match signals</li>
            </ul>

            <button
              type="button"
              className="btn-select-plan bigbang"
              onClick={() => {
                if (onUpgrade) onUpgrade('bigbang');
                onClose();
              }}
            >
              Unlock BigBang VIP ({formatPrice(pricing.bigbang.monthly)} / month)
            </button>
          </div>
        </div>

        <div className="modal-footer-note">
          <p>
            🔒 All payments securely processed with instant database activation.
            Cancel anytime with zero long-term commitments.
          </p>
        </div>
      </div>
    </div>
  );
};
