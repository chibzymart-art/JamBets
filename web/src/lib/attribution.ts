/**
 * Oddsbanta First-Party Affiliate & Referral Attribution Engine
 * Preserves 30-day tracking attribution for sportsbooks (SportyBet, Bet9ja, 1xBet)
 * and direct sponsors (e.g., MyBrainPadi).
 */

export interface AttributionRecord {
  partner: string;
  campaign?: string;
  subId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  landingPage: string;
  firstTouchAt: string;
  expiresAt: number; // 30-day epoch
}

const STORAGE_KEY = 'oddsbanta_affiliate_attr_v1';
const ATTRIBUTION_DAYS = 30;
export const initAttributionTracker = captureIncomingAttribution;

export function captureIncomingAttribution(): void {
  if (typeof window === 'undefined') return;

  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref') || params.get('aff') || params.get('partner');
    const campaign = params.get('campaign') || params.get('c');
    const subId = params.get('subid') || params.get('sub_id');
    const utmSource = params.get('utm_source');
    const utmMedium = params.get('utm_medium');
    const utmCampaign = params.get('utm_campaign');

    if (ref || utmSource) {
      const record: AttributionRecord = {
        partner: ref || utmSource || 'direct',
        campaign: campaign || utmCampaign || undefined,
        subId: subId || undefined,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        landingPage: window.location.pathname,
        firstTouchAt: new Date().toISOString(),
        expiresAt: Date.now() + ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    }
  } catch (err) {
    console.warn('[Attribution] Failed to capture referral parameters:', err);
  }
}

export function getActiveAttribution(): AttributionRecord | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const record: AttributionRecord = JSON.parse(raw);
    if (Date.now() > record.expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function buildOutboundAffiliateUrl(baseUrl: string, defaultCampaign: string = 'goals_feed'): string {
  try {
    const url = new URL(baseUrl);
    const attr = getActiveAttribution();

    url.searchParams.set('utm_source', 'oddsbanta');
    url.searchParams.set('utm_medium', 'prediction_hub');
    url.searchParams.set('utm_campaign', attr?.campaign || defaultCampaign);

    if (attr?.partner) {
      url.searchParams.set('ref', attr.partner);
    }
    if (attr?.subId) {
      url.searchParams.set('sub_id', attr.subId);
    }

    return url.toString();
  } catch {
    return baseUrl;
  }
}
