/**
 * Oddsbanta Dynamic SEO & Structured Data Manager
 * Handles real-time document title, OpenGraph, Twitter Cards, canonical links,
 * and Schema.org JSON-LD injection for rich sports snippets.
 */

export interface PageSeoConfig {
  title: string;
  description: string;
  canonicalPath?: string;
  ogType?: string;
  ogImage?: string;
  sportsEvents?: Array<{
    homeTeam: string;
    awayTeam: string;
    league: string;
    kickoff: string;
    predictionMarket?: string;
    probability?: number;
  }>;
}

export function updatePageSeo(config: PageSeoConfig): void {
  if (typeof document === 'undefined') return;

  // 1. Update Document Title
  document.title = config.title;

  // 2. Helper to set or create meta tag
  const setMeta = (selector: string, attrName: string, attrVal: string, content: string) => {
    let el = document.querySelector(selector) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attrName, attrVal);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  // 3. Primary Meta Tags
  setMeta('meta[name="description"]', 'name', 'description', config.description);

  // 4. Canonical URL
  const baseUrl = 'https://oddsbanta.com';
  const fullUrl = config.canonicalPath ? `${baseUrl}${config.canonicalPath}` : baseUrl;
  let canonicalEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!canonicalEl) {
    canonicalEl = document.createElement('link');
    canonicalEl.setAttribute('rel', 'canonical');
    document.head.appendChild(canonicalEl);
  }
  canonicalEl.setAttribute('href', fullUrl);

  // 5. OpenGraph Tags (WhatsApp, Telegram, Facebook)
  setMeta('meta[property="og:title"]', 'property', 'og:title', config.title);
  setMeta('meta[property="og:description"]', 'property', 'og:description', config.description);
  setMeta('meta[property="og:url"]', 'property', 'og:url', fullUrl);
  setMeta('meta[property="og:type"]', 'property', 'og:type', config.ogType || 'website');
  if (config.ogImage) {
    setMeta('meta[property="og:image"]', 'property', 'og:image', config.ogImage);
  }

  // 6. Twitter Cards
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', config.title);
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', config.description);

  // 7. Schema.org JSON-LD Dynamic Injection
  let schemaScript = document.getElementById('dynamic-sports-schema') as HTMLScriptElement | null;
  if (!schemaScript) {
    schemaScript = document.createElement('script');
    schemaScript.id = 'dynamic-sports-schema';
    schemaScript.type = 'application/ld+json';
    document.head.appendChild(schemaScript);
  }

  if (config.sportsEvents && config.sportsEvents.length > 0) {
    const eventsSchema = config.sportsEvents.slice(0, 10).map((ev) => ({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: `${ev.homeTeam} vs ${ev.awayTeam}`,
      description: `Oddsbanta AI Analysis: ${ev.predictionMarket || 'Goals Pick'} (${ev.probability ? `${ev.probability}% certainty` : 'High Edge'}).`,
      startDate: ev.kickoff,
      homeTeam: {
        '@type': 'SportsTeam',
        name: ev.homeTeam,
      },
      awayTeam: {
        '@type': 'SportsTeam',
        name: ev.awayTeam,
      },
      location: {
        '@type': 'Place',
        name: `${ev.league} Stadium`,
      },
    }));

    schemaScript.textContent = JSON.stringify(eventsSchema);
  }
}
