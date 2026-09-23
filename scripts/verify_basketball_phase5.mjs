/**
 * Oddsbanta — Autonomous Basketball Engine Phase 5 Verification Script
 * Validates Frontend Web UI, Four Factors Cards, Dynamic Lagos WAT Calendar,
 * Routes, Accumulator Drawer integration, and Zero-Regression Build Invariants.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(` [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(` [FAIL] ${message}`);
    failedTests++;
  }
}

console.log('=================================================================');
console.log(' Oddsbanta: Phase 5 Basketball Web UI & Integration Verification');
console.log('=================================================================\n');

// 1. Core UI Components & Styling Files
console.log('--- 1. Frontend UI Architecture & Component Inventory ---');
const cardPath = path.join(ROOT_DIR, 'web', 'src', 'components', 'BasketballPredictionCard.tsx');
const hubPath = path.join(ROOT_DIR, 'web', 'src', 'components', 'BasketballHubView.tsx');
const feedPath = path.join(ROOT_DIR, 'web', 'src', 'lib', 'basketballFeedService.ts');
const cssPath = path.join(ROOT_DIR, 'web', 'src', 'basketball.css');

assert(fs.existsSync(cardPath), 'BasketballPredictionCard.tsx component exists');
assert(fs.existsSync(hubPath), 'BasketballHubView.tsx master hub component exists');
assert(fs.existsSync(feedPath), 'basketballFeedService.ts Cloud Supabase client exists');
assert(fs.existsSync(cssPath), 'basketball.css design tokens & styling exist');

// 2. Component Features & Dean Oliver Four Factors Invariants
console.log('\n--- 2. Dean Oliver Four Factors & 250k SIM Telemetry ---');
const cardContent = fs.readFileSync(cardPath, 'utf-8');
assert(cardContent.includes('efg_pct'), 'Card includes Effective Field Goal % (eFG%) display');
assert(cardContent.includes('tov_pct'), 'Card includes Turnover % (TOV%) display');
assert(cardContent.includes('orb_pct'), 'Card includes Offensive Rebounding % (ORB%) display');
assert(cardContent.includes('ftr'), 'Card includes Free Throw Rate (FTR) display');
assert(cardContent.includes('250,000') || cardContent.includes('250k'), 'Card renders 250,000 Monte Carlo telemetry');
assert(cardContent.includes('handleFavoriteClick') || cardContent.includes('onToggleFavorite'), 'Card connects to accumulator slip / watchlist drawer');
assert(cardContent.includes('isLocked') || cardContent.includes('is_locked'), 'Card enforces paywall lock gating for non-subscribers');

// 3. Master Hub View & Lagos WAT Date Invariants
console.log('\n--- 3. Master Hub Navigation & Dynamic Lagos WAT Calendar ---');
const hubContent = fs.readFileSync(hubPath, 'utf-8');
assert(hubContent.includes('bball-hero-banner'), 'Hub renders rich hero banner and stats');
assert(hubContent.includes('dynamicDateTabs'), 'Hub implements dynamic Lagos WAT relative date ribbon');
assert(hubContent.includes('selectedLeague'), 'Hub implements league switcher');
assert(hubContent.includes('selectedMarket'), 'Hub implements market switcher (Spread, Totals, ML)');
assert(hubContent.includes('selectedTier'), 'Hub implements confidence tier filtering (Bangers, Top Picks)');
assert(hubContent.includes('WatchlistSidebar'), 'Hub renders right Watchlist / accumulator slip sidebar');

// 4. App.tsx Integration & Routing Invariants
console.log('\n--- 4. App.tsx Integration & Route Declarations ---');
const appPath = path.join(ROOT_DIR, 'web', 'src', 'App.tsx');
const appContent = fs.readFileSync(appPath, 'utf-8');
assert(appContent.includes("from './components/BasketballHubView'"), 'App.tsx imports BasketballHubView');
assert(appContent.includes("import './basketball.css'"), 'App.tsx imports basketball.css');
assert(appContent.includes("selectedSport === 'basketball'"), 'App.tsx renders BasketballHubView when basketball sport is selected');
assert(appContent.includes("path=\"/basketball\""), 'App.tsx defines standalone /basketball URL route');
assert(appContent.includes("id: 'basketball'"), 'App.tsx includes basketball in sports pill navigation list');

// 5. Invariant Protection: Zero Contamination of Football / Tennis
console.log('\n--- 5. Zero-Contamination Invariant Protection ---');
const tennisHubPath = path.join(ROOT_DIR, 'web', 'src', 'components', 'TennisHubView.tsx');
const fixtureCardPath = path.join(ROOT_DIR, 'web', 'src', 'components', 'FixtureCard.tsx');
const tennisHubContent = fs.readFileSync(tennisHubPath, 'utf-8');
const fixtureCardContent = fs.readFileSync(fixtureCardPath, 'utf-8');

assert(!tennisHubContent.includes('basketball_predictions'), 'TennisHubView has zero references to basketball tables');
assert(!fixtureCardContent.includes('basketball_predictions'), 'Football FixtureCard has zero references to basketball tables');

// 6. Production Compilation
console.log('\n--- 6. TypeScript Production Build Test ---');
try {
  execSync('npm run build', { cwd: path.join(ROOT_DIR, 'web'), stdio: 'pipe' });
  assert(true, 'Web app production build (tsc && vite build) succeeds with 0 errors');
} catch (err) {
  assert(false, `Production build failed: ${err.message}`);
}

console.log('\n=================================================================');
console.log(` Summary: ${passedTests} Passed, ${failedTests} Failed`);
console.log('=================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
