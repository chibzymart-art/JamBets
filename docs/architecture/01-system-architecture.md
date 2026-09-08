# JamBets — System Architecture

## 1. Application Layers

JamBets is composed of **15 distinct architectural layers**, each with a single responsibility.

```
┌─────────────────────────────────────────────────────────┐
│                     WEB UI (Next.js)                    │
│              Frontend / User-facing Layer               │
├─────────────────────────────────────────────────────────┤
│                  BACKEND API (Next.js)                  │
│           API routes, Auth middleware, BFF              │
├─────────────────────────────────────────────────────────┤
│                AUTHENTICATION (Supabase Auth)           │
│         User sessions, JWT, role-based access           │
├───────────────┬─────────────────────────────────────────┤
│ SUBSCRIPTIONS │         PAYMENTS (Stripe)               │
│   Tier logic  │  Checkout, webhooks, entitlement sync   │
├───────────────┴─────────────────────────────────────────┤
│              CLOUD SUPABASE (PostgreSQL)                │
│       Single source of truth for all persisted data     │
├─────────────────────────────────────────────────────────┤
│         SCHEDULER / ORCHESTRATION (Python)              │
│       APScheduler — cron-like job management            │
├──────────┬──────────┬──────────┬────────────────────────┤
│ PYTHON   │ SOURCE   │ FIXTURE  │ NORMALIZATION          │
│ DATA ACQ │ VALID.   │ ENGINE   │ LAYER                  │
├──────────┴──────────┴──────────┴────────────────────────┤
│           FOOTBALL PREDICTION ENGINE (Python)           │
│        Model inference, market generation               │
├─────────────────────────────────────────────────────────┤
│           FOOTBALL SIMULATION ENGINE (Python)           │
│        250,000 Monte Carlo simulations / fixture        │
├─────────────────────────────────────────────────────────┤
│              LIVE MONITORING (Python)                   │
│       Real-time fixture status from verified sources    │
├─────────────────────────────────────────────────────────┤
│           RESULT VERIFICATION (Python)                  │
│       Multi-source result cross-validation              │
├─────────────────────────────────────────────────────────┤
│            SETTLEMENT ENGINE (Python)                   │
│       Market-by-market evaluation and payout calc       │
├─────────────────────────────────────────────────────────┤
│             AUDIT / MONITORING                          │
│       System jobs, data conflicts, audit logs           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Layer Responsibilities

### 2.1 Frontend / UI (Next.js)

- Server-side rendered pages for SEO and performance
- User dashboard: predictions, subscriptions, account
- Prediction feed with confidence scores, markets, odds
- Real-time fixture status display
- Subscription management UI
- **Never** consumes scraper output directly
- **Only** reads from Supabase (via API layer)

### 2.2 Backend / API (Next.js API Routes)

- BFF (Backend-for-Frontend) pattern
- Authenticates requests via Supabase JWT
- Enforces row-level security policies
- Proxies Supabase queries with server-side service-role key
- Handles Stripe webhook events
- Serves prediction data to authenticated users only

### 2.3 Python Data Acquisition

- Fetches fixture, live, and result data from verified external sources
- Implements per-source adapters (ESPN, LiveScore, Flashscore, APIs)
- Rate limiting, retry logic, circuit breaker pattern
- Outputs normalized data structures
- **Never writes to UI or frontend**

### 2.4 Source Validation

- Validates source identity and trustworthiness
- Checks source availability, freshness, and reliability
- Enforces the verified-source registry
- Rejects data from unknown or disabled sources

### 2.5 Fixture Engine

- Discovers upcoming fixtures from multiple sources
- Cross-references fixture identity across providers
- Deduplicates fixtures using canonical identifiers
- Validates fixture metadata (teams, league, kickoff time)

### 2.6 Prediction Engine (Football-specific)

- Ingests normalized fixture data from Supabase
- Runs statistical models per fixture
- Generates market predictions (1X2, Over/Under, BTTS, etc.)
- Delegates to simulation engine for probability distribution

### 2.7 Simulation Engine

- Executes 250,000 Monte Carlo simulations per fixture
- Uses NumPy for vectorized computation
- Produces probability distributions for all markets
- Stores simulation results in Supabase

### 2.8 Live Monitoring

- Polls verified sources every 15 minutes
- Retrieves current match status (not started, live, finished)
- Retrieves live scores when available
- Validates fixture identity before updating
- Pushes verified data to Supabase

### 2.9 Result Verification

- Cross-validates final results from multiple sources
- Requires minimum source agreement before accepting a result
- Flags conflicts for manual review
- **Never invents, estimates, or infers results**

### 2.10 Settlement Engine

- Evaluates each market against verified results
- Determines win/loss/void for each prediction market
- Calculates settlement amounts
- Writes settlement state to Supabase
- **No verified data = No settlement** (absolute rule)

### 2.11 Scheduler / Orchestration

- APScheduler-based job management
- Prediction job: every 6 hours
- Live/Result/Settlement job: every 15 minutes
- Idempotent job execution
- Survives restart, outage, missed/duplicate execution

### 2.12 Cloud Supabase

- PostgreSQL database (hosted)
- Row-level security (RLS) policies
- Real-time subscriptions (optional, for live updates)
- Storage for audit logs and data conflict records

### 2.13 Authentication

- Supabase Auth (email/password, OAuth providers)
- JWT-based session management
- Role-based access: anonymous, free, subscriber, admin

### 2.14 Subscriptions & Payments

- Stripe integration for payment processing
- Subscription tiers: Free, Pro, Premium
- Webhook-driven entitlement sync
- Supabase stores entitlement state

### 2.15 Audit / Monitoring

- All system jobs logged with start/end/status
- Data conflicts recorded and flagged
- Source health monitoring
- Settlement audit trail

---

## 3. Technology Decisions

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Frontend framework | Next.js 14+ | SSR, API routes, React ecosystem |
| Backend API | Next.js API Routes | Collocated with frontend, serverless-ready |
| Data/ML runtime | Python 3.11 | NumPy/SciPy ecosystem, scheduler support |
| Database | Supabase (PostgreSQL) | Managed, RLS, Auth, real-time |
| Auth | Supabase Auth | Integrated with database RLS |
| Payments | Stripe | Industry standard, webhook support |
| Scheduler | APScheduler | Python-native, persistent job store |
| Simulation | NumPy | Vectorized Monte Carlo at scale |

---

## 4. Deployment Topology

```
┌────────────────────┐    ┌────────────────────┐
│   Vercel / VPS     │    │   Python Worker     │
│   (Next.js app)    │    │   (Scheduler)       │
│                    │    │                     │
│  ┌──────────────┐  │    │  ┌───────────────┐  │
│  │ Frontend     │  │    │  │ APScheduler   │  │
│  │ API Routes   │  │    │  │ Data Acq.     │  │
│  │ Auth Middleware│ │    │  │ Prediction    │  │
│  └──────┬───────┘  │    │  │ Simulation    │  │
│         │          │    │  │ Settlement    │  │
└─────────┼──────────┘    │  └───────┬───────┘  │
          │               └──────────┼──────────┘
          │                          │
          ▼                          ▼
    ┌─────────────────────────────────────┐
    │         SUPABASE CLOUD              │
    │  PostgreSQL + Auth + Storage        │
    └─────────────────────────────────────┘
                     ▲
                     │
    ┌────────────────┴────────────────────┐
    │       EXTERNAL DATA SOURCES         │
    │  ESPN · LiveScore · Flashscore      │
    │  Football APIs                      │
    └─────────────────────────────────────┘
```
