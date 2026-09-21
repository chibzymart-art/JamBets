// JamBets / Oddsbanta — Phase 1 Tennis Isolated Architecture Verification Suite
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log("=================================================================");
console.log(" Oddsbanta: Phase 1 Autonomous Tennis Engine Verification");
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
const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20260921000001_autonomous_tennis_prediction_engine.sql');
assert("Migration file exists", fs.existsSync(migrationPath));

const sqlContent = fs.readFileSync(migrationPath, 'utf8');
const requiredEntities = [
    'CREATE TABLE IF NOT EXISTS public.tennis_tournaments',
    'CREATE TABLE IF NOT EXISTS public.tennis_players',
    'CREATE TABLE IF NOT EXISTS public.tennis_fixtures',
    'CREATE TABLE IF NOT EXISTS public.tennis_predictions',
    'CREATE TABLE IF NOT EXISTS public.tennis_settlements',
    'CREATE OR REPLACE VIEW public.tennis_predictions_paywall'
];

for (const entity of requiredEntities) {
    assert(`Migration defines entity: ${entity.split('public.')[1]}`, sqlContent.includes(entity));
}

// Ensure Zero References to Football Tables in the Tennis Migration
const forbiddenFootballTables = [
    'football_fixtures',
    'football_predictions',
    'football_teams',
    'football_leagues',
    'home_win_predictions',
    'away_win_predictions',
    'draw_predictions',
    'corner_predictions',
    'goals_predictions'
];

let zeroFootballCollisions = true;
for (const fbTable of forbiddenFootballTables) {
    if (sqlContent.includes(fbTable)) {
        zeroFootballCollisions = false;
        console.error(`Found forbidden reference to ${fbTable} in tennis migration!`);
    }
}
assert("Zero foreign keys or references to football/specialist tables", zeroFootballCollisions);

// 2. Verify TypeScript Contracts
console.log("\n--- 2. TypeScript Data Contracts ---");
const tsPath = path.resolve(process.cwd(), 'web/src/types/tennis.ts');
assert("web/src/types/tennis.ts exists", fs.existsSync(tsPath));

const tsContent = fs.readFileSync(tsPath, 'utf8');
assert("Defines TennisTournament interface", tsContent.includes('export interface TennisTournament'));
assert("Defines TennisPlayer interface", tsContent.includes('export interface TennisPlayer'));
assert("Defines TennisFixture interface", tsContent.includes('export interface TennisFixture'));
assert("Defines TennisPrediction interface", tsContent.includes('export interface TennisPrediction'));
assert("Defines TennisSettlement interface", tsContent.includes('export interface TennisSettlement'));
assert("Defines TennisConfidenceTier type", tsContent.includes('export type TennisConfidenceTier'));

// 3. Verify Python Domain Package
console.log("\n--- 3. Python Domain Models & Persistence Client ---");
const pyInitPath = path.resolve(process.cwd(), 'python/src/tennis/__init__.py');
const pyModelsPath = path.resolve(process.cwd(), 'python/src/tennis/models.py');
const pyDbPath = path.resolve(process.cwd(), 'python/src/tennis/db.py');

assert("python/src/tennis/__init__.py exists", fs.existsSync(pyInitPath));
assert("python/src/tennis/models.py exists", fs.existsSync(pyModelsPath));
assert("python/src/tennis/db.py exists", fs.existsSync(pyDbPath));

// 4. Test Python Module Import & Syntax
console.log("\n--- 4. Python Compilation & Import Verification ---");
try {
    const pyOutput = execSync('python -c "from python.src.tennis.models import TennisTournamentModel, TennisPredictionModel; from python.src.tennis.db import TennisDbClient; print(\'Python Tennis Package OK\')"', { encoding: 'utf8' });
    assert("Python tennis models & DB client import cleanly", pyOutput.includes('Python Tennis Package OK'));
} catch (e) {
    assert("Python tennis package import test", false, e.message);
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
