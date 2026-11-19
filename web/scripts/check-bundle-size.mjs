// Post-build: size budget for what a phone downloads before the first page can run.
//
// It reads dist/app-shell.html, finds the entry script, the chunks it preloads and the main
// stylesheet, and compares their gzip sizes (roughly what travels over mobile data) with the
// budgets below. Over budget = the build fails, so a deploy can't quietly make the site slower.
// Lazy pages (Banter, Virtual Life, Tennis, Basketball, Goals, Admin, ...) are not counted.
//
// Need a one-off exception? Set BUNDLE_BUDGET_WARN_ONLY=1 to print the warning without failing.
// Raising a budget should be a deliberate choice: change the number here in the same PR.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KB = 1024;
const BUDGETS = {
  entryJs: 95 * KB,      // the app's own main chunk (was 151 KB gzip before hubs were lazy-loaded)
  initialJs: 215 * KB,   // entry + React + Supabase + any other chunk loaded up front
  mainCss: 65 * KB,      // main stylesheet
};

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const shellPath = existsSync(join(dist, 'app-shell.html')) ? join(dist, 'app-shell.html') : join(dist, 'index.html');
if (!existsSync(shellPath)) {
  console.error('[bundle-budget] dist/app-shell.html not found. Run vite build first.');
  process.exit(1);
}
const html = readFileSync(shellPath, 'utf8');

const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]+)"`)) || [])[1];
const tags = html.match(/<(script|link)\b[^>]*>/g) || [];
const entry = [];
const preloads = [];
const css = [];
for (const t of tags) {
  const src = attr(t, 'src') || attr(t, 'href');
  if (!src || !src.startsWith('/assets/')) continue;
  if (t.startsWith('<script') && /type="module"/.test(t)) entry.push(src);
  else if (/rel="modulepreload"/.test(t)) preloads.push(src);
  else if (/rel="stylesheet"/.test(t)) css.push(src);
}

const gz = (p) => gzipSync(readFileSync(join(dist, p)), { level: 9 }).length;
const sum = (list) => list.reduce((n, p) => n + gz(p), 0);
const fmt = (n) => `${(n / KB).toFixed(1)} KB`;

const results = [
  { name: 'Main app chunk (gzip)', size: sum(entry), budget: BUDGETS.entryJs, files: entry },
  { name: 'All JavaScript loaded up front (gzip)', size: sum([...entry, ...preloads]), budget: BUDGETS.initialJs, files: [...entry, ...preloads] },
  { name: 'Main stylesheet (gzip)', size: sum(css), budget: BUDGETS.mainCss, files: css },
];

let over = false;
console.log('[bundle-budget] First-load size on phones:');
for (const r of results) {
  const ok = r.size <= r.budget;
  if (!ok) over = true;
  console.log(`  ${ok ? 'OK  ' : 'OVER'} ${r.name}: ${fmt(r.size)} of ${fmt(r.budget)} budget  (${r.files.map((f) => f.replace('/assets/', '')).join(', ')})`);
}
if (over) {
  const msg = '[bundle-budget] Over the phone size budget. Lazy-load the new heavy page/component (see lazyWithReload in src/lib/lazyReload.ts) or raise the budget in scripts/check-bundle-size.mjs on purpose.';
  if (process.env.BUNDLE_BUDGET_WARN_ONLY === '1') {
    console.warn(msg + ' (warning only: BUNDLE_BUDGET_WARN_ONLY=1)');
  } else {
    console.error(msg);
    process.exit(1);
  }
}
