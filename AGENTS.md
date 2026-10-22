# AGENTS.md: Oddsbanta (JamBets repo) guide for AI agents

Read this before you touch anything. It describes the system as it actually runs in production
(verified 21 Oct 2026 against the repo, GitHub Actions, Vercel and the live site). Where older docs in
this repo disagree with this file, this file wins. See "Stale docs" below.

---

## 1. What this is

**Oddsbanta** (https://www.oddsbanta.com) is a multi-sport AI prediction subscription platform.
The repo and Vercel project are still called **JamBets / jam-bets** (the old name). Same product.

- Python engines generate predictions (Monte Carlo, 250,000 sims per match) for **football**,
  **football specialist markets** (Over 2.5, HT Over 0.5, 1H Blitz, Draw Hunter, Home/Away, corners),
  **tennis** and **basketball**. American football and cricket are "coming soon" placeholders only.
- Everything is stored in **Supabase** (Postgres + Auth).
- A **Vite + React** SPA on **Vercel** shows the picks behind a tiered paywall. Vercel Edge
  functions in `api/` serve the feeds, auth checks, payments, emails and the Telegram bot.
- Picks are scored 0 to 10 and shown as tiers: Banger / Top Pick / High Confidence / Mid / NO_SAFE_BANKER.
- The owner is in Lagos (WAT, UTC+1). Many schedules and UI dates are designed around WAT.

## 2. Live infrastructure (verified)

| Piece | Where | Notes |
|---|---|---|
| Git | `github.com/chibzymart-art/JamBets`, branch `main` | Only branch. Pushing to `main` deploys production. |
| Hosting | Vercel project `jam-bets` (team "whizzchibzgmailcom's projects", **Hobby plan**) | Domains: `www.oddsbanta.com` (canonical), `oddsbanta.com`, `jambets.vercel.app` |
| Database/Auth | Supabase project `vepcoopomlfjageijsew` | RLS on everything. Edge functions read with the service role. |
| Schedulers | GitHub Actions (7 workflows in `.github/workflows/`) | NOT APScheduler, NOT n8n, NOT Vercel cron. |
| Payments | Bachs.io (`api/checkout/bachs.ts`, `api/webhooks/bachs.ts`, `api/billing/portal.ts`) | NOT Stripe. Stripe env vars still exist on Vercel but are unused leftovers. |
| Email | Resend from Vercel functions (welcome, subscription, password reset); Python email engine with Gmail/Brevo/Mailjet relay pool for alerts and drips | |
| Bots | Telegram VIP bot via `api/telegram-webhook.ts` on Vercel; WhatsApp bot in `whatsapp-bot/` (Baileys, Docker, hosted separately) | |
| SEO | SSR shell via `api/ssr.ts` + `api/_lib/ssrRender.ts`, sitemap, IndexNow pings from every workflow | |

## 3. Repo map

```
api/                 PRODUCTION Vercel Edge functions (this is what serves oddsbanta.com/api/*)
  _lib/              shared: edge-cache (SWR), etag, jwt-verifier (access levels), ssrRender, trackRecord
  *-feed.ts          predictions / goals / market / tennis / basketball / sports-summary feeds
  checkout/ billing/ webhooks/   Bachs payments
  telegram-*.ts      Telegram bot webhook + login
  ssr.ts sitemap.ts geo.ts rate-limiter.ts invalidate-cache.ts track-record.ts send-*-email.ts
web/                 Vite + React 18 SPA (package name oddsbanta-web)
  api/               LOCAL DEV COPY of some api files (see warning in section 6)
  src/App.tsx        all routing + most page state (~160 KB)
  src/components/    AdminView (~190 KB), FixtureCard, *HubView, *PredictionCard, modals
  src/lib/           *FeedService.ts (client data layer), geoCurrency, supabase client, seo, dateUtils
  src/hooks/         useTrialStatus, useVirtualWindow
  scripts/rename-shell.mjs   renames dist/index.html -> app-shell.html after build (required for SSR)
python/
  src/run_predictions.py, run_settlement.py   core football engine entrypoints
  src/football/      fixtures, identity, team strength, Dixon-Coles/Poisson models, simulation, settlement
  src/goals/         Over 2.5, HT Over 0.5, first-half intent, AI scout (Gemini)
  src/corners/       negative binomial corners model + settlement
  src/engines/       run_all_specialists, specialist_settlements, feed_snapshot_engine (writes cached_feeds)
  src/tennis/        surface ELO, Markov point model, simulation, settlement, scraper
  src/basketball/    Four Factors, ratings, Monte Carlo, settlement, scrapers
  src/sources/       ESPN, LiveScore, Flashscore, FotMob, SportyBet, Google adapters
  src/db/            supabase_client, universal_data_store
  src/alerts/ email_engine/ seo/   failure alerts, email relay pool, IndexNow
  tests/             unittest/pytest suites
supabase/migrations/ 47 ordered SQL migrations (source of truth for schema, RLS, views, RPCs)
scripts/             one-off verification / repair scripts (many are single-incident, read before running)
scratch/             gitignored junk drawer (~330 files). Do not rely on it, do not add to it in git.
docs/                architecture docs (stale, see section 9) + 2 recent audit docs (useful)
whatsapp-bot/        standalone Baileys bot
vercel.json          ROOT config Vercel actually uses (build, headers, redirects, rewrites)
```

## 4. How data flows

1. **GitHub Actions** run the Python engines on schedule (times are UTC):
   | Workflow | Cron | Runs |
   |---|---|---|
   | prediction_engine.yml | 23:00 daily | `python -m python.src.run_predictions` |
   | goals_engine.yml | 00:00 daily | goals cycle + all specialists (`--predict-only`) |
   | basketball_engine.yml | 01:00 daily | basketball daemon + `run_predictions` |
   | tennis_engine.yml | 02:00 daily | `tennis.run_tennis_predictions` |
   | settlement_engine.yml | :10 past, 03:00 to 22:00 | football + goals + specialist settlement |
   | basketball_settlement_engine.yml | :30 past, 03:00 to 22:00 | basketball settlement |
   | tennis_settlement_engine.yml | :50 past, 03:00 to 22:00 | tennis settlement |
2. Engines write fixtures/predictions/settlements to Supabase tables per sport. Sports are
   deliberately isolated: tennis and basketball tables have **no foreign keys** to football tables.
3. Every workflow then runs `python -m python.src.engines.feed_snapshot_engine --feed <x>`, which
   precomputes JSON snapshots into `public.cached_feeds` (keys: `feed:football:today`, `feed:goals`,
   `feed:corners`, `feed:market:counts`, `feed:tennis`, `feed:basketball`).
4. Edge functions (`api/*-feed.ts`) read those snapshots with the service role, cache them in memory
   (`api/_lib/edge-cache.ts`, stale-while-revalidate), then **redact per user access level** before responding.
5. The SPA reads only from `/api/*` feeds (plus Supabase Auth). It should never query prediction tables directly.
6. Each workflow finishes with an IndexNow ping and, on failure, a failure email alert.

All Python entrypoints are run as modules **from the repo root**: `python -m python.src.<module>`.

## 5. Access tiers and paywall (the most sensitive logic)

Access levels (`api/_lib/jwt-verifier.ts`): `visitor` < `expired` < `trial` < `standard` < `vip` < `admin`.

| Level | Football + goals + corners | Tennis + basketball |
|---|---|---|
| visitor / expired | locked teasers | locked teasers |
| trial (first 3 days after signup) | full | locked |
| standard (₦5,000 / $5 per month) | full | locked |
| vip = "BigBang VIP" (₦10,000 / $10 per month) | full | full + Telegram/WhatsApp signals |
| admin | everything + Admin panel + Track Record | everything |

- Quarterly plans are 10% off. Currency comes from edge geo (`api/geo.ts`): Nigeria sees NGN, everyone else sees USD.
- Tier strings in the DB that mean VIP: `bigbang`, `big_bang`, `vip`, `pro`, `premium`.
- The paywall is enforced **twice** and both layers must agree:
  1. Edge: redaction in each `api/*-feed.ts`.
  2. DB: RLS policies, `*_paywall` views, and functions `is_admin()`, `is_paid_subscriber()`,
     `is_football_entitled()`, `is_multisport_entitled()`. `cached_feeds` rows for the gated keys are RLS-restricted.
- Admins are recognised by an email allow-list (hardcoded in both `jwt-verifier.ts` and SQL functions),
  `app_metadata.role`, `users.role`, entitlements, or subscriptions. **Never** trust `user_metadata`
  for privileges (it is user-editable; this hole was closed in migration 20261017000002).
- Track Record is **admin-only** since 18 Oct (commit 67a96fa). The public homepage copy still says
  hit rates are "published on the track record", which no longer matches.

## 6. Rules for agents (read all)

1. **Only the root `api/` folder is real.** Production serves the ROOT `api/`, and the local dev plugin
   in `web/vite.config.ts` loads the same root files. The old `web/api/` copy was deleted in Phase 1:
   do not recreate it.
2. **Pushing to `main` deploys production.** There is no staging branch. Run the build before pushing:
   `cd web && npm run build` (runs `tsc && vite build && rename-shell`). A TypeScript error breaks deploys.
3. **Schema changes: the live database is the truth, not the files.** As of 21 Oct 2026 there is no
   migration history table: past changes were pasted into the SQL editor by hand, the live schema has
   policies no file creates, and some files were never applied. Before any schema change, compare with
   the live catalog (`pg_policies`, `pg_views`, grants). New changes go in `supabase/migrations/`
   as `YYYYMMDDHHMMSS_description.sql`, start from `supabase/templates/new_table_migration.sql`
   for new tables, never edit an applied migration, and include a ROLLBACK comment.
4. **Predictions are immutable once published.** Migrations enforce a permanent 2-day lock and
   immutability triggers. Do not "fix" history by editing published picks; settle, void or archive instead.
   Wipe scripts exist (`scripts/wipe_*`, `python/src/scripts/wipe_*`): never run them without the owner's explicit OK.
5. **Never weaken the paywall.** Any change to a feed, view or RLS policy must be checked as a visitor,
   trial, standard, VIP and admin. Locked items are built with `toLockedTeaser()` from `api/_lib/teaser.ts`
   using an explicit field allowlist: never spread a raw row (`...p`) or its `metadata` into a locked
   response. Markets whose row set is the pick (`MEMBERSHIP_REVEALING_MARKETS`) return a count only to
   locked users (every market-feed market, and the whole goals feed). Open locked matches carry
   `confidence_category: 'LOCKED'`, never a real tier: a tier next to the fixture gives the pick away.
   Hubs show per-day tier totals from `locked_tier_counts` instead (days with fewer than 3 matches are
   withheld). Tier filters are for unlocked users only. Locked lists are ordered by kickoff, never by
   confidence. Run `node tests/edge/run.mjs` after touching any feed. The browser must never query
   prediction tables or views directly for a locked user.
6. **No verified data = no settlement.** Settlement must use verified results from sources; never infer or invent a result.
7. **Keep sports isolated.** No cross-sport FKs, no shared tables beyond users/subscriptions/entitlements/cached_feeds.
8. **Secrets.** Real values live in the root `.env` (gitignored), Vercel env vars and GitHub Actions secrets.
   Never print, commit or log them. `.env.example` is outdated (still lists Stripe/API-Football, no Bachs/Resend).
9. **Compliance copy.** Oddsbanta is "an analytics tool, not a bookmaker", 18+, "model estimate, not a guarantee".
   Do not write copy that promises accuracy or guaranteed wins.
10. **Timezones.** Engines and DB use UTC. UI shows the visitor's local time (WAT default for Nigeria).
    Snapshot cutoffs use a 4-day forward horizon plus a 1-day timezone buffer; keep that if you touch cutoffs.
11. **Edge cache invalidation.** `api/invalidate-cache.ts` requires `ODDSBANTA_INVALIDATION_SECRET`/`CRON_SECRET`
    (neither is set on Vercel, so it falls back to the service role key).
12. **Admin reads go through admin-only functions.** The Admin panel calls `admin_*` RPCs
    (`admin_engine_telemetry`, `admin_broadcast_picks`, `admin_get_users`, ...) that check
    `public.is_admin()` first, run `SECURITY DEFINER` with `set search_path = ''`, and have EXECUTE revoked
    from `public, anon`. Never add a browser read of a prediction table or paywall view for the Admin panel.
13. **Security Advisor gate.** Before closing any phase that touched the database, rerun the Supabase
    Security Advisor (Advisors, Security, Rerun linter). Errors must be 0. Accepted warnings as of
    22 Oct 2026: "Public Can Execute SECURITY DEFINER" for `is_admin`, `is_football_entitled`,
    `is_multisport_entitled`, `is_paid_subscriber` (RLS policies call them) and "Signed-In Users Can Execute
    SECURITY DEFINER" for the `admin_*`, `get_platform_analytics`, `get_system_health` functions (each
    checks for an admin). Anything new must be fixed, not added to this list.
14. **Retired markets.** Home Win, Away Win and Draw (1X2 specialist markets) are retired. The market feed
    answers them with 410. Their old tables are closed to the Data API and can be dropped with
    `supabase/scripts/drop_retired_1x2_markets.sql` (permanent, owner's call).
15. **Commit style** in this repo: conventional commits, e.g. `fix(paywall): ...`, `feat(basketball-ui): ...`.

## 7. Common commands

```bash
# Frontend (from repo root)
cd web && npm install && npm run dev        # http://localhost:5173, reads ../.env, serves web/api/* locally
cd web && npm run build                     # must pass before any push to main

# Python engines (from repo root, Python 3.11)
pip install -r python/requirements.txt
python -m python.src.run_predictions                       # football
python -m python.src.run_settlement                        # football settlement
python -m python.src.goals.run_goals_cycle --predict-only  # or --settle-only
python -m python.src.engines.run_all_specialists --predict-only
python -m python.src.tennis.run_tennis_predictions
python -m python.src.tennis.run_tennis_settlement --lookback-hours 48 --dry-run
python -m python.src.basketball.run_predictions --days-forward 4 --sims 250000
python -m python.src.basketball.run_settlement --lookback-hours 48 --dry-run
python -m python.src.engines.feed_snapshot_engine --feed all   # football|goals|corners|counts|tennis|basketball|all

# Tests
python -m unittest discover python/tests   # pytest also works if installed (not in requirements.txt)
```

All of these hit the PRODUCTION Supabase project (there is no separate dev database). Prefer `--dry-run`
where a script offers it, and read a script before running it.

Manual workflow runs: GitHub > Actions > pick workflow > Run workflow (inputs include `days_forward`,
`simulations`, `wipe_all`. Never set `wipe_all` without the owner's OK).

## 8. Known issues (as of 21 Oct 2026, verify before relying on them)

1. **Paywall leaks in the API (fixed on branch `phase1-paywall-teasers`, live once merged).** Before
   the fix, tennis sent reasoning, Elo and set-score odds to visitors, the goals and market feeds listed the
   picked fixtures, and every feed showed each match's tier. The database side (Phase 0: public read on
   `corner_predictions`, anon grants on base tables, bots) is still open: see the security audit document.
2. **Basketball totals use a fake line.** `python/src/basketball/prediction_engine.py` (around line 187)
   falls back to 222.0 (NBA) / 162.0 (others) when `market_total` is NULL, which is about 99.8% of fixtures.
   The Oct 13 audit measured these totals at about 50% (coin flip). Moneyline "bangers" average about 1.09 odds, negative ROI.
3. **Tennis rating data is thin.** About two thirds of players have no rank and a default 1450 ELO. Surface
   affinity is a hardcoded list of ~12 names in `tennis/elo_engine.py`. Serve strength is derived only from
   ELO gap. Many matches end as NO_SAFE_BANKER; top tiers underperformed. Full plan in
   `docs/engine_audit_checkpoint_tennis_basketball.md` and `docs/tennis_prediction_calibration_plan.md`.
4. **Missing GitHub secrets.** Workflows reference `ALERT_EMAIL_PASSWORD` (16 times) and `GEMINI_API_KEY` (goals
   engine), but neither is set in the repo's Actions secrets. Failure alert emails cannot authenticate, and the
   goals AI scout runs without its key. Only these are set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ALERT_EMAIL_SENDER`, `ALERT_EMAIL_RECIPIENTS`.
5. **Network errors crash settlement steps.** For example, run #1936 failed in "Execute Decoupled Specialist
   Settlement Engine" on an unhandled `httpx` connection error during the corners pass. About 35 of 2,500+ runs have failed;
   most later runs succeed. Wrap upstream HTTP calls with retry and per-fixture error isolation.
6. **Football prediction run is slow.** It recently took about 37 minutes against a 50-minute timeout. Earlier
   runs failed at 15 to 17 minutes when the timeout was lower.
7. **Vercel env drift.** `BACHS_PROD_STANDARD_NGN` / `BACHS_PROD_BIGBANG_NGN` are not set on Vercel, so the
   code falls back to hardcoded product IDs. Stripe and `API_FOOTBALL_KEY` vars are unused leftovers.
8. **Hobby plan.** The Vercel project is on the Hobby plan, which Vercel limits to non-commercial use;
   Oddsbanta takes payments. This is the owner's call, but flag it before relying on Hobby limits.
9. **GitHub Actions deprecations.** `actions/checkout@v4` and `actions/setup-python@v5` target Node 20
   (deprecated). `ubuntu-latest` moves to Ubuntu 26 from 19 Oct 2026.

## 9. Stale docs (do not trust without checking)

- `README.md`: says Next.js, Stripe, APScheduler, "Phase 1 pending". All wrong now.
- `docs/architecture/01` to `15` (8 Sep): original Phase 0 plan. Concepts (canonical identity, no verified
  data = no settlement, multi-source validation) still hold; stack, scheduler and payment details do not.
- `python/README.md`: football acquisition only.
- `walkthrough.md`: basketball build log; its "100% green" claims predate the Oct 13 audit.
- `.env.example`: outdated variable list.
- Pricing and tiers are defined in code, not docs: `web/src/lib/geoCurrency.ts`, `api/geo.ts`, `web/src/components/PricingModal.tsx`.

## 10. How to verify a change

1. `cd web && npm run build` passes.
2. Relevant Python tests pass; run engine scripts with `--dry-run` where available.
3. After deploy, check on https://www.oddsbanta.com:
   - pages `/`, `/dashboard`, `/dashboard/goals`, `/dashboard/tennis`, `/dashboard/basketball`, `/subscription` return 200;
   - `/api/predictions-feed`, `/api/goals-feed`, `/api/tennis-feed`, `/api/basketball-feed` return
     `success: true`, `is_stale: false`, and a recent `cached_at`;
   - as a logged-out visitor, no upcoming pick is unlocked and nothing in `metadata` reveals it;
   - `/api/track-record` returns 401 for non-admins.
4. Check the next scheduled GitHub Actions run of any workflow you touched.
5. Report what you verified and what you could not. Do not claim a fix works without checking it live.
