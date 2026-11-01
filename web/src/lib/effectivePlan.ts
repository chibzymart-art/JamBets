// The plan a user actually has, for display (Admin user list, profile, menu badge).
// Payments only write subscriptions/entitlements, never users.role, so reading role alone
// shows paying users as Free. Mirrors the server rules in api/_lib/jwt-verifier.ts:
// a role, an active subscription or a valid entitlement each count, and the highest wins.

export type EffectivePlan = 'admin' | 'bigbang' | 'standard' | 'free';

const VIP_TIERS = ['bigbang', 'big_bang', 'vip', 'pro', 'premium'];

interface PlanSubscription {
  tier?: string | null;
  status?: string | null;
  current_period_end?: string | null;
}

interface PlanEntitlement {
  tier?: string | null;
  valid_until?: string | null;
}

function planFromTier(raw: unknown): EffectivePlan {
  const tier = String(raw || '').toLowerCase().trim();
  if (tier === 'admin') return 'admin';
  if (VIP_TIERS.includes(tier)) return 'bigbang';
  if (tier === 'standard') return 'standard';
  return 'free';
}

const RANK: Record<EffectivePlan, number> = { free: 0, standard: 1, bigbang: 2, admin: 3 };

function stillOpen(until: string | null | undefined, nowMs: number): boolean {
  if (!until) return true;
  const ms = new Date(until).getTime();
  return Number.isFinite(ms) && ms > nowMs;
}

export function effectivePlan(
  role: string | null | undefined,
  subscription?: PlanSubscription | null,
  entitlement?: PlanEntitlement | null,
  nowMs: number = Date.now()
): EffectivePlan {
  let best = planFromTier(role);
  const consider = (plan: EffectivePlan) => {
    if (RANK[plan] > RANK[best]) best = plan;
  };
  if (subscription && String(subscription.status || '').toLowerCase() === 'active' && stillOpen(subscription.current_period_end, nowMs)) {
    consider(planFromTier(subscription.tier));
  }
  if (entitlement && stillOpen(entitlement.valid_until, nowMs)) {
    consider(planFromTier(entitlement.tier));
  }
  return best;
}
