# JamBets — Testing Strategy

## Testing Layers

```
┌──────────────────────────────────┐
│         E2E Tests (Sparse)       │  Playwright — critical user flows
├──────────────────────────────────┤
│      Integration Tests           │  API routes + Supabase + Stripe
├──────────────────────────────────┤
│        Unit Tests (Dense)        │  Every module, every function
└──────────────────────────────────┘
```

---

## Python Test Strategy

### Framework: `pytest`

### Unit Tests (`python/tests/`)

| Module | Test Focus | Example |
|--------|-----------|---------|
| `sources/` | Adapter parsing, rate limiting | Parse ESPN HTML → structured data |
| `football/fixtures/` | Name resolution, canonical key generation | "Man City" → "manchester-city" |
| `football/prediction/` | Model output given known inputs | λ calculation, confidence scoring |
| `football/simulation/` | Distribution accuracy, market derivation | 250k sims → known Poisson probs |
| `football/results/` | Verification logic, conflict detection | 2 sources agree → verified |
| `football/settlement/` | Every market rule | 1X2: home_win + home_predicted → WON |
| `validation/` | Source validation, data validation | Unknown source → rejection |
| `normalization/` | Team/league normalization | Accent removal, slug generation |
| `scheduler/` | Idempotency key generation, job lifecycle | Duplicate key → skip |

### Integration Tests

| Scope | Test Focus |
|-------|-----------|
| Source → Supabase | Fetch fixtures → write to DB → read back |
| Prediction pipeline | Fixture → prediction → simulation → markets |
| Settlement pipeline | Verified result → settlement evaluation → DB write |
| Scheduler → Jobs | APScheduler triggers → job executes → DB state correct |

### Mocking

- External HTTP calls: `respx` or `responses` library
- Supabase: mock client or test project
- Time: `freezegun` for deterministic scheduling tests

---

## Web Test Strategy

### Framework: `vitest` + `@testing-library/react`

### Unit Tests

| Module | Test Focus |
|--------|-----------|
| Components | Render with props, user interaction |
| Hooks | State management, API call handling |
| Utils | Data formatting, tier checking |

### API Route Tests

| Route | Test Focus |
|-------|-----------|
| `/api/predictions` | Auth required, tier gating, correct data |
| `/api/webhooks/stripe` | Signature validation, entitlement update |
| `/api/auth/*` | Registration, login, token refresh |

### E2E Tests (Playwright)

| Flow | Steps |
|------|-------|
| Registration | Visit → register → verify dashboard |
| Login | Visit → login → see predictions |
| Subscription | Login → subscribe → verify tier upgrade |
| Prediction view | Login → view predictions → verify market display |

---

## Test Data

### Principles

1. **No real API calls in tests** — All external sources mocked
2. **Deterministic seeds** — Random seeds set for reproducible simulations
3. **Fixture factories** — Helper functions to create test fixtures, teams, leagues
4. **Known outcomes** — Test settlements use pre-defined scores and expected outcomes

### Example Test Fixture Factory

```python
def make_fixture(
    home="arsenal", away="chelsea",
    league="eng-premier-league",
    kickoff=datetime(2026, 9, 15, 15, 0, tzinfo=UTC),
    status="scheduled"
):
    return {
        "id": str(uuid4()),
        "league_id": LEAGUE_IDS[league],
        "home_team_id": TEAM_IDS[home],
        "away_team_id": TEAM_IDS[away],
        "kickoff_at": kickoff.isoformat(),
        "status": status,
        "canonical_key": f"{league}:{home}:{away}:{kickoff.strftime('%Y%m%d')}",
    }
```

---

## Coverage Targets

| Layer | Target |
|-------|--------|
| Python unit tests | ≥ 90% |
| Python integration tests | ≥ 70% |
| Web unit tests | ≥ 80% |
| Web E2E tests | Critical paths only |
| Settlement logic | **100%** (every market, every outcome) |

---

## CI/CD Testing

```
[Push to GitHub]
        │
        ▼
[GitHub Actions]
  ├── Python: lint (ruff) → type check (mypy) → unit tests (pytest)
  ├── Web: lint (eslint) → type check (tsc) → unit tests (vitest)
  └── E2E: Playwright (on PR to main only)
```
