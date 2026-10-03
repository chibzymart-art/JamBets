/**
 * Oddsbanta 0–10 Confidence Score — single source of truth for the UI.
 *
 * Score = model probability × 10, one decimal. Four tiers (from the product brief):
 *   9 and above · 8 to 8.9 · 6 to 7.9 · below 6
 *
 * The score expresses the model's own estimate. It is NOT an accuracy promise:
 * the real settled hit rate per tier is published on the Track Record page.
 *
 * Keep in sync with api/_lib/score.ts (server copy used by the track record + SSR).
 */

export type ScoreTierKey = 'tier9' | 'tier8' | 'tier6' | 'tierLow';
export type ScoreTierFilter = 'all' | ScoreTierKey;

export interface ScoreTier {
  key: ScoreTierKey;
  /** Short range label, e.g. "9+" */
  range: string;
  /** Human label, e.g. "Very High" */
  name: string;
  icon: string;
  className: string;
  textColor: string;
  borderColor: string;
  bgColor: string;
}

export const SCORE_TIERS: Record<ScoreTierKey, ScoreTier> = {
  tier9: { key: 'tier9', range: '9+', name: 'Very High', icon: '◆', className: 'score-tier-9', textColor: '#047857', borderColor: '#10b981', bgColor: '#ecfdf5' },
  tier8: { key: 'tier8', range: '8–8.9', name: 'High', icon: '▲', className: 'score-tier-8', textColor: '#1d4ed8', borderColor: '#3b82f6', bgColor: '#eff6ff' },
  tier6: { key: 'tier6', range: '6–7.9', name: 'Moderate', icon: '●', className: 'score-tier-6', textColor: '#b45309', borderColor: '#f59e0b', bgColor: '#fffbeb' },
  tierLow: { key: 'tierLow', range: 'Below 6', name: 'Low', icon: '○', className: 'score-tier-low', textColor: '#475569', borderColor: '#cbd5e1', bgColor: '#f8fafc' },
};

export const SCORE_TIER_ORDER: ScoreTierKey[] = ['tier9', 'tier8', 'tier6', 'tierLow'];

/** Accepts 0–1 or 0–100. Returns null when the probability is unknown (e.g. locked for guests). */
export function probabilityToScore(probability: number | null | undefined): number | null {
  if (probability === null || probability === undefined || Number.isNaN(Number(probability))) return null;
  let p = Number(probability);
  if (p > 1) p = p / 100;
  p = Math.min(1, Math.max(0, p));
  return Math.round(p * 100) / 10;
}

export function tierForScore(score: number): ScoreTier {
  if (score >= 9) return SCORE_TIERS.tier9;
  if (score >= 8) return SCORE_TIERS.tier8;
  if (score >= 6) return SCORE_TIERS.tier6;
  return SCORE_TIERS.tierLow;
}

/** Legacy engine categories still stored in the DB; used only when the probability is hidden. */
function tierFromLegacyCategory(category?: string | null): ScoreTier | null {
  const norm = (category || '').toUpperCase().replace(/[\s-]+/g, '_');
  switch (norm) {
    case 'BANGER':
    case 'TOP_PICK':
    case 'TOPPICK':
      return SCORE_TIERS.tier9;
    case 'HIGH_CONFIDENCE':
    case 'HIGHCONFIDENCE':
    case 'EARLY_STRIKE':
      return SCORE_TIERS.tier8;
    case 'MID_CONFIDENCE':
    case 'MIDCONFIDENCE':
    case 'LOW_CONFIDENCE':
    case 'LOWCONFIDENCE':
    case 'TEMPO_HIGH':
    case 'LEAN_OVER':
    case 'OVER_25_LOCK':
    case 'GOAL_MACHINE':
      return SCORE_TIERS.tier6;
    case 'RISKY':
      return SCORE_TIERS.tierLow;
    default:
      return null;
  }
}

export function isNoPick(category?: string | null): boolean {
  return (category || '').toUpperCase().replace(/[\s-]+/g, '_') === 'NO_SAFE_BANKER';
}

export interface ScoreInfo {
  score: number | null;
  tier: ScoreTier | null;
  /** True when the engine declined to make a pick (legacy NO_SAFE_BANKER). */
  noPick: boolean;
  /** e.g. "8.6/10 · High" or "Score 9+ · Very High" when the exact score is hidden. */
  label: string;
}

/** Probability wins; the legacy category is only a fallback when the probability is hidden. */
export function getScoreInfo(probability: number | null | undefined, category?: string | null): ScoreInfo {
  if (isNoPick(category)) {
    return { score: null, tier: null, noPick: true, label: 'No pick · pass' };
  }
  const score = probabilityToScore(probability);
  if (score !== null) {
    const tier = tierForScore(score);
    return { score, tier, noPick: false, label: `${score.toFixed(1)}/10 · ${tier.name}` };
  }
  const tier = tierFromLegacyCategory(category);
  if (tier) return { score: null, tier, noPick: false, label: `Score ${tier.range} · ${tier.name}` };
  return { score: null, tier: null, noPick: false, label: 'Score locked' };
}

export function matchesTierFilter(filter: ScoreTierFilter, probability: number | null | undefined, category?: string | null): boolean {
  if (filter === 'all') return true;
  const info = getScoreInfo(probability, category);
  return !!info.tier && info.tier.key === filter;
}

/** Standard per-pick disclaimer shown on every prediction surface. */
export const PICK_DISCLAIMER =
  'Model estimate, not a guarantee. Oddsbanta does not place bets on anyone’s behalf. 18+.';
