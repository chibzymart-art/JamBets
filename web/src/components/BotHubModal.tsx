import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface BotHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
  profile: any;
  onOpenAuth: (mode: 'signin' | 'register') => void;
  onProfileUpdated?: () => void;
  onOpenPricing?: () => void;
}

export const BotHubModal: React.FC<BotHubModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  profile,
  onOpenAuth,
  onOpenPricing,
}) => {
  const [telegramToken, setTelegramToken] = useState<string | null>(null);
  const [telegramDeepLink, setTelegramDeepLink] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleGenerateTelegramToken = async () => {
    if (!currentUser) {
      onClose();
      onOpenAuth('signin');
      return;
    }

    setTelegramLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        throw new Error('Please sign in to connect your Telegram account.');
      }

      const res = await fetch('/api/telegram-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'request_token' }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        setTelegramToken(data.token);
        setTelegramDeepLink(data.deepLink);
      } else {
        alert(data.error || 'Failed to generate Telegram connection code.');
      }
    } catch (e: any) {
      alert(e.message || 'Error generating Telegram link.');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!telegramToken) return;
    navigator.clipboard.writeText(telegramToken);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const isTelegramLinked = Boolean(profile?.telegram_chat_id);

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 10002 }}>
      <div
        className="bot-hub-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '740px',
          width: '94%',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, #0b1120 0%, #070b14 100%)',
          color: '#ffffff',
          borderRadius: '18px',
          border: '1px solid #1e293b',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(56, 189, 248, 0.15)',
          padding: '24px',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            borderBottom: '1px solid #1e293b',
            paddingBottom: '16px',
            marginBottom: '20px',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '24px' }}>🤖</span>
              <h2 style={{ margin: 0, fontSize: '21px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.3px' }}>
                VIP Bot Delivery: Telegram & WhatsApp
              </h2>
              <span
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #16a34a 100%)',
                  color: '#ffffff',
                  fontSize: '10.5px',
                  fontWeight: 900,
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  letterSpacing: '0.4px',
                }}
              >
                INSTANT ALERTS
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '13.5px', color: '#94a3b8', lineHeight: 1.5 }}>
              Never miss a 90%+ Super Banker or Over 2.5 blitz goal again. Get math-calibrated predictions pushed straight to your phone before bookmakers slash odds.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#cbd5e1',
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* 1. HOW BOT DELIVERY WORKS: 4-STEP PIPELINE (VERY CATCHY) */}
        <div style={{ marginBottom: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px' }}>⚡</span>
            <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              How Bot Delivery Works (Automated 4-Step Pipeline)
            </h3>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '10px',
            }}
          >
            {/* Step 1 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8' }}>STEP 01</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>🔬 250k Simulations</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
                Daily at 06:00 WAT, our Dixon-Coles cluster simulates each fixture 250,000 times for exact probabilities.
              </div>
            </div>

            {/* Step 2 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#4ade80' }}>STEP 02</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>🛡️ Anti-Loss Guard</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
                Risky coin-flips and trap matches are eliminated. Only P ≥ 85-96% conviction bankers survive.
              </div>
            </div>

            {/* Step 3 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(251, 191, 36, 0.2)',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#fbbf24' }}>STEP 03</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>📲 Direct Push</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
                Picks dispatch instantly to Telegram & WhatsApp. You bet early before bookmakers slash odds!
              </div>
            </div>

            {/* Step 4 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(168, 85, 247, 0.2)',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#c084fc' }}>STEP 04</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>⚡ On-Demand Bot</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
                Text <code>/today</code>, <code>/bangers</code>, or <code>/goals</code> in chat for immediate real-time slips anytime.
              </div>
            </div>
          </div>
        </div>

        {/* 2. CATCHY UPSELL CALLOUT: WHY BOT DELIVERY WINS */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.15) 0%, rgba(22, 163, 74, 0.15) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '16px' }}>💎</span>
              <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#f8fafc' }}>
                The VIP Advantage: Stop Manually Refreshing Browsers
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: '#cbd5e1', lineHeight: 1.4 }}>
              Web users check periodically and miss early pricing. Bot subscribers receive instant lock-screen notifications the second simulations finish. Included with all Paid Plans (Standard ₦5,000/mo & BigBang VIP).
            </p>
          </div>

          {onOpenPricing && (
            <button
              type="button"
              onClick={onOpenPricing}
              style={{
                background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                color: '#ffffff',
                border: 'none',
                padding: '9px 16px',
                borderRadius: '8px',
                fontWeight: 800,
                fontSize: '12.5px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)',
                whiteSpace: 'nowrap',
              }}
            >
              ⚡ View Plans & Upgrade (₦5k) →
            </button>
          )}
        </div>

        {/* 3. TWO ACTIONABLE BOT STATIONS */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          {/* Station 1: Telegram Bot */}
          <div
            style={{
              background: 'linear-gradient(180deg, #131d31 0%, #0b1220 100%)',
              border: '1px solid #0284c7',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 4px 16px rgba(2, 132, 199, 0.12)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>✈️</span>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#38bdf8' }}>Telegram VIP Bot</span>
                </div>
                {isTelegramLinked ? (
                  <span style={{ background: '#166534', color: '#86efac', fontSize: '10.5px', fontWeight: 800, padding: '2px 8px', borderRadius: '9999px' }}>
                    LINKED 🟢
                  </span>
                ) : (
                  <span style={{ background: '#1e293b', color: '#94a3b8', fontSize: '10.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px' }}>
                    READY TO CONNECT
                  </span>
                )}
              </div>

              <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                Instant commands right inside your Telegram app with live odds:
              </p>

              <div
                style={{
                  background: '#070b14',
                  border: '1px solid #1e293b',
                  borderRadius: '8px',
                  padding: '10px',
                  marginBottom: '12px',
                  fontSize: '11px',
                  color: '#94a3b8',
                  lineHeight: 1.6,
                }}
              >
                <div><code>/today</code> — All today's calibrated predictions</div>
                <div><code>/bangers</code> — High-certainty 90%+ Super Bankers</div>
                <div><code>/goals</code> — Over 2.5 & first-half goal blitz</div>
                <div><code>/tomorrow</code> — Early forward odds & early edges</div>
                <div><code>/settled</code> — Auditable ledger & verified ROI</div>
              </div>

              {isTelegramLinked && (
                <div
                  style={{
                    background: 'rgba(22, 101, 52, 0.2)',
                    border: '1px solid #166534',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    marginBottom: '12px',
                    fontSize: '11.5px',
                    color: '#86efac',
                  }}
                >
                  <div>✓ Connected to @Oddsbanta_bot</div>
                  {profile?.telegram_username && <div>Telegram: @{profile.telegram_username}</div>}
                </div>
              )}

              {telegramToken && (
                <div
                  style={{
                    background: '#070b14',
                    border: '1px dashed #38bdf8',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '12px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Your One-Time Link PIN (Valid 5 mins):</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '4px' }}>
                    <span style={{ fontSize: '22px', fontWeight: 900, color: '#fbbf24', letterSpacing: '2px' }}>{telegramToken}</span>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      style={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '4px 8px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedCode ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '6px' }}>
                    Send <code>/link {telegramToken}</code> to @Oddsbanta_bot
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              {!currentUser ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth('signin');
                  }}
                  style={{
                    background: '#0284c7',
                    border: 'none',
                    color: '#ffffff',
                    padding: '11px',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '13px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)',
                  }}
                >
                  Sign In to Connect Telegram ⚡
                </button>
              ) : telegramDeepLink ? (
                <a
                  href={telegramDeepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: '#0284c7',
                    color: '#ffffff',
                    padding: '11px',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '13px',
                    textAlign: 'center',
                    textDecoration: 'none',
                    display: 'block',
                    boxShadow: '0 4px 12px rgba(2, 132, 199, 0.4)',
                  }}
                >
                  Open @Oddsbanta_bot in Telegram ↗
                </a>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateTelegramToken}
                  disabled={telegramLoading}
                  style={{
                    background: isTelegramLinked ? '#1e293b' : '#0284c7',
                    border: isTelegramLinked ? '1px solid #38bdf8' : 'none',
                    color: '#ffffff',
                    padding: '11px',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontSize: '13px',
                    cursor: 'pointer',
                    boxShadow: isTelegramLinked ? 'none' : '0 4px 12px rgba(2, 132, 199, 0.4)',
                  }}
                >
                  {telegramLoading
                    ? 'Generating Connection Code...'
                    : isTelegramLinked
                    ? '🔄 Re-link Telegram Device'
                    : '⚡ Connect Telegram VIP Bot'}
                </button>
              )}
            </div>
          </div>

          {/* Station 2: WhatsApp Bot & Community */}
          <div
            style={{
              background: 'linear-gradient(180deg, #131d31 0%, #0b1220 100%)',
              border: '1px solid #16a34a',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 4px 16px rgba(22, 163, 74, 0.12)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>💬</span>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#4ade80' }}>WhatsApp VIP Bot</span>
                </div>
                <span style={{ background: '#166534', color: '#86efac', fontSize: '10.5px', fontWeight: 800, padding: '2px 8px', borderRadius: '9999px' }}>
                  DIRECT SIGNALS
                </span>
              </div>

              <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                Real-time prediction drops and automated banker alerts sent straight to your WhatsApp:
              </p>

              <div
                style={{
                  background: '#070b14',
                  border: '1px solid #1e293b',
                  borderRadius: '8px',
                  padding: '10px',
                  marginBottom: '12px',
                  fontSize: '11px',
                  color: '#94a3b8',
                  lineHeight: 1.6,
                }}
              >
                <div>🔥 <strong>Morning Banker Drop:</strong> Top 90%+ picks before 07:00 WAT</div>
                <div>⚡ <strong>Kickoff Alerts:</strong> Last-minute lineup and momentum flags</div>
                <div>🎯 <strong>Over 2.5 blitz:</strong> High-scoring matches alerted on the fly</div>
                <div>📲 <strong>Chat Support:</strong> 24/7 subscriber concierge on WhatsApp</div>
              </div>

              <div
                style={{
                  background: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid #22c55e',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  marginBottom: '12px',
                  fontSize: '11.5px',
                  color: '#86efac',
                }}
              >
                ✓ Available for Standard (₦5k) & VIP BigBang plan holders.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <a
                href="https://wa.me/?text=Hi%20Oddsbanta!%20I%20want%20to%20activate%20predictions%20on%20WhatsApp."
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: '#16a34a',
                  color: '#ffffff',
                  padding: '11px',
                  borderRadius: '8px',
                  fontWeight: 800,
                  fontSize: '13px',
                  textAlign: 'center',
                  textDecoration: 'none',
                  display: 'block',
                  boxShadow: '0 4px 12px rgba(22, 163, 74, 0.4)',
                }}
              >
                Connect on WhatsApp ↗
              </a>
            </div>
          </div>
        </div>

        {/* Footer info notice */}
        <div style={{ textAlign: 'center', fontSize: '11.5px', color: '#64748b', borderTop: '1px solid #1e293b', paddingTop: '14px' }}>
          💡 Both bots communicate with our cloud cluster via secure 256-bit webhooks. Zero leakage, zero manual manipulation.
        </div>
      </div>
    </div>
  );
};
