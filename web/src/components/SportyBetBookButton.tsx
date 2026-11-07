import React, { useState } from 'react';
import type { FavoritePredictionItem } from './FavoritesDrawer';

interface BookResponse {
  ok: boolean;
  code?: string;
  url?: string;
  totalOdds?: number;
  booked?: number;
  skipped?: { match: string; pick?: string; reason?: string }[];
  error?: string;
}

/** "Book on SportyBet" for the slip: returns a booking code the user loads in SportyBet. */
export const SportyBetBookButton: React.FC<{ items: FavoritePredictionItem[] }> = ({ items }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BookResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const book = async () => {
    setLoading(true);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch('/api/sportybet-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(i => ({
            id: i.id,
            homeTeam: i.homeTeam,
            awayTeam: i.awayTeam,
            targetKickoffAt: i.targetKickoffAt,
            market: i.market,
            prediction: i.prediction,
          })),
        }),
      });
      const data: BookResponse = await res.json().catch(() => ({ ok: false, error: 'Booking failed. Please try again.' }));
      setResult(data);
    } catch {
      setResult({ ok: false, error: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    if (!result?.code) return;
    navigator.clipboard?.writeText(result.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const skipped = (result?.skipped || []).filter(s => s.reason);

  return (
    <div className="sportybet-book" style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={book}
        disabled={loading || items.length === 0}
        style={{
          width: '100%',
          background: loading ? '#94a3b8' : '#16a34a',
          color: '#ffffff',
          border: 'none',
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? 'Booking on SportyBet…' : '🎟 Book on SportyBet'}
      </button>

      {result && (
        <div
          role="status"
          style={{
            marginTop: 8,
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${result.ok ? '#86efac' : '#fca5a5'}`,
            background: result.ok ? '#f0fdf4' : '#fef2f2',
            color: '#0f172a',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {result.ok && result.code ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  Booking code: <strong style={{ fontSize: 16, letterSpacing: 1 }}>{result.code}</strong>
                </span>
                <button
                  type="button"
                  onClick={copyCode}
                  style={{ border: '1px solid #16a34a', background: '#ffffff', color: '#166534', borderRadius: 6, padding: '4px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <div>
                {result.booked} pick{result.booked === 1 ? '' : 's'} booked
                {result.totalOdds ? ` · total odds ${result.totalOdds.toFixed(2)}` : ''}
              </div>
              {result.url && (
                <a href={result.url} target="_blank" rel="noopener noreferrer" style={{ color: '#166534', fontWeight: 700 }}>
                  Open the slip on SportyBet →
                </a>
              )}
            </>
          ) : (
            <div>⚠️ {result.error || 'Could not create a booking code.'}</div>
          )}
          {skipped.length > 0 && (
            <div style={{ marginTop: 6, color: '#475569' }}>
              Not included: {skipped.slice(0, 5).map(s => `${s.match} (${s.reason})`).join('; ')}
              {skipped.length > 5 ? `; and ${skipped.length - 5} more` : ''}
            </div>
          )}
          <div style={{ marginTop: 6, color: '#64748b', fontSize: 11 }}>
            Football goals and result picks only. The code works until the first match kicks off. 18+ · Bet responsibly.
          </div>
        </div>
      )}
    </div>
  );
};
