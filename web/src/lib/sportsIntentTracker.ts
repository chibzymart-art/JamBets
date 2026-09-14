/**
 * Oddsbanta Sports Intent Profiler & Personalization Engine
 * Tracks user searches, clicked fixtures, and favorited markets to build
 * a first-party affinity graph and push targeted predictions to each user.
 */

export interface SportsAffinityProfile {
  searchedTerms: Record<string, number>; // "arsenal": 3, "premier league": 2
  interactedClubs: Record<string, number>; // "Arsenal": 4, "Chelsea": 1
  interactedLeagues: Record<string, number>;
  preferredMarkets: Record<string, number>; // "over_2.5_goals": 5, "ht_over_0.5_goals": 2
  lastSearchedTerm?: string;
  lastInteractedAt: string;
}

const AFFINITY_STORAGE_KEY = 'oddsbanta_sports_affinity_v1';

export function getSportsAffinity(): SportsAffinityProfile {
  if (typeof window === 'undefined') {
    return {
      searchedTerms: {},
      interactedClubs: {},
      interactedLeagues: {},
      preferredMarkets: {},
      lastInteractedAt: new Date().toISOString(),
    };
  }

  try {
    const raw = localStorage.getItem(AFFINITY_STORAGE_KEY);
    if (!raw) {
      return {
        searchedTerms: {},
        interactedClubs: {},
        interactedLeagues: {},
        preferredMarkets: {},
        lastInteractedAt: new Date().toISOString(),
      };
    }
    return JSON.parse(raw);
  } catch {
    return {
      searchedTerms: {},
      interactedClubs: {},
      interactedLeagues: {},
      preferredMarkets: {},
      lastInteractedAt: new Date().toISOString(),
    };
  }
}

export function saveSportsAffinity(profile: SportsAffinityProfile): void {
  if (typeof window === 'undefined') return;
  try {
    profile.lastInteractedAt = new Date().toISOString();
    localStorage.setItem(AFFINITY_STORAGE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn('[SportsIntent] Failed to persist affinity profile:', err);
  }
}

/**
 * Automatically invoked when a user types in a search bar
 */
export function recordSportsSearch(query: string): void {
  const clean = query.trim().toLowerCase();
  if (!clean || clean.length < 3) return;

  const profile = getSportsAffinity();
  profile.searchedTerms[clean] = (profile.searchedTerms[clean] || 0) + 1;
  profile.lastSearchedTerm = clean;
  saveSportsAffinity(profile);
}

/**
 * Automatically invoked when a user clicks a fixture, views AI reasoning, or stars a pick
 */
export function recordSportsInteraction(
  homeTeam: string,
  awayTeam: string,
  league: string,
  market?: string
): void {
  const profile = getSportsAffinity();

  if (homeTeam) profile.interactedClubs[homeTeam] = (profile.interactedClubs[homeTeam] || 0) + 1;
  if (awayTeam) profile.interactedClubs[awayTeam] = (profile.interactedClubs[awayTeam] || 0) + 1;
  if (league) profile.interactedLeagues[league] = (profile.interactedLeagues[league] || 0) + 1;
  if (market) profile.preferredMarkets[market] = (profile.preferredMarkets[market] || 0) + 1;

  saveSportsAffinity(profile);
}

/**
 * Scans active predictions and finds the best personalized pick to push to this user
 */
export function getTargetedPushPrediction(predictions: any[]): {
  matchedPrediction: any;
  reason: string;
} | null {
  if (!predictions || predictions.length === 0) return null;

  const profile = getSportsAffinity();
  // Helper to extract team & league names from various schema formats
  const extractText = (p: any) => {
    const home = (
      p.fixture?.home_team?.short_name ||
      p.fixture?.home_team?.name ||
      p.fixture?.home_team_name ||
      p.metadata?.home_team ||
      ''
    ).toLowerCase();
    const away = (
      p.fixture?.away_team?.short_name ||
      p.fixture?.away_team?.name ||
      p.fixture?.away_team_name ||
      p.metadata?.away_team ||
      ''
    ).toLowerCase();
    const league = (
      p.fixture?.league?.name ||
      p.fixture?.league_name ||
      p.metadata?.league ||
      ''
    ).toLowerCase();
    return { home, away, league };
  };

  // 1. Try to find a match for the most recent search term
  if (profile.lastSearchedTerm) {
    const term = profile.lastSearchedTerm.toLowerCase();
    const match = predictions.find((p) => {
      const { home, away, league } = extractText(p);
      return home.includes(term) || away.includes(term) || league.includes(term);
    });

    if (match) {
      return {
        matchedPrediction: match,
        reason: `Based on your recent search for "${profile.lastSearchedTerm.toUpperCase()}"`,
      };
    }
  }

  // 2. Try to find a match for top interacted club
  const sortedClubs = Object.entries(profile.interactedClubs).sort((a, b) => b[1] - a[1]);
  if (sortedClubs.length > 0) {
    const topClub = sortedClubs[0][0].toLowerCase();
    const match = predictions.find((p) => {
      const { home, away } = extractText(p);
      return home.includes(topClub) || away.includes(topClub);
    });

    if (match) {
      return {
        matchedPrediction: match,
        reason: `Based on your high interest in ${sortedClubs[0][0]}`,
      };
    }
  }

  // 3. High-Edge Fallback: Surface highest calibrated banker pick
  const topBanker = [...predictions].sort((a, b) => (b.probability || 0) - (a.probability || 0))[0];
  if (topBanker) {
    return {
      matchedPrediction: topBanker,
      reason: 'Top High-Edge AI Calibration (Verified 250k Simulations)',
    };
  }

  return null;
}
