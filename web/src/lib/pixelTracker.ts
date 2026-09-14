/**
 * Oddsbanta Ad Retargeting Pixel & Event Dispatcher
 * Dispatches sports search and prediction interactions to Meta Pixel (fbq),
 * Google Tag Manager (gtag), and custom event listeners.
 */

declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export function trackSportsSearchEvent(searchQuery: string, resultsCount: number): void {
  if (typeof window === 'undefined') return;

  const eventData = {
    search_string: searchQuery,
    content_category: 'Sports Prediction Search',
    results_found: resultsCount,
    timestamp: new Date().toISOString(),
  };

  // Google Analytics / Google Ads
  if (window.gtag) {
    window.gtag('event', 'search', {
      search_term: searchQuery,
      event_category: 'Sports',
    });
  }

  // Meta Pixel (Facebook & Instagram retargeting)
  if (window.fbq) {
    window.fbq('trackCustom', 'SearchSportsFixture', eventData);
  }

  // GTM DataLayer
  if (window.dataLayer) {
    window.dataLayer.push({
      event: 'sports_search',
      ...eventData,
    });
  }
}

export function trackAccaAddEvent(teamA: string, teamB: string, market: string, prob: number): void {
  if (typeof window === 'undefined') return;

  const eventData = {
    content_name: `${teamA} vs ${teamB}`,
    content_category: market,
    value: prob,
    currency: 'USD',
  };

  if (window.gtag) {
    window.gtag('event', 'add_to_wishlist', eventData);
  }

  if (window.fbq) {
    window.fbq('track', 'AddToWishlist', eventData);
  }
}
