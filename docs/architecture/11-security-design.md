# JamBets — Security Design

## Principles

1. **Defense in depth** — Multiple layers of protection
2. **Least privilege** — Every component gets minimum required access
3. **Secrets never in code** — All credentials via environment variables
4. **Server-side authority** — Client never has elevated access

---

## Secret Management

### Environment Variables

| Variable | Used By | Scope |
|----------|---------|-------|
| `SUPABASE_URL` | Web + Python | Server-side |
| `SUPABASE_ANON_KEY` | Web (client) | Public (safe for frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Web API + Python | **Server-side ONLY** |
| `STRIPE_SECRET_KEY` | Web API | Server-side |
| `STRIPE_WEBHOOK_SECRET` | Web API | Server-side |
| `STRIPE_PUBLISHABLE_KEY` | Web (client) | Public |
| `API_FOOTBALL_KEY` | Python | Server-side |
| `DATABASE_URL` | Python (direct) | Server-side |

### Secret Storage Rules

| Location | Allowed? |
|----------|----------|
| `.env` file (local dev) | ✅ (gitignored) |
| Environment variables (production) | ✅ |
| Source code | ❌ NEVER |
| GitHub | ❌ NEVER |
| Frontend JavaScript bundle | ❌ NEVER |
| Browser localStorage/sessionStorage | ❌ NEVER |
| Logs / console output | ❌ NEVER |
| Screenshots / recordings | ❌ NEVER |
| Database rows | ❌ NEVER (except encrypted) |
| Comments / documentation | ❌ NEVER |

### `.env.example` (committed — NO real values)

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Stripe
STRIPE_SECRET_KEY=sk_test_your-key-here
STRIPE_WEBHOOK_SECRET=whsec_your-secret-here
STRIPE_PUBLISHABLE_KEY=pk_test_your-key-here

# Data Sources
API_FOOTBALL_KEY=your-api-key-here
```

---

## Authentication Architecture

### Supabase Auth

- Email/password registration
- Optional OAuth (Google, GitHub)
- JWT tokens with configurable expiry
- Refresh token rotation
- Password reset via email

### JWT Flow

```
[User logs in via Supabase Auth]
        │
        ▼
[Supabase issues JWT + refresh token]
        │
        ▼
[Client stores JWT in httpOnly cookie or Supabase client memory]
        │
        ▼
[Every API request includes JWT in Authorization header]
        │
        ▼
[API route validates JWT via Supabase server client]
        │
        ▼
[If valid → extract user_id, role → proceed]
[If invalid → 401 Unauthorized]
```

---

## Row-Level Security (RLS)

All tables have RLS **enabled**. Policies enforce:

### Core Schema

```sql
-- Users can only read their own profile
CREATE POLICY "users_own_read" ON core.users
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "users_own_update" ON core.users
  FOR UPDATE USING (auth.uid() = id);
```

### Football Schema

```sql
-- Public read access to fixtures
CREATE POLICY "fixtures_public_read" ON football.fixtures
  FOR SELECT USING (true);

-- Predictions gated by subscription tier
CREATE POLICY "predictions_tier_read" ON football.predictions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM core.entitlements
      WHERE user_id = auth.uid()
      AND tier >= prediction.tier_required
    )
  );

-- Results are public
CREATE POLICY "results_public_read" ON football.results
  FOR SELECT USING (true);
```

### System Tables

```sql
-- Admin only access to system jobs and audit logs
CREATE POLICY "system_admin_only" ON core.system_jobs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM core.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

---

## API Security

### Next.js API Routes

- All API routes validate JWT before processing
- Service-role key used only in server-side API routes
- CORS configured to allow only the application domain
- Rate limiting on authentication endpoints
- Input validation on all endpoints (Zod schemas)

### Python Workers

- Python connects to Supabase using service-role key
- Key loaded from environment variable at startup
- No HTTP API exposed by Python workers
- Workers run on trusted infrastructure only

---

## Data Security

### In Transit

- All Supabase connections over HTTPS/TLS
- All external source connections over HTTPS
- No plaintext HTTP allowed

### At Rest

- Supabase manages PostgreSQL encryption at rest
- Backup encryption managed by Supabase
- No local data persistence in Python workers (stateless)

---

## Attack Surface Minimization

| Vector | Mitigation |
|--------|------------|
| SQL Injection | Parameterized queries only (Supabase client) |
| XSS | React auto-escaping + CSP headers |
| CSRF | SameSite cookies + CSRF tokens |
| Credential exposure | Env vars only, .gitignore, no logging |
| Unauthorized access | RLS + JWT validation on every request |
| Data tampering | Service-role writes only from server/workers |
| Brute force | Rate limiting on auth endpoints |
| Dependency vulnerabilities | Regular `npm audit` and `pip audit` |
