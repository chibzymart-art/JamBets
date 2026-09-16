// ============================================================================
// AD BANNER & SPONSOR MONETIZATION CONFIGURATION SERVICE (MULTI-BANNER ENGINE)
// Allows real-time creation, editing, location targeting, and deletion of ads
// ============================================================================

export type AdSlotType =
  | 'leaderboard'
  | 'native-card'
  | 'drawer-banner'
  | 'favorites-sidebar'
  | 'under-favorites'
  | 'left-sidebar'
  | 'bangers-sidebar'
  | 'under-bangers';

export type MultiBannerDisplayMode = 'rotate' | 'stack';

const STORAGE_KEY_MODE = 'oddsbanta_ad_display_mode';
const UPDATE_EVENT_MODE = 'oddsbanta_ad_display_mode_updated';

export interface AdBannerItem {
  id: string;
  brandTitle: string;
  brandSubtitle: string;
  brandTagline: string;
  brandCtaText: string;
  brandBadge: string;
  sponsorUrl: string;
  iconEmoji: string;

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

  // Display Locations / Placement Slots
  locations: AdSlotType[];

  // Active / Serving state
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Backward-compatibility alias
export type AdBannerConfig = AdBannerItem;

export const DEFAULT_AD_BANNERS: AdBannerItem[] = [
  {
    id: 'ad-mybrainpadi-primary',
    brandTitle: 'MyBrainPadi.com',
    brandSubtitle: 'AI Academic & Research Assistant',
    brandTagline: 'Writing a Project, Thesis, or Exam Prep? Let AI Structure Literature & Verified Citations.',
    brandCtaText: 'Try Free ➔',
    brandBadge: 'SPONSORED',
    sponsorUrl: 'https://mybrainpadi.com/?utm_source=oddsbanta&utm_medium=ad_banner&utm_campaign=student_sports_crossover',
    iconEmoji: '🎓',

    nativeHeading: 'Tired of Manual Referencing? Get Instant Verified Academic Citations.',
    nativeBody: 'From thesis proposals to assignment structuring, MyBrainPadi equips university students with verified, accurate citations and AI research structuring in seconds.',
    nativePerk1: '✓ Thesis Outlines',
    nativePerk2: '✓ Verified Sources',
    nativePerk3: '✓ Free Access',
    nativeCtaText: 'Launch Free AI Tool →',

    drawerHeadline: 'MyBrainPadi.com',
    drawerSub: 'Ace coursework while waiting for kickoff',
    drawerCta: 'Explore →',

    locations: ['leaderboard', 'native-card', 'drawer-banner', 'left-sidebar', 'under-favorites'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
];

// Single default banner for backward compatibility
export const DEFAULT_AD_CONFIG: AdBannerItem = DEFAULT_AD_BANNERS[0];

const STORAGE_KEY_V2 = 'oddsbanta_ad_banners_v2';
const STORAGE_KEY_V1 = 'oddsbanta_ad_banner_config_v1';
const UPDATE_EVENT_V2 = 'oddsbanta_ad_banners_updated';
const UPDATE_EVENT_V1 = 'oddsbanta_ad_config_updated';

/**
 * Retrieve all configured ad banners with automatic migration from v1
 */
export function getAdBanners(): AdBannerItem[] {
  if (typeof window === 'undefined') return DEFAULT_AD_BANNERS;
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }

    // Attempt migration from v1 single config if present
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      try {
        const v1 = JSON.parse(rawV1);
        const migratedLocations: AdSlotType[] = [];
        if (v1.isLeaderboardEnabled !== false) migratedLocations.push('leaderboard');
        if (v1.isNativeCardEnabled !== false) migratedLocations.push('native-card');
        if (v1.isDrawerBannerEnabled !== false) migratedLocations.push('drawer-banner');

        const migratedBanner: AdBannerItem = {
          id: 'ad-migrated-v1',
          brandTitle: v1.brandTitle || DEFAULT_AD_CONFIG.brandTitle,
          brandSubtitle: v1.brandSubtitle || DEFAULT_AD_CONFIG.brandSubtitle,
          brandTagline: v1.brandTagline || DEFAULT_AD_CONFIG.brandTagline,
          brandCtaText: v1.brandCtaText || DEFAULT_AD_CONFIG.brandCtaText,
          brandBadge: v1.brandBadge || DEFAULT_AD_CONFIG.brandBadge,
          sponsorUrl: v1.sponsorUrl || DEFAULT_AD_CONFIG.sponsorUrl,
          iconEmoji: '🎓',
          nativeHeading: v1.nativeHeading || DEFAULT_AD_CONFIG.nativeHeading,
          nativeBody: v1.nativeBody || DEFAULT_AD_CONFIG.nativeBody,
          nativePerk1: v1.nativePerk1 || DEFAULT_AD_CONFIG.nativePerk1,
          nativePerk2: v1.nativePerk2 || DEFAULT_AD_CONFIG.nativePerk2,
          nativePerk3: v1.nativePerk3 || DEFAULT_AD_CONFIG.nativePerk3,
          nativeCtaText: v1.nativeCtaText || DEFAULT_AD_CONFIG.nativeCtaText,
          drawerHeadline: v1.drawerHeadline || DEFAULT_AD_CONFIG.drawerHeadline,
          drawerSub: v1.drawerSub || DEFAULT_AD_CONFIG.drawerSub,
          drawerCta: v1.drawerCta || DEFAULT_AD_CONFIG.drawerCta,
          locations: migratedLocations.length > 0 ? migratedLocations : ['leaderboard', 'native-card', 'drawer-banner'],
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        saveAdBanners([migratedBanner]);
        return [migratedBanner];
      } catch (e) {
        console.warn('Could not parse legacy v1 ad banner:', e);
      }
    }

    return DEFAULT_AD_BANNERS;
  } catch (err) {
    console.error('Error reading ad banners from localStorage:', err);
    return DEFAULT_AD_BANNERS;
  }
}

/**
 * Save array of ad banners to localStorage and dispatch events
 */
export function saveAdBanners(banners: AdBannerItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(banners));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT_V2, { detail: banners }));

    // Also sync primary active banner to v1 for backward-compatibility
    const primary = banners.find(b => b.isActive) || banners[0] || DEFAULT_AD_CONFIG;
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT_V1, { detail: primary }));
  } catch (err) {
    console.error('Error saving ad banners:', err);
  }
}

/**
 * Add a new ad banner
 */
export function addAdBanner(banner: Omit<AdBannerItem, 'id' | 'createdAt' | 'updatedAt'>): AdBannerItem {
  const current = getAdBanners();
  const newBanner: AdBannerItem = {
    ...banner,
    id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const updated = [newBanner, ...current];
  saveAdBanners(updated);
  return newBanner;
}

/**
 * Update an existing ad banner by ID
 */
export function updateAdBanner(id: string, updates: Partial<AdBannerItem>): AdBannerItem | null {
  const current = getAdBanners();
  const index = current.findIndex(b => b.id === id);
  if (index === -1) return null;

  const updatedBanner: AdBannerItem = {
    ...current[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  current[index] = updatedBanner;
  saveAdBanners([...current]);
  return updatedBanner;
}

/**
 * Delete an ad banner by ID
 */
export function deleteAdBanner(id: string): boolean {
  const current = getAdBanners();
  const filtered = current.filter(b => b.id !== id);
  if (filtered.length === current.length) return false;

  // If no banners left, restore factory default banner in paused state or default
  if (filtered.length === 0) {
    saveAdBanners(DEFAULT_AD_BANNERS);
  } else {
    saveAdBanners(filtered);
  }
  return true;
}

/**
 * Toggle an ad banner's active status
 */
export function toggleBannerStatus(id: string): boolean {
  const current = getAdBanners();
  const banner = current.find(b => b.id === id);
  if (!banner) return false;
  banner.isActive = !banner.isActive;
  banner.updatedAt = new Date().toISOString();
  saveAdBanners([...current]);
  return banner.isActive;
}

/**
 * Toggle a location placement for an ad banner
 */
export function toggleBannerLocation(id: string, location: AdSlotType): AdSlotType[] {
  const current = getAdBanners();
  const banner = current.find(b => b.id === id);
  if (!banner) return [];

  if (banner.locations.includes(location)) {
    banner.locations = banner.locations.filter(l => l !== location);
  } else {
    banner.locations.push(location);
  }
  banner.updatedAt = new Date().toISOString();
  saveAdBanners([...current]);
  return banner.locations;
}

/**
 * Reset all ad banners to default initial partner
 */
export function resetAdBanners(): AdBannerItem[] {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY_V2);
      localStorage.removeItem(STORAGE_KEY_V1);
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT_V2, { detail: DEFAULT_AD_BANNERS }));
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT_V1, { detail: DEFAULT_AD_CONFIG }));
    } catch (err) {
      console.error('Error resetting ad banners:', err);
    }
  }
  return DEFAULT_AD_BANNERS;
}

/**
 * Get active banners targeted for a specific slot
 */
export function getActiveBannersForSlot(slot: AdSlotType): AdBannerItem[] {
  const all = getAdBanners();
  return all.filter(b => b.isActive && b.locations.includes(slot));
}

/**
 * Subscribe to all banner changes
 */
export function subscribeToAdBanners(callback: (banners: AdBannerItem[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<AdBannerItem[]>;
    callback(custom.detail || getAdBanners());
  };
  window.addEventListener(UPDATE_EVENT_V2, handler);
  return () => window.removeEventListener(UPDATE_EVENT_V2, handler);
}

// ----------------------------------------------------------------------------
// Backward-Compatibility Helpers
// ----------------------------------------------------------------------------

export function getAdConfig(): AdBannerItem {
  const banners = getAdBanners();
  return banners.find(b => b.isActive) || banners[0] || DEFAULT_AD_CONFIG;
}

export function saveAdConfig(config: Partial<AdBannerItem>): void {
  const banners = getAdBanners();
  if (banners.length > 0) {
    updateAdBanner(banners[0].id, config);
  } else {
    addAdBanner({
      ...DEFAULT_AD_CONFIG,
      ...config
    });
  }
}

export function resetAdConfig(): AdBannerItem {
  resetAdBanners();
  return DEFAULT_AD_CONFIG;
}

export function subscribeToAdConfig(callback: (config: AdBannerItem) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<AdBannerItem | AdBannerItem[]>;
    if (Array.isArray(custom.detail)) {
      const active = custom.detail.find(b => b.isActive) || custom.detail[0] || DEFAULT_AD_CONFIG;
      callback(active);
    } else {
      callback(custom.detail || getAdConfig());
    }
  };
  window.addEventListener(UPDATE_EVENT_V2, handler);
  window.addEventListener(UPDATE_EVENT_V1, handler);
  return () => {
    window.removeEventListener(UPDATE_EVENT_V2, handler);
    window.removeEventListener(UPDATE_EVENT_V1, handler);
  };
}

// ----------------------------------------------------------------------------
// Multi-Banner Display Mode Helpers (Rotate Carousel vs. Stacked Vertical)
// ----------------------------------------------------------------------------

export function getMultiBannerDisplayMode(): MultiBannerDisplayMode {
  if (typeof window === 'undefined') return 'rotate';
  try {
    const mode = localStorage.getItem(STORAGE_KEY_MODE);
    if (mode === 'stack' || mode === 'rotate') return mode;
    return 'rotate';
  } catch {
    return 'rotate';
  }
}

export function setMultiBannerDisplayMode(mode: MultiBannerDisplayMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_MODE, mode);
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT_MODE, { detail: mode }));
  } catch (e) {
    console.error('Error saving multi-banner display mode:', e);
  }
}

export function subscribeToDisplayMode(callback: (mode: MultiBannerDisplayMode) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent<MultiBannerDisplayMode>;
    callback(custom.detail || getMultiBannerDisplayMode());
  };
  window.addEventListener(UPDATE_EVENT_MODE, handler);
  return () => window.removeEventListener(UPDATE_EVENT_MODE, handler);
}

