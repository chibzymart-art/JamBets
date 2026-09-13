import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface BotHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
  profile: any;
  onOpenAuth: (mode: 'signin' | 'register') => void;
  onProfileUpdated?: () => void;
}

export const BotHubModal: React.FC<BotHubModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  profile,
  onOpenAuth,
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
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10002 }}>
      <div
        className="bot-hub-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '680px',
          width: '94%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#0f172a',
          color: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #334155',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px rgba(56, 189, 248, 0.15)',
          padding: '24px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', paddingBottom: '16px', marginBottom: '20px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '24px' }}>🤖</span>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.3px' }}>
                Telegram & WhatsApp Bot Hub
              </h2>
              <span style={{ background: '#0284c7', color: '#ffffff', fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '9999px', letterSpacing: '0.5px' }}>
                INSTANT ALERTS
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
              Get all 250,000-simulated match predictions, 90%+ daily bankers, and Over 2.5 blitz goals delivered straight to your phone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            }}
          >
            ✕
          </button>
        </div>

        {/* Feature Highlights Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          {/* Card 1: Telegram Bot */}
          <div
            style={{
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid #38bdf8',
              borderRadius: '12px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 4px 14px rgba(56, 189, 248, 0.1)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>✈️</span>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#38bdf8' }}>Telegram VIP Bot</span>
                </div>
                {isTelegramLinked ? (
                  <span style={{ background: '#166534', color: '#86efac', fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '9999px' }}>
                    LINKED 🟢
                  </span>
                ) : (
                  <span style={{ background: '#334155', color: '#cbd5e1', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px' }}>
                    READY TO CONNECT
                  </span>
                )}
              </div>

              <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                Query on demand anytime using commands directly in your Telegram chat:
              </p>

              <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px', marginBottom: '14px', fontSize: '11px', color: '#94a3b8' }}>
                <div style={{ marginBottom: '4px' }}><code>/today</code> — All today's scheduled match predictions</div>
                <div style={{ marginBottom: '4px' }}><code>/bangers</code> — High-certainty 90%+ banker picks</div>
                <div style={{ marginBottom: '4px' }}><code>/goals</code> — Over 2.5 & first-half goal probabilities</div>
                <div><code>/status</code> — Check active subscription & verified win ledger</div>
              </div>

              {isTelegramLinked && (
                <div style={{ background: 'rgba(22, 101, 52, 0.2)', border: '1px solid #166534', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '12px', color: '#86efac' }}>
                  <div>✓ Connected to @Oddsbanta_bot</div>
                  {profile?.telegram_username && <div>Telegram: @{profile.telegram_username}</div>}
                </div>
              )}

              {telegramToken && (
                <div style={{ background: '#090d16', border: '1px dashed #38bdf8', borderRadius: '8px', padding: '12px', marginBottom: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Your One-Time Link PIN (Valid 5 mins):</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '6px' }}>
                    <span style={{ fontSize: '24px', fontWeight: 900, color: '#fbbf24', letterSpacing: '3px' }}>{telegramToken}</span>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      style={{ background: '#334155', border: 'none', color: '#ffffff', fontSize: '11px', fontWeight: 700, padding: '4px 8px', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      {copiedCode ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
                    Click below or send <code>/link {telegramToken}</code> to @Oddsbanta_bot
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
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

          {/* Card 2: WhatsApp Bot & Community */}
          <div
            style={{
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid #22c55e',
              borderRadius: '12px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 4px 14px rgba(34, 197, 94, 0.1)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>💬</span>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#4ade80' }}>WhatsApp VIP Bot</span>
                </div>
                <span style={{ background: '#166534', color: '#86efac', fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '9999px' }}>
                  DIRECT SIGNALS
                </span>
              </div>

              <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                Get real-time prediction drops and automated banker alerts sent straight to your WhatsApp.
              </p>

              <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px', marginBottom: '14px', fontSize: '11px', color: '#94a3b8' }}>
                <div style={{ marginBottom: '4px' }}>🔥 <strong>Daily Top Picks Broadcast:</strong> Curated 90%+ locks before kickoff</div>
                <div style={{ marginBottom: '4px' }}>⚡ <strong>Kickoff Alerts:</strong> Live updates and halftime momentum flags</div>
                <div>📲 <strong>Automated Commands:</strong> Interactive predictions inquiry on WhatsApp</div>
              </div>

              <div style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid #22c55e', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '12px', color: '#86efac' }}>
                ✓ Supported for all active Oddsbanta members on Standard (₦5k) and BigBang VIP plans.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
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
        <div style={{ textAlign: 'center', fontSize: '11px', color: '#64748b', borderTop: '1px solid #1e293b', paddingTop: '14px' }}>
          💡 Both bots query our live Supabase cluster directly with 250,000 Monte Carlo simulations per match. No delays, no manual edits.
        </div>
      </div>
    </div>
  );
};
