/**
 * Server-rendered HTML for public routes (no JS needed to read the page).
 *
 * The SPA shell (dist/app-shell.html) is fetched once per edge instance; this module injects
 * per-route <title>, description, canonical, Open Graph / Twitter tags and real body content
 * (headings, settled track record, upcoming fixture names, disclaimer, internal links) into
 * <div id="root">. React's createRoot replaces that markup on boot.
 *
 * Paid content is never rendered here: only settled aggregates and public fixture names.
 */
import type { TrackRecord, ProductStats, UpcomingFixture, ProductKey } from './trackRecord';

export const SITE_ORIGIN = 'https://www.oddsbanta.com';

export const PICK_DISCLAIMER =
  'Model estimate, not a guarantee. Oddsbanta does not place bets on anyone’s behalf. 18+.';

export type SsrRoute =
  | '/'
  | '/dashboard'
  | '/dashboard/goals'
  | '/dashboard/tennis'
  | '/dashboard/basketball'
  | '/track-record'
  | '/dashboard/american-football'
  | '/dashboard/cricket'
  | '/subscription';

export const SSR_ROUTES: SsrRoute[] = [
  '/',
  '/dashboard',
  '/dashboard/goals',
  '/dashboard/tennis',
  '/dashboard/basketball',
  '/track-record',
  '/dashboard/american-football',
  '/dashboard/cricket',
  '/subscription',
];

export function normalizeRoute(raw: string | null | undefined): SsrRoute {
  const p = (raw || '/').split('?')[0].replace(/\/+$/, '') || '/';
  return (SSR_ROUTES as string[]).includes(p) ? (p as SsrRoute) : '/';
}

interface RouteMeta {
  title: string;
  description: string;
  h1: string;
  intro: string;
  product?: ProductKey;
  comingSoon?: boolean;
  needsUpcoming?: boolean;
}

const META: Record<SsrRoute, RouteMeta> = {
  '/': {
    title: 'Oddsbanta: Football, Tennis & Basketball Predictions with a 0–10 Confidence Score',
    description:
      'Sports predictions rated on a 0–10 confidence score. Every pick is published before kickoff and settled on a public track record that shows wins and losses.',
    h1: 'Sports predictions rated on a 0–10 confidence score',
    intro:
      'Oddsbanta publishes football, tennis and basketball picks before kickoff, scores each one from 0 to 10, and settles every result on a public track record, wins and losses alike.',
  },
  '/dashboard': {
    title: 'Football Predictions Today | Oddsbanta Dashboard',
    description:
      'Today’s football predictions with a 0–10 confidence score per pick, published before kickoff. See the settled hit rate for every score tier on the track record.',
    h1: 'Football predictions today',
    intro:
      'Main match picks for today’s fixtures, each rated on the 0–10 confidence score. Free picks are open to everyone; premium picks unlock with a plan.',
    product: 'football',
    needsUpcoming: true,
  },
  '/dashboard/goals': {
    title: 'Over 2.5 Goals & First-Half Goals Predictions | Oddsbanta',
    description:
      'Football goals predictions for Over 2.5 goals and first-half goals, rated on a 0–10 confidence score and settled publicly after every match.',
    h1: 'Football goals predictions: Over 2.5 and first-half goals',
    intro:
      'Goal-market picks built from expected-goals models. Live markets: Over 2.5 goals, first-half goals and corners. Home win, away win and draw markets are coming soon.',
    product: 'goals',
    needsUpcoming: true,
  },
  '/dashboard/tennis': {
    title: 'Tennis Predictions Today: ATP & WTA | Oddsbanta',
    description:
      'ATP and WTA tennis match predictions rated on a 0–10 confidence score, published before the first serve and settled on a public track record.',
    h1: 'Tennis predictions: ATP and WTA',
    intro:
      'Match-winner picks for ATP and WTA events, each with a 0–10 confidence score. Secondary markets are shown inside the dashboard.',
    product: 'tennis',
  },
  '/dashboard/basketball': {
    title: 'Basketball Predictions Today | Oddsbanta',
    description:
      'Basketball predictions rated on a 0–10 confidence score, published before tip-off and settled on a public track record.',
    h1: 'Basketball predictions',
    intro: 'Basketball picks across the leagues we cover, each rated on the 0–10 confidence score.',
    product: 'basketball',
  },
  '/track-record': {
    title: 'Track Record: Settled Results by Confidence Score | Oddsbanta',
    description:
      'Every settled Oddsbanta pick, wins and losses, grouped by 0–10 confidence score tier with sample sizes. Live results only, not a backtest.',
    h1: 'Track record',
    intro:
      'Settled results for every published pick, grouped by confidence score tier. These are live forward results, not a backtest. Void matches and no-pick matches are excluded from hit rates.',
  },
  '/dashboard/american-football': {
    title: 'American Football Predictions: Coming Soon | Oddsbanta',
    description: 'American football predictions with a 0–10 confidence score are coming soon to Oddsbanta.',
    h1: 'American football predictions: coming soon',
    intro: 'American football is not live yet. Football, tennis and basketball picks are available in the dashboard now.',
    comingSoon: true,
  },
  '/dashboard/cricket': {
    title: 'Cricket Predictions: Coming Soon | Oddsbanta',
    description: 'Cricket predictions with a 0–10 confidence score are coming soon to Oddsbanta.',
    h1: 'Cricket predictions: coming soon',
    intro: 'Cricket is not live yet. Football, tennis and basketball picks are available in the dashboard now.',
    comingSoon: true,
  },
  '/subscription': {
    title: 'Plans & Pricing | Oddsbanta',
    description:
      'Oddsbanta plans unlock every pick and its 0–10 confidence score across football, tennis and basketball. Check the public track record before you subscribe.',
    h1: 'Plans and pricing',
    intro:
      'A plan unlocks every pick and its exact confidence score across football, tennis and basketball. Check the public track record before you subscribe.',
  },
};

export function routeNeedsUpcoming(route: SsrRoute): boolean {
  return !!META[route].needsUpcoming;
}

// ── Sitemap ─────────────────────────────────────────────────────────────────────
/**
 * Public routes deliberately left out of sitemap.xml. They stay crawlable (robots.txt allows
 * them and they are linked internally); they are just not advertised in the sitemap.
 */
export const SITEMAP_EXCLUDE: SsrRoute[] = ['/track-record'];

/** Routes listed in sitemap.xml: every SSR route except exclusions and coming-soon pages. */
export function sitemapRoutes(): SsrRoute[] {
  return SSR_ROUTES.filter((r) => !META[r].comingSoon && !SITEMAP_EXCLUDE.includes(r));
}

/**
 * lastmod reflects real content changes: a sport hub's latest settled result, and the most
 * recent of those for the home page. Routes without a data-backed date omit lastmod.
 */
export function renderSitemap(tr: TrackRecord | null): string {
  const latest = (dates: (string | null | undefined)[]): string | null => {
    const valid = dates.filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)));
    if (!valid.length) return null;
    return new Date(Math.max(...valid.map((d) => Date.parse(d)))).toISOString();
  };

  const urls = sitemapRoutes().map((route) => {
    const m = META[route];
    let lastmod: string | null = null;
    if (tr) {
      if (route === '/') lastmod = latest(tr.products.map((p) => p.until));
      else if (m.product) lastmod = latest([tr.products.find((p) => p.product === m.product)?.until]);
    }
    const loc = `${SITE_ORIGIN}${route === '/' ? '/' : route}`;
    return `  <url>\n    <loc>${esc(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ── HTML helpers ────────────────────────────────────────────────────────────────
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtKickoff(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${d
    .toISOString()
    .slice(11, 16)} UTC`;
}

function pct(v: number | null): string {
  return v === null ? '–' : `${v.toFixed(1)}%`;
}

function productTable(p: ProductStats): string {
  const rows = p.tiers
    .map(
      (t) =>
        `<tr><td>${esc(t.range)} <small>${esc(t.name)}</small></td><td>${t.won}</td><td>${t.lost}</td><td>${t.settled}</td><td>${
          t.settled > 0 ? pct(t.hitRate) : 'No settled picks yet'
        }</td></tr>`
    )
    .join('');
  const range = p.since ? `Live results ${esc(fmtDate(p.since))} to ${esc(fmtDate(p.until))}.` : 'No settled picks yet.';
  return `<section aria-labelledby="tr-${p.product}">
<h3 id="tr-${p.product}">${esc(p.label)}: ${esc(p.market)}</h3>
<p>${p.settled > 0 ? `${p.won} won, ${p.lost} lost (${pct(p.hitRate)} hit rate, ${p.settled} settled picks). ` : ''}${range}</p>
<table><thead><tr><th scope="col">Score tier</th><th scope="col">Won</th><th scope="col">Lost</th><th scope="col">Sample</th><th scope="col">Hit rate</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function summaryList(tr: TrackRecord): string {
  const items = tr.products
    .filter((p) => p.settled > 0)
    .map(
      (p) =>
        `<li><strong>${esc(p.label)}</strong>: ${p.won} won, ${p.lost} lost (${pct(p.hitRate)} over ${p.settled} settled picks since ${esc(
          fmtDate(p.since)
        )})</li>`
    )
    .join('');
  return items ? `<ul>${items}</ul>` : '<p>Results will appear here once the first picks settle.</p>';
}

function scoreExplainer(): string {
  return `<section aria-labelledby="score-h">
<h2 id="score-h">How the 0–10 confidence score works</h2>
<p>Each pick gets a score from 0 to 10 based on the model’s estimated probability. The score is the model’s own estimate, not a promise; the real settled hit rate for each tier is published on the <a href="/track-record">track record</a>.</p>
<ul><li><strong>9 and above</strong>: Very High</li><li><strong>8 to 8.9</strong>: High</li><li><strong>6 to 7.9</strong>: Moderate</li><li><strong>Below 6</strong>: Low</li></ul>
</section>`;
}

function sportsList(): string {
  return `<section aria-labelledby="sports-h">
<h2 id="sports-h">Sports</h2>
<ul>
<li><a href="/dashboard">Football</a>: live</li>
<li><a href="/dashboard/goals">Football goals (Over 2.5, first-half goals, corners)</a>: live</li>
<li><a href="/dashboard/tennis">Tennis</a>: live</li>
<li><a href="/dashboard/basketball">Basketball</a>: live</li>
<li><a href="/dashboard/american-football">American football</a>: coming soon</li>
<li><a href="/dashboard/cricket">Cricket</a>: coming soon</li>
</ul></section>`;
}

function upcomingList(fixtures: UpcomingFixture[]): string {
  if (!fixtures.length) return '';
  const items = fixtures
    .slice(0, 20)
    .map(
      (f) =>
        `<li>${esc(f.home)} vs ${esc(f.away)}${f.league ? ` <small>(${esc(f.league)})</small>` : ''}, ${esc(fmtKickoff(f.kickoff))}</li>`
    )
    .join('');
  return `<section aria-labelledby="up-h"><h2 id="up-h">Upcoming fixtures in the model queue</h2>
<p>Picks and scores for these matches are shown in the dashboard once published.</p><ul>${items}</ul></section>`;
}

function recentList(tr: TrackRecord): string {
  if (!tr.recent.length) return '';
  const items = tr.recent
    .map(
      (r) =>
        `<li>${r.result === 'won' ? 'Won' : 'Lost'}: ${esc(r.home)} vs ${esc(r.away)}, ${esc(r.prediction)}${
          r.score !== null ? ` (score ${r.score.toFixed(1)})` : ''
        }${r.finalScore ? `, final ${esc(r.finalScore)}` : ''}</li>`
    )
    .join('');
  return `<section aria-labelledby="recent-h"><h2 id="recent-h">Latest settled football picks</h2><ul>${items}</ul></section>`;
}

function nav(): string {
  return `<nav aria-label="Main"><a href="/">Oddsbanta</a> · <a href="/dashboard">Dashboard</a> · <a href="/track-record">Track record</a> · <a href="/subscription">Pricing</a></nav>`;
}

function footer(): string {
  return `<footer><p><small>${esc(PICK_DISCLAIMER)} Please gamble responsibly.</small></p></footer>`;
}

export function renderBody(route: SsrRoute, tr: TrackRecord | null, upcoming: UpcomingFixture[]): string {
  const m = META[route];
  const parts: string[] = [nav(), `<main><h1>${esc(m.h1)}</h1><p>${esc(m.intro)}</p>`];

  if (m.comingSoon) {
    parts.push(sportsList());
  } else if (route === '/') {
    parts.push(sportsList(), scoreExplainer());
    parts.push(
      `<section aria-labelledby="tr-h"><h2 id="tr-h">Track record so far</h2>${
        tr ? summaryList(tr) : '<p>Track record is loading.</p>'
      }<p><a href="/track-record">See every score tier, wins and losses</a> · <a href="/dashboard">Open the dashboard</a></p></section>`
    );
  } else if (route === '/track-record') {
    if (tr) {
      parts.push(`<p>${esc(tr.note)}</p>`);
      parts.push(`<section aria-labelledby="tiers-h"><h2 id="tiers-h">Results by confidence score tier</h2>${tr.products.map(productTable).join('')}</section>`);
      parts.push(recentList(tr));
    } else {
      parts.push('<p>Track record data is temporarily unavailable. Please refresh shortly.</p>');
    }
    parts.push(scoreExplainer());
  } else if (route === '/subscription') {
    parts.push(scoreExplainer());
    if (tr) parts.push(`<section aria-labelledby="tr-h"><h2 id="tr-h">Track record before you buy</h2>${summaryList(tr)}<p><a href="/track-record">Full track record</a></p></section>`);
  } else {
    if (m.product && tr) {
      const p = tr.products.find((x) => x.product === m.product);
      if (p) parts.push(`<section aria-labelledby="tiers-h"><h2 id="tiers-h">Settled results by score tier</h2>${productTable(p)}<p><a href="/track-record">Full track record</a></p></section>`);
    }
    if (m.needsUpcoming) parts.push(upcomingList(upcoming));
    parts.push(sportsList());
  }

  parts.push(`<p><small>${esc(PICK_DISCLAIMER)}</small></p></main>`, footer());
  return `<div id="ssr-content" class="ssr-content">${parts.join('\n')}</div>`;
}

// ── Shell injection ─────────────────────────────────────────────────────────────
function setTag(html: string, re: RegExp, replacement: string): string {
  return re.test(html) ? html.replace(re, replacement) : html;
}

export function renderPage(shell: string, route: SsrRoute, tr: TrackRecord | null, upcoming: UpcomingFixture[]): string {
  const m = META[route];
  const url = `${SITE_ORIGIN}${route === '/' ? '/' : route}`;
  const title = esc(m.title);
  const desc = esc(m.description);
  let html = shell;

  html = setTag(html, /<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  html = setTag(html, /<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${desc}" />`);
  html = setTag(html, /<link\s+rel="canonical"[^>]*>/i, `<link rel="canonical" href="${url}" id="canonical-link" />`);
  html = setTag(html, /<meta\s+property="og:title"[^>]*>/i, `<meta property="og:title" content="${title}" id="og-title-tag" />`);
  html = setTag(html, /<meta\s+property="og:description"[^>]*>/i, `<meta property="og:description" content="${desc}" id="og-desc-tag" />`);
  html = setTag(html, /<meta\s+property="og:url"[^>]*>/i, `<meta property="og:url" content="${url}" id="og-url-tag" />`);
  html = setTag(html, /<meta\s+name="twitter:title"[^>]*>/i, `<meta name="twitter:title" content="${title}" id="tw-title-tag" />`);
  html = setTag(html, /<meta\s+name="twitter:description"[^>]*>/i, `<meta name="twitter:description" content="${desc}" id="tw-desc-tag" />`);

  const body = renderBody(route, tr, upcoming);
  html = setTag(html, /<div id="root">\s*<\/div>/i, `<div id="root">${body}</div>`);
  return html;
}

/** Used only if the SPA shell cannot be fetched: still a readable, linked page. */
export function fallbackShell(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Oddsbanta</title><meta name="description" content="" /><link rel="canonical" href="${SITE_ORIGIN}/" />
<link rel="icon" type="image/svg+xml" href="/oddsbanta-logo.svg" /></head><body><div id="root"></div></body></html>`;
}
