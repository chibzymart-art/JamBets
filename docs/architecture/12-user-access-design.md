# JamBets — User & Access Design

## User Roles

| Role | Description | Access Level |
|------|-------------|--------------|
| `anonymous` | Unauthenticated visitor | Public fixtures and results only |
| `free` | Registered, no subscription | Basic predictions (1X2, O/U 2.5) |
| `pro` | Pro subscriber | All standard markets |
| `premium` | Premium subscriber | All markets including exotic |
| `admin` | System administrator | Full access + management |

---

## Subscription Tiers

### Free

- **Price:** $0
- **Markets:** 1X2, Over/Under 2.5
- **Fixtures:** Limited to top 5 leagues
- **Features:** Basic prediction view, no simulation details

### Pro

- **Price:** TBD (monthly/annual)
- **Markets:** 1X2, O/U 2.5, BTTS, Double Chance, O/U 1.5/3.5
- **Fixtures:** All supported leagues
- **Features:** Confidence scores, probability charts

### Premium

- **Price:** TBD (monthly/annual)
- **Markets:** All markets including Correct Score, HT Result
- **Fixtures:** All supported leagues
- **Features:** Full simulation data, scoreline matrix, historical accuracy

---

## Entitlement Flow

```
[User subscribes via Stripe Checkout]
        │
        ▼
[Stripe processes payment]
        │
        ▼
[Stripe sends webhook → /api/webhooks/stripe]
        │
        ▼
[API route validates webhook signature]
        │
        ▼
[Update core.subscriptions]
  (status, tier, billing period)
        │
        ▼
[Update core.entitlements]
  (resolved tier, features, valid_until)
        │
        ▼
[User's next API request uses updated entitlement]
  (RLS checks entitlement tier)
```

### Entitlement Resolution

```
if subscription.status == 'active':
    entitlement.tier = subscription.tier
elif subscription.status == 'past_due':
    entitlement.tier = subscription.tier  # grace period
elif subscription.status in ('cancelled', 'expired'):
    entitlement.tier = 'free'
```

---

## Access Control Matrix

| Resource | Anonymous | Free | Pro | Premium | Admin |
|----------|-----------|------|-----|---------|-------|
| Public fixtures | ✅ | ✅ | ✅ | ✅ | ✅ |
| Public results | ✅ | ✅ | ✅ | ✅ | ✅ |
| Basic predictions | ❌ | ✅ | ✅ | ✅ | ✅ |
| Pro markets | ❌ | ❌ | ✅ | ✅ | ✅ |
| Premium markets | ❌ | ❌ | ❌ | ✅ | ✅ |
| Simulation data | ❌ | ❌ | ❌ | ✅ | ✅ |
| Own profile | ❌ | ✅ | ✅ | ✅ | ✅ |
| Own subscription | ❌ | ✅ | ✅ | ✅ | ✅ |
| System jobs | ❌ | ❌ | ❌ | ❌ | ✅ |
| Audit logs | ❌ | ❌ | ❌ | ❌ | ✅ |
| Source management | ❌ | ❌ | ❌ | ❌ | ✅ |
| Data conflicts | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Registration Flow

```
[User visits /register]
        │
        ▼
[Enter email + password]
        │
        ▼
[Supabase Auth creates user]
        │
        ▼
[Database trigger creates core.users row]
  (role='free')
        │
        ▼
[Database trigger creates core.entitlements row]
  (tier='free', features={})
        │
        ▼
[User redirected to dashboard]
```

---

## Admin Capabilities

Admins can:

- View all system jobs and their status
- View and resolve data conflicts
- Enable/disable data sources
- Override settlement outcomes (with audit trail)
- View all users and their subscription status
- Access audit logs
- Cannot: delete users, access raw passwords, bypass Stripe
