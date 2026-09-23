// JamBets / Oddsbanta — Phase 1 Basketball Isolated Architecture Verification Suite
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log("=================================================================");
console.log(" Oddsbanta: Phase 1 Autonomous Basketball Engine Verification");
console.log("=================================================================\n");

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
    if (condition) {
        console.log(` [PASS] ${name}`);
        passed++;
    } else {
        console.error(` [FAIL] ${name} ${detail ? `-> ${detail}` : ''}`);
        failed++;
    }
}

// 1. Verify Migration File Integrity
console.log("--- 1. Database Schema & Migration Invariants ---");
const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260924000001_basketball_prediction_engine.sql');
assert("Migration file exists", fs.existsSync(migrationPath));

const sqlContent = fs.readFileSync(migrationPath, 'utf8');
const requiredEntities = [
    'CREATE TABLE IF NOT EXISTS public.basketball_leagues',
    'CREATE TABLE IF NOT EXISTS public.basketball_teams',
    'CREATE TABLE IF NOT EXISTS public.basketball_players',
    'CREATE TABLE IF NOT EXISTS public.basketball_fixtures',
    'CREATE TABLE IF NOT EXISTS public.basketball_predictions',
    'CREATE TABLE IF NOT EXISTS public.basketball_settlements',
    'CREATE OR REPLACE VIEW public.basketball_predictions_paywall'
];

for (const entity of requiredEntities) {
    assert(`Migration defines entity: ${entity.split('public.')[1]}`, sqlContent.includes(entity));
}

// Ensure Zero References to Football or Tennis Tables in the Basketball Migration
const forbiddenTables = [
    'football_fixtures',
    'football_predictions',
    'football_teams',
    'football_leagues',
    'home_win_predictions',
    'away_win_predictions',
    'draw_predictions',
    'corner_predictions',
    'goals_predictions',
    'tennis_fixtures',
    'tennis_predictions',
    'tennis_tournaments',
    'tennis_players',
    'tennis_settlements'
];

let zeroCollisions = true;
for (const table of forbiddenTables) {
    if (sqlContent.includes(table)) {
        zeroCollisions = false;
        console.error(`Found forbidden reference to ${table} in basketball migration!`);
    }
}
assert("Zero foreign keys or references to football/tennis/specialist tables", zeroCollisions);

// 2. Verify TypeScript Contracts
console.log("\n--- 2. TypeScript Data Contracts ---");
const tsPath = path.resolve(process.cwd(), 'web/src/types/basketball.ts');
assert("web/src/types/basketball.ts exists", fs.existsSync(tsPath));

const tsContent = fs.readFileSync(tsPath, 'utf8');
assert("Defines BasketballLeague interface", tsContent.includes('export interface BasketballLeague'));
assert("Defines BasketballTeam interface", tsContent.includes('export interface BasketballTeam'));
assert("Defines BasketballPlayer interface", tsContent.includes('export interface BasketballPlayer'));
assert("Defines BasketballFixture interface", tsContent.includes('export interface BasketballFixture'));
assert("Defines BasketballPrediction interface", tsContent.includes('export interface BasketballPrediction'));
assert("Defines BasketballSettlement interface", tsContent.includes('export interface BasketballSettlement'));
assert("Defines BasketballConfidenceTier type", tsContent.includes('export type BasketballConfidenceTier'));
assert("Defines BasketballMarket type", tsContent.includes('export type BasketballMarket'));

// 3. Verify Python Domain Package
console.log("\n--- 3. Python Domain Models & Persistence Client ---");
const pyInitPath = path.resolve(process.cwd(), 'python/src/basketball/__init__.py');
const pyModelsPath = path.resolve(process.cwd(), 'python/src/basketball/models.py');
const pyDbPath = path.resolve(process.cwd(), 'python/src/basketball/db.py');

assert("python/src/basketball/__init__.py exists", fs.existsSync(pyInitPath));
assert("python/src/basketball/models.py exists", fs.existsSync(pyModelsPath));
assert("python/src/basketball/db.py exists", fs.existsSync(pyDbPath));

// 4. Test Python Module Import & Syntax
console.log("\n--- 4. Python Compilation & Import Verification ---");
try {
    const pyOutput = execSync('python -c "from python.src.basketball.models import BasketballLeagueModel, BasketballPredictionModel; from python.src.basketball.db import BasketballDbClient; print(\'Python Basketball Package OK\')"', { encoding: 'utf8' });
    assert("Python basketball models & DB client import cleanly", pyOutput.includes('Python Basketball Package OK'));
} catch (e) {
    assert("Python basketball package import test", false, e.message);
}

// 5. Test Web App TypeScript Build
console.log("\n--- 5. Web App Build & Invariant Protection ---");
try {
    const webBuildOutput = execSync('npm run build', { cwd: path.resolve(process.cwd(), 'web'), encoding: 'utf8' });
    assert("Web app compiles cleanly with 0 TypeScript/Vite errors", webBuildOutput.includes('built in'));
} catch (e) {
    assert("Web app compilation", false, e.message);
}

console.log("\n=================================================================");
console.log(` Summary: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================");

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
