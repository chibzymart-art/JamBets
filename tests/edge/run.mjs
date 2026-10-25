// Bundles the Edge tests with esbuild (from web/node_modules) and runs it in Node.
import { build } from '../../web/node_modules/esbuild/lib/main.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
for (const name of ['locked-feeds', 'email-endpoints', 'telegram-bot', 'history-day']) {
  const out = join(mkdtempSync(join(tmpdir(), 'edge-test-')), `${name}.mjs`);
  await build({ entryPoints: [join(here, `${name}.test.ts`)], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  execFileSync(process.execPath, [out], { stdio: 'inherit' });
}
