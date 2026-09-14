// ============================================================================
// AD BANNER & SPONSOR MONETIZATION CONFIGURATION SERVICE
// Allows real-time editing of ad banners from the Sigma Admin Command Deck
// ============================================================================

export interface AdBannerConfig {
  sponsorUrl: string;
  brandTitle: string;
  brandSubtitle: string;
  brandTagline: string;
  brandCtaText: string;
  brandBadge: string;

  // In-Feed Native Card Content
  nativeHeading: string;
  nativeBody: string;
  nativePerk1: string;
  nativePerk2: string;
  nativePerk3: string;
  nativeCtaText: string;

  // Acca Drawer Banner Content
  drawerHeadline: string;
  drawerSub: string;
  drawerCta: string;

  // Active Slot Toggles
  isLeaderboardEnabled: boolean;
  isNativeCardEnabled: boolean;
  isDrawerBannerEnabled: boolean;
}

export const DEFAULT_AD_CONFIG: AdBannerConfig = {
  sponsorUrl: 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner&utm_campaign=student_sports_crossover',
  brandTitle: 'MyBrainPadi.com',
  brandSubtitle: 'AI Academic & Research Assistant',
  brandTagline: 'Writing a Project, Thesis, or Exam Prep? Let AI Structure Literature & Verified Citations.',
  brandCtaText: 'Try Free ➔',
  brandBadge: 'SPONSORED',

  nativeHeading: 'Tired of Manual Referencing? Get Instant Verified Academic Citations.',
  nativeBody: 'From thesis proposals to assignment structuring, MyBrainPadi equips university students with verified, accurate citations and AI research structuring in seconds.',
  nativePerk1: '✓ Thesis Outlines',
  nativePerk2: '✓ Verified Sources',
  nativePerk3: '✓ Free Access',
  nativeCtaText: 'Launch Free AI Tool →',

  drawerHeadline: 'MyBrainPadi.com',
  drawerSub: 'Ace coursework while waiting for kickoff',
  drawerCta: 'Explore →',

  isLeaderboardEnabled: true,
  isNativeCardEnabled: true,
  isDrawerBannerEnabled: true,
};

const STORAGE_KEY = 'oddsbanta_ad_banner_config_v1';
const UPDATE_EVENT = 'oddsbanta_ad_config_updated';

export function getAdConfig(): AdBannerConfig {
  if (typeof window === 'undefined') return DEFAULT_AD_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AD_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AD_CONFIG, ...parsed };
  } catch (err) {
    console.error('Error reading ad banner config from localStorage:', err);
    return DEFAULT_AD_CONFIG;
  }
}

export function saveAdConfig(config: AdBannerConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: config }));
  } catch (err) {
    console.error('Error saving ad banner config:', err);
  }
}

export function resetAdConfig(): AdBannerConfig {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: DEFAULT_AD_CONFIG }));
    } catch (err) {
      console.error('Error resetting ad banner config:', err);
    }
  }
  return DEFAULT_AD_CONFIG;
}

export function subscribeToAdConfig(callback: (config: AdBannerConfig) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<AdBannerConfig>;
    callback(custom.detail || getAdConfig());
  };
  window.addEventListener(UPDATE_EVENT, handler);
  return () => window.removeEventListener(UPDATE_EVENT, handler);
}
