# JamBets — Folder Structure

```
JamBets/
│
├── README.md
├── .gitignore
├── .env.example                     # Template only — never real secrets
│
├── docs/
│   └── architecture/
│       ├── 01-system-architecture.md
│       ├── 02-folder-structure.md
│       ├── 03-database-architecture.md
│       ├── 04-scheduler-architecture.md
│       ├── 05-source-architecture.md
│       ├── 06-fixture-identity.md
│       ├── 07-prediction-design.md
│       ├── 08-simulation-design.md
│       ├── 09-live-data-design.md
│       ├── 10-settlement-design.md
│       ├── 11-security-design.md
│       ├── 12-user-access-design.md
│       ├── 13-testing-strategy.md
│       ├── 14-failure-recovery.md
│       └── 15-data-flow.md
│
├── web/                             # Next.js frontend + API
│   ├── package.json
│   ├── next.config.js
│   ├── tsconfig.json
│   ├── public/
│   ├── src/
│   │   ├── app/                     # Next.js App Router
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── (auth)/
│   │   │   │   ├── login/
│   │   │   │   └── register/
│   │   │   ├── dashboard/
│   │   │   ├── predictions/
│   │   │   └── account/
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   ├── predictions/
│   │   │   ├── fixtures/
│   │   │   └── layout/
│   │   ├── lib/
│   │   │   ├── supabase/
│   │   │   │   ├── client.ts        # Browser client (anon key only)
│   │   │   │   └── server.ts        # Server client (service-role)
│   │   │   ├── stripe/
│   │   │   └── utils/
│   │   ├── hooks/
│   │   ├── types/
│   │   └── styles/
│   └── api/                         # API route handlers
│       ├── auth/
│       ├── predictions/
│       ├── subscriptions/
│       └── webhooks/
│           └── stripe/
│
├── python/                          # Python data + prediction system
│   ├── pyproject.toml
│   ├── requirements.txt
│   ├── .env.example                 # Template only
│   │
│   ├── src/
│   │   ├── __init__.py
│   │   │
│   │   ├── scheduler/              # Job orchestration
│   │   │   ├── __init__.py
│   │   │   ├── runner.py            # APScheduler entry point
│   │   │   ├── jobs.py              # Job definitions
│   │   │   └── config.py
│   │   │
│   │   ├── sources/                 # Verified source registry
│   │   │   ├── __init__.py
│   │   │   ├── registry.py          # Source registry manager
│   │   │   ├── base.py              # Abstract source adapter
│   │   │   ├── espn.py
│   │   │   ├── livescore.py
│   │   │   ├── flashscore.py
│   │   │   └── football_api.py
│   │   │
│   │   ├── football/                # Football domain (independent)
│   │   │   ├── __init__.py
│   │   │   │
│   │   │   ├── acquisition/         # Football data acquisition
│   │   │   │   ├── __init__.py
│   │   │   │   └── fetcher.py
│   │   │   │
│   │   │   ├── fixtures/            # Fixture discovery & identity
│   │   │   │   ├── __init__.py
│   │   │   │   ├── discovery.py
│   │   │   │   ├── identity.py      # Canonical fixture matching
│   │   │   │   └── normalizer.py
│   │   │   │
│   │   │   ├── prediction/          # Football prediction engine
│   │   │   │   ├── __init__.py
│   │   │   │   ├── engine.py
│   │   │   │   ├── models.py
│   │   │   │   └── markets.py
│   │   │   │
│   │   │   ├── simulation/          # Monte Carlo simulation
│   │   │   │   ├── __init__.py
│   │   │   │   ├── engine.py        # 250k simulation runner
│   │   │   │   ├── distributions.py
│   │   │   │   └── results.py
│   │   │   │
│   │   │   ├── live/                # Live monitoring
│   │   │   │   ├── __init__.py
│   │   │   │   ├── monitor.py
│   │   │   │   └── status.py
│   │   │   │
│   │   │   ├── results/             # Result verification
│   │   │   │   ├── __init__.py
│   │   │   │   ├── verifier.py
│   │   │   │   └── conflicts.py
│   │   │   │
│   │   │   └── settlement/          # Football settlement
│   │   │       ├── __init__.py
│   │   │       ├── engine.py
│   │   │       └── evaluator.py
│   │   │
│   │   ├── validation/              # Source & data validation
│   │   │   ├── __init__.py
│   │   │   ├── source_validator.py
│   │   │   └── data_validator.py
│   │   │
│   │   ├── normalization/           # Data normalization
│   │   │   ├── __init__.py
│   │   │   ├── teams.py
│   │   │   ├── leagues.py
│   │   │   └── fixtures.py
│   │   │
│   │   ├── db/                      # Supabase client
│   │   │   ├── __init__.py
│   │   │   ├── client.py
│   │   │   ├── queries.py
│   │   │   └── models.py
│   │   │
│   │   └── utils/                   # Shared utilities
│   │       ├── __init__.py
│   │       ├── logging.py
│   │       └── config.py
│   │
│   └── tests/
│       ├── __init__.py
│       ├── test_sources/
│       ├── test_football/
│       ├── test_scheduler/
│       ├── test_validation/
│       └── test_normalization/
│
├── supabase/                        # Supabase configuration
│   └── migrations/                  # SQL migration files
│       └── 001_initial_schema.sql
│
└── scripts/                         # Utility scripts
    ├── setup.sh
    └── setup.ps1
```

## Key Principles

1. **`web/`** — Everything user-facing (Next.js). Never imports from `python/`.
2. **`python/`** — All data acquisition, prediction, simulation, settlement. Never serves UI.
3. **`python/src/football/`** — Self-contained football domain. Other sports get their own sibling directory.
4. **`supabase/`** — Database migrations and seed scripts only.
5. **`docs/`** — Architecture and design documentation.
6. **Secrets** — Never committed. Only `.env.example` templates are tracked.
