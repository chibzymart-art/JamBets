// Bundles the Banter Hub tests with esbuild (from web/node_modules) and runs them in Node.
// Usage (from the repo root): node tests/banter/run.mjs
import { build } from '../../web/node_modules/esbuild/lib/main.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
for (const name of ['banter-foundations']) {
  const dir = mkdtempSync(join(tmpdir(), 'banter-test-'));
  const out = join(dir, `${name}.mjs`);
  await build({ entryPoints: [join(here, `${name}.test.ts`)], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  execFileSync(process.execPath, [out], { stdio: 'inherit', cwd: here });
}
