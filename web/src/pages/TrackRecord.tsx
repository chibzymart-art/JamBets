import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PICK_DISCLAIMER, SCORE_TIERS, ScoreTierKey } from '../lib/confidenceScore';
import { updatePageSeo } from '../lib/seo';

interface TierStats {
  tier: ScoreTierKey;
  range: string;
  name: string;
  won: number;
  lost: number;
  void: number;
  settled: number;
  hitRate: number | null;
}

interface ProductStats {
  product: 'football' | 'goals' | 'tennis' | 'basketball';
  label: string;
  market: string;
  won: number;
  lost: number;
  void: number;
  settled: number;
  hitRate: number | null;
  since: string | null;
  until: string | null;
  tiers: TierStats[];
}

interface RecentPick {
  kickoff: string;
  league: string | null;
  home: string | null;
  away: string | null;
  prediction: string;
  score: number | null;
  result: 'won' | 'lost';
  finalScore: string | null;
}

interface TrackRecordData {
  generatedAt: string;
  products: ProductStats[];
  recent: RecentPick[];
  note: string;
}

export function TrackRecordPage() {
  const [data, setData] = useState<TrackRecordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    updatePageSeo({
      title: 'Track Record: Settled Results by Confidence Score | Oddsbanta',
      description:
        'Every settled Oddsbanta pick, wins and losses, grouped by 0–10 confidence score tier with sample sizes. Live forward results only, not a backtest.',
      canonicalPath: '/dashboard/track-record',
    });

    let isMounted = true;
    fetch('/api/track-record')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!isMounted) return;
        if (json.success) {
          setData(json);
        } else {
          setError(json.error || 'Unable to load track record.');
        }
      })
      .catch((err) => {
        if (isMounted) setError(err.message || 'Network error fetching track record.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };


  return (
    <div className="track-record-page" style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header & Breadcrumb */}
      <nav aria-label="Breadcrumb" style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
        <Link to="/" style={{ color: 'var(--text-muted, #64748b)', textDecoration: 'none' }}>Home</Link>
        {' / '}
        <Link to="/dashboard" style={{ color: 'var(--text-muted, #64748b)', textDecoration: 'none' }}>Dashboard</Link>
        {' / '}
        <span style={{ color: 'var(--text-primary, #0f172a)', fontWeight: 600 }}>Track Record</span>
      </nav>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 999, background: '#ecfdf5', color: '#047857', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          ✓ 100% PUBLIC AUDIT
        </div>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary, #0f172a)' }}>
          Settled Results by Confidence Score
        </h1>
        <p style={{ color: 'var(--text-muted, #64748b)', fontSize: 15, maxWidth: 720, margin: 0, lineHeight: 1.5 }}>
          Every published pick is evaluated after the final whistle. The figures below show honest forward results across wins and losses — grouped strictly by our 0–10 confidence score tiers.
        </p>
      </div>

      {/* Cadence Explainer Card */}
      <section
        style={{
          background: '#ffffff',
          borderRadius: 16,
          border: '1px solid var(--border-subtle, #e2e8f0)',
          padding: '20px 24px',
          marginBottom: 32,
        }}
      >
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 10px' }}>Understanding the 0–10 Cadence</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', margin: '0 0 16px', lineHeight: 1.5 }}>
          The score expresses the statistical model’s estimated probability. It is <strong>not an accuracy promise</strong> or guarantee; actual historical hit rates for each tier are published below so you can judge model calibration transparently.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {Object.values(SCORE_TIERS).map((t) => (
            <div
              key={t.key}
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                border: `1px solid ${t.borderColor}`,
                background: t.bgColor,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: t.textColor, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{t.icon}</span>
                <span>{t.range}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #475569)', marginTop: 4 }}>
                {t.name} Confidence
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Loading & Error States */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted, #64748b)' }}>
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-600 mb-3" />
          <p style={{ fontWeight: 600, fontSize: 14 }}>Aggregating authoritative settled ledger...</p>
        </div>
      )}

      {error && !loading && (
        <div style={{ padding: 20, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#b91c1c', marginBottom: 24 }}>
          <strong>Notice:</strong> {error}
        </div>
      )}

      {/* Product Tables */}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {data.products.map((p) => {
            const hasData = p.settled > 0;
            return (
              <section
                key={p.product}
                style={{
                  background: '#ffffff',
                  borderRadius: 16,
                  border: '1px solid var(--border-subtle, #e2e8f0)',
                  padding: '24px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 4px', color: 'var(--text-primary, #0f172a)' }}>
                      {p.label}
                    </h3>
                    <div style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
                      {p.market} • {p.since ? `Live since ${formatDate(p.since)}` : 'Awaiting first settled pick'}
                    </div>
                  </div>
                  {hasData && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#047857' }}>
                        {p.hitRate !== null ? `${p.hitRate.toFixed(1)}%` : '—'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                        {p.won}W – {p.lost}L ({p.settled} decided)
                      </div>
                    </div>
                  )}
                </div>

                {/* Tiers Table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle, #e2e8f0)', color: 'var(--text-muted, #64748b)' }}>
                        <th style={{ padding: '8px 12px', fontWeight: 600 }}>Score Tier</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600 }}>Won</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600 }}>Lost</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600 }}>Sample Size</th>
                        <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Actual Hit Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.tiers.map((t) => {
                        const tierDef = SCORE_TIERS[t.tier];
                        return (
                          <tr key={t.tier} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '12px', fontWeight: 600 }}>
                              <span style={{ color: tierDef.textColor, marginRight: 6 }}>{tierDef.icon}</span>
                              <span>{t.range}</span>
                              <span style={{ color: 'var(--text-muted, #64748b)', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>({t.name})</span>
                            </td>
                            <td style={{ padding: '12px', color: '#047857', fontWeight: 600 }}>{t.won}</td>
                            <td style={{ padding: '12px', color: '#b91c1c', fontWeight: 600 }}>{t.lost}</td>
                            <td style={{ padding: '12px', color: 'var(--text-muted, #475569)' }}>{t.settled}</td>
                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700 }}>
                              {t.settled > 0 && t.hitRate !== null ? (
                                <span style={{ color: t.hitRate >= 75 ? '#047857' : t.hitRate >= 65 ? '#1d4ed8' : '#b45309' }}>
                                  {t.hitRate.toFixed(1)}%
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted, #94a3b8)', fontWeight: 400 }}>No picks yet</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {p.product === 'tennis' && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', margin: '14px 0 0', fontStyle: 'italic' }}>
                    * Tennis track record tracks primary Match Winner picks only. Secondary markets are delivered in real time for exploration.
                  </p>
                )}
              </section>
            );
          })}

          {/* Recent Picks Ledger (Wins AND Losses) */}
          {data.recent && data.recent.length > 0 && (
            <section
              style={{
                background: '#ffffff',
                borderRadius: 16,
                border: '1px solid var(--border-subtle, #e2e8f0)',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 6px', color: 'var(--text-primary, #0f172a)' }}>
                Latest Settled Football Picks
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', margin: '0 0 16px' }}>
                Both wins and losses are published transparently as matches conclude.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {data.recent.map((r, i) => {
                  const isWon = r.result === 'won';
                  return (
                    <div
                      key={i}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: `1px solid ${isWon ? '#bbf7d0' : '#fecaca'}`,
                        background: isWon ? '#f0fdf4' : '#fef2f2',
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted, #64748b)' }}>{r.league || 'Football'}</span>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            background: isWon ? '#16a34a' : '#dc2626',
                            color: '#ffffff',
                          }}
                        >
                          {isWon ? 'WON' : 'LOST'}
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary, #0f172a)', marginBottom: 4 }}>
                        {r.home} vs {r.away}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted, #475569)', fontSize: 12 }}>
                        <span>Pick: <strong>{r.prediction}</strong></span>
                        {r.score !== null && <span>Score: <strong>{r.score.toFixed(1)}/10</strong></span>}
                      </div>
                      {r.finalScore && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', marginTop: 4 }}>
                          FT: {r.finalScore}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Legal / Model Disclaimer Banner */}
          <footer style={{ padding: '16px 20px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, color: 'var(--text-muted, #64748b)', lineHeight: 1.5 }}>
            <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Public Audit Disclosure</p>
            <p style={{ margin: 0 }}>
              {PICK_DISCLAIMER} Every prediction is recorded in our cryptographic queue prior to kickoff and settled autonomously via verified match statistics. Past performance does not guarantee future results.
            </p>
          </footer>
        </div>
      )}
    </div>
  );
}
