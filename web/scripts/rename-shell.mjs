// Post-build: rename dist/index.html → dist/app-shell.html.
// Vercel serves static files before rewrites, so a built index.html would shadow the
// server-rendered "/" route (api/ssr). The SSR function and the SPA fallback rewrite both
// read /app-shell.html instead.
import { existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const from = join(dist, 'index.html');
const to = join(dist, 'app-shell.html');

if (existsSync(from)) {
  renameSync(from, to);
  console.log('[postbuild] dist/index.html → dist/app-shell.html');
} else if (!existsSync(to)) {
  console.error('[postbuild] dist/index.html not found');
  process.exit(1);
}
