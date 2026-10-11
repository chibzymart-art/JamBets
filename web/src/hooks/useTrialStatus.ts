import { useState, useEffect, useMemo } from 'react';
import { UserProfile, UserSubscription, UserEntitlement } from '../types';

export type TrialStatusType = 'visitor' | 'trial_active' | 'trial_expired' | 'paid_vip';

export interface TrialStatusResult {
  status: TrialStatusType;
  isVisitor: boolean;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  isPaidVip: boolean;
  isAdmin: boolean;
  validUntil: string | null;
  remainingMs: number;
  remainingHours: number;
  remainingDays: number;
  remainingTimeDisplay: string;
  // Scoped feature access flags
  canViewFootballPredictions: boolean;
  canViewFootballSettlements: boolean;
  canViewSpecialistMarkets: boolean;
  canViewTennis: boolean;
  canViewBasketball: boolean;
}

const ADMIN_EMAILS = new Set([
  'chibzymart@gmail.com',
  'whizzchibz@gmail.com',
  'chibuezec.amuchie@gmail.com',
  'chibuezeamuchie@gmail.com',
  'nnamdiamuchie@gmail.com',
]);

/**
 * useTrialStatus
 * Oddsbanta reactive hook to manage the 3-day free trial lifecycle.
 * - Visitors: Blinded from active predictions and historical settlements.
 * - Active Trial: 100% full access to main football predictions & verified settlements for 3 days.
 * - Expired Trial: Blinded from settlements and active predictions (VIP upgrade prompt).
 * - Specialist engines (goals, corners), tennis, and basketball strictly require Paid VIP.
 */
export function useTrialStatus(
  currentUser: any | null,
  profile: UserProfile | null,
  subscription: UserSubscription | null,
  entitlement: UserEntitlement | null
): TrialStatusResult {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Heartbeat to update countdown every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    // 1. Visitor state (not logged in)
    if (!currentUser) {
      return {
        status: 'visitor',
        isVisitor: true,
        isTrialActive: false,
        isTrialExpired: false,
        isPaidVip: false,
        isAdmin: false,
        validUntil: null,
        remainingMs: 0,
        remainingHours: 0,
        remainingDays: 0,
        remainingTimeDisplay: 'Register for 3-Day Free Trial',
        canViewFootballPredictions: false,
        canViewFootballSettlements: false,
        canViewSpecialistMarkets: false,
        canViewTennis: false,
        canViewBasketball: false,
      };
    }

    // 2. Admin Check
    const userEmail = (currentUser.email || profile?.email || '').toLowerCase().trim();
    const isAdmin = Boolean(
      profile?.role === 'admin' ||
      currentUser.app_metadata?.role === 'admin' ||
      currentUser.user_metadata?.role === 'admin' ||
      (userEmail && ADMIN_EMAILS.has(userEmail)) ||
      (entitlement?.features as any)?.admin === true
    );

    if (isAdmin) {
      return {
        status: 'paid_vip',
        isVisitor: false,
        isTrialActive: true,
        isTrialExpired: false,
        isPaidVip: true,
        isAdmin: true,
        validUntil: null,
        remainingMs: Infinity,
        remainingHours: Infinity,
        remainingDays: Infinity,
        remainingTimeDisplay: 'Admin Access',
        canViewFootballPredictions: true,
        canViewFootballSettlements: true,
        canViewSpecialistMarkets: true,
        canViewTennis: true,
        canViewBasketball: true,
      };
    }

    // 3. Paid VIP Subscription Check
    const subTier = (subscription?.tier || '').toLowerCase();
    const hasActivePaidSub = Boolean(
      subscription?.status === 'active' &&
      ['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(subTier)
    );

    const entTier = (entitlement?.tier || '').toLowerCase();
    const entValidUntilMs = entitlement?.valid_until
      ? new Date(entitlement.valid_until).getTime()
      : 0;
    const hasActivePaidEnt = Boolean(
      ['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(entTier) &&
      (!entitlement?.valid_until || entValidUntilMs > nowMs)
    );

    if (hasActivePaidSub || hasActivePaidEnt) {
      return {
        status: 'paid_vip',
        isVisitor: false,
        isTrialActive: true,
        isTrialExpired: false,
        isPaidVip: true,
        isAdmin: false,
        validUntil: entitlement?.valid_until || subscription?.expires_at || null,
        remainingMs: Infinity,
        remainingHours: Infinity,
        remainingDays: Infinity,
        remainingTimeDisplay: 'Oddsbanta VIP Active',
        canViewFootballPredictions: true,
        canViewFootballSettlements: true,
        canViewSpecialistMarkets: true,
        canViewTennis: true,
        canViewBasketball: true,
      };
    }

    // 4. 3-Day Free Trial Evaluation
    let validUntilIso: string | null = null;
    let validUntilMs = 0;

    if (entitlement?.valid_until) {
      validUntilIso = entitlement.valid_until;
      validUntilMs = new Date(validUntilIso).getTime();
    } else {
      // Fallback: 3 days (72h) from user account creation date
      const createdAt = profile?.created_at || currentUser.created_at;
      if (createdAt) {
        const createdMs = new Date(createdAt).getTime();
        validUntilMs = createdMs + 3 * 24 * 60 * 60 * 1000;
        validUntilIso = new Date(validUntilMs).toISOString();
      }
    }

    const isTrialActive = validUntilMs > nowMs;
    const isTrialExpired = !isTrialActive;
    const remainingMs = Math.max(0, validUntilMs - nowMs);
    const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
    const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));

    let remainingTimeDisplay = 'Trial Expired';
    if (isTrialActive) {
      if (remainingHours > 24) {
        remainingTimeDisplay = `${remainingDays}d ${remainingHours % 24}h trial left`;
      } else if (remainingHours > 1) {
        remainingTimeDisplay = `${remainingHours} hours trial left`;
      } else {
        remainingTimeDisplay = `${remainingMinutes} mins trial left`;
      }
    }

    return {
      status: isTrialActive ? 'trial_active' : 'trial_expired',
      isVisitor: false,
      isTrialActive,
      isTrialExpired,
      isPaidVip: false,
      isAdmin: false,
      validUntil: validUntilIso,
      remainingMs,
      remainingHours,
      remainingDays,
      remainingTimeDisplay,
      // Main football predictions & settlements are unlocked during 3-day trial!
      canViewFootballPredictions: isTrialActive,
      canViewFootballSettlements: isTrialActive,
      // Specialist predictions, tennis, and basketball remain VIP only!
      canViewSpecialistMarkets: false,
      canViewTennis: false,
      canViewBasketball: false,
    };
  }, [currentUser, profile, subscription, entitlement, nowMs]);
}
