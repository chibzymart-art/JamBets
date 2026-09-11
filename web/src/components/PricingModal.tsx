import React from 'react';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade?: (tier: 'standard' | 'bigbang') => void;
}

export const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose, onUpgrade }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card pricing-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-brand">
            <img src="/jambets-logo.svg" alt="JamBets" className="modal-brand-logo-img" />
            <div>
              <h2 className="modal-title">JamBets Subscriptions</h2>
              <p className="modal-subtitle">Instant mathematical edge — flat rates with verified 250k draws</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="pricing-banner-pill">
          <span className="pricing-flash-tag">⚡ SPECIAL FLAT RATE</span>
          <span>Access all European & World League predictions for <strong>₦5,000 / month</strong></span>
        </div>

        <div className="pricing-tiers-grid">
          {/* Standard Tier */}
          <div className="pricing-plan-card">
            <div className="plan-header">
              <span className="plan-badge standard">STANDARD</span>
              <div className="plan-price">
                <span className="currency">₦</span>
                <span className="amount">5,000</span>
                <span className="period">/ month</span>
              </div>
              <p className="plan-desc">Complete access to daily football predictions and simulation models.</p>
            </div>

            <ul className="plan-features">
              <li>✓ Unlocks all 4-Day Horizon predictions</li>
              <li>✓ Top Picks & High Confidence edges (≥83%)</li>
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
              Select Standard (₦5,000 / month)
            </button>
          </div>

          {/* BigBang VIP Tier */}
          <div className="pricing-plan-card popular">
            <div className="popular-ribbon">MOST POPULAR</div>
            <div className="plan-header">
              <span className="plan-badge bigbang">BIGBANG VIP</span>
              <div className="plan-price">
                <span className="currency">₦</span>
                <span className="amount">10,000</span>
                <span className="period">/ month</span>
              </div>
              <p className="plan-desc">VIP algorithmic suite with exclusive 96%+ Bangers & instant access.</p>
            </div>

            <ul className="plan-features">
              <li>✓ <strong>Everything in Standard</strong></li>
              <li>✓ <strong>Exclusive 🔥 BANGER signals (96%–100%)</strong></li>
              <li>✓ Full Poisson & Dixon-Coles parameter export</li>
              <li>✓ Priority settlement & zero-quarantine access</li>
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
              Unlock BigBang VIP (₦10,000 / month)
            </button>
          </div>
        </div>

        <div className="pricing-guarantee-note">
          <span>🛡 <strong>100% Mathematical Transparency:</strong> Every prediction is backed by 250,000 PCG64 draws recorded on Supabase before kickoff. All voided/cancelled matches are refunded.</span>
        </div>
      </div>
    </div>
  );
};
