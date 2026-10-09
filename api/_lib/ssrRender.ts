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
  | '/about'
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
  '/about',
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
    title: 'Oddsbanta: AI Sports Analytics & Predictions with a 0–10 Confidence Score',
    description:
      'AI sports predictions and mathematical models rated on a 0–10 confidence score. Settled on a transparent public track record. Oddsbanta is an analytics tool, not a bookmaker.',
    h1: 'AI sports analytics and mathematical predictions with a 0–10 confidence score',
    intro:
      'Oddsbanta is an AI-powered sports analytics and predictive intelligence platform publishing football, tennis and basketball models before kickoff. Oddsbanta is an analytics tool, not a bookmaker.',
  },
  '/about': {
    title: 'About Oddsbanta | AI Sports Predictive Analytics & Quantitative Modeling',
    description:
      'About Oddsbanta, our AI sports analytics engine, Poisson probability models, and public settlement track record. Oddsbanta is an analytics platform, not a bookmaker.',
    h1: 'About Oddsbanta: AI Sports Analytics & Quantitative Modeling',
    intro:
      'Oddsbanta is an independent sports analytics and quantitative research platform. We build statistical models, expected goals algorithms, and calibrated 0–10 confidence scores.',
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

export const SSR_CRITICAL_CSS = `
#ssr-content.ssr-content {
  min-height: 100vh;
  background-color: #080c15;
  color: #f1f5f9;
  font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.ssr-header {
  background: rgba(11, 15, 25, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  position: sticky;
  top: 0;
  z-index: 100;
}
.ssr-nav-inner {
  max-width: 1240px;
  margin: 0 auto;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.ssr-brand-logo {
  display: flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  font-weight: 800;
  font-size: 1.25rem;
  color: #ffffff;
  letter-spacing: -0.02em;
}
.ssr-logo-badge {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #ffffff;
  padding: 2px 7px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 900;
}
.ssr-nav-links {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ssr-nav-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.2s ease;
}
.ssr-nav-pill:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.18);
}
.ssr-engine-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  font-weight: 500;
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 4px 12px;
  border-radius: 9999px;
}
.ssr-live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  display: inline-block;
  animation: ssrPulse 1.8s infinite;
}
@keyframes ssrPulse {
  0% { transform: scale(0.95); opacity: 0.7; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.7; }
}
.ssr-content main {
  max-width: 1240px;
  margin: 0 auto;
  padding: 32px 20px 60px;
}
.ssr-content h1 {
  font-size: 2rem;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -0.03em;
  margin: 0 0 10px;
  line-height: 1.25;
}
.ssr-content p {
  color: #94a3b8;
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 0 0 24px;
}
.ssr-content a {
  color: #38bdf8;
  text-decoration: none;
}
.ssr-content a:hover {
  text-decoration: underline;
}
.ssr-skeleton-section {
  margin: 24px 0 32px;
}
.ssr-skeleton-banner {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 14px 20px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ssr-pulse-bar {
  height: 12px;
  width: 100%;
  max-width: 320px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.06) 100%);
  background-size: 200% 100%;
  animation: ssrShimmer 1.8s infinite;
}
.ssr-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
.ssr-skeleton-card {
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.25);
}
.ssr-skel-line {
  height: 14px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.04) 100%);
  background-size: 200% 100%;
  animation: ssrShimmer 1.8s infinite;
}
.ssr-skel-line.w-40 { width: 40%; }
.ssr-skel-line.w-60 { width: 60%; }
.ssr-skel-line.w-80 { width: 80%; }
@keyframes ssrShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.ssr-content section {
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.25);
}
.ssr-content h2, .ssr-content h3 {
  color: #f8fafc;
  font-weight: 700;
  margin: 0 0 16px;
  letter-spacing: -0.01em;
}
.ssr-content h2 { font-size: 1.35rem; }
.ssr-content h3 { font-size: 1.1rem; color: #38bdf8; }
.ssr-content table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 16px 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
}
.ssr-content th {
  background: rgba(255, 255, 255, 0.04);
  color: #94a3b8;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  text-align: left;
}
.ssr-content td {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  font-size: 0.88rem;
}
.ssr-content tr:last-child td {
  border-bottom: none;
}
.ssr-content td small {
  color: #94a3b8;
  margin-left: 6px;
}
.ssr-content ul {
  list-style: none;
  padding: 0;
  margin: 16px 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.ssr-content ul li {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 12px 16px;
  border-radius: 10px;
  color: #cbd5e1;
  font-size: 0.88rem;
  line-height: 1.4;
}
.ssr-content footer {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  text-align: center;
  color: #64748b;
  font-size: 0.82rem;
}
.ssr-content footer p {
  color: #64748b;
  margin-bottom: 8px;
}
@media (max-width: 640px) {
  .ssr-content main { padding: 20px 14px 40px; }
  .ssr-content h1 { font-size: 1.5rem; }
  .ssr-skeleton-grid { grid-template-columns: 1fr; }
  .ssr-content ul { grid-template-columns: 1fr; }
}
`;

function nav(): string {
  return `<header class="ssr-header"><div class="ssr-nav-inner"><a href="/" class="ssr-brand-logo"><span class="ssr-logo-badge">ODDS</span>BANTA</a><nav aria-label="Main" class="ssr-nav-links"><a href="/" class="ssr-nav-pill">Home</a><a href="/dashboard" class="ssr-nav-pill">Dashboard</a><a href="/track-record" class="ssr-nav-pill">Track record</a><a href="/subscription" class="ssr-nav-pill">Pricing</a></nav><div class="ssr-engine-status"><span class="ssr-live-dot"></span><span>AI Predictive Engine</span></div></div></header>`;
}

function skeletonPreview(): string {
  return `<div class="ssr-skeleton-section" aria-hidden="true"><div class="ssr-skeleton-banner"><div class="ssr-pulse-bar"></div></div><div class="ssr-skeleton-grid"><div class="ssr-skeleton-card"><div class="ssr-skel-line w-40"></div><div class="ssr-skel-line w-80"></div><div class="ssr-skel-line w-60"></div></div><div class="ssr-skeleton-card"><div class="ssr-skel-line w-40"></div><div class="ssr-skel-line w-80"></div><div class="ssr-skel-line w-60"></div></div></div></div>`;
}

function footer(): string {
  return `<footer><p><small>${esc(PICK_DISCLAIMER)} Please gamble responsibly.</small></p></footer>`;
}

export function renderBody(route: SsrRoute, tr: TrackRecord | null, upcoming: UpcomingFixture[]): string {
  const m = META[route];
  const parts: string[] = [nav(), `<main><h1>${esc(m.h1)}</h1><p>${esc(m.intro)}</p>`, skeletonPreview()];

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
  if (!html.includes('id="ssr-critical-css"')) {
    html = setTag(html, /<\/head>/i, `<style id="ssr-critical-css">${SSR_CRITICAL_CSS}</style></head>`);
  }
  return html;
}

/** Used only if the SPA shell cannot be fetched: still a readable, linked page. */
export function fallbackShell(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Oddsbanta</title><meta name="description" content="" /><link rel="canonical" href="${SITE_ORIGIN}/" />
<link rel="icon" type="image/svg+xml" href="/oddsbanta-logo.svg" />
<style id="ssr-critical-css">${SSR_CRITICAL_CSS}</style>
</head><body><div id="root"></div></body></html>`;
}
