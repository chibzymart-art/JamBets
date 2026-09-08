# JamBets

**AI-powered football prediction and simulation platform.**

## Overview

JamBets is a sports prediction platform that uses verified external data, Monte Carlo simulations (250,000 per fixture), and rigorous source validation to produce football predictions. The system enforces a strict principle: **no verified data = no settlement**.

## Architecture

See [`docs/architecture/`](docs/architecture/) for the complete Phase 0 architecture.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (React) |
| Backend API | Next.js API Routes |
| Data Acquisition | Python 3.11 |
| Simulation Engine | Python (NumPy/SciPy) |
| Database | Supabase (PostgreSQL) |
| Authentication | Supabase Auth |
| Payments | Stripe |
| Scheduling | APScheduler / Cron |

## Project Status

- [x] Phase 0 — Architecture & Foundation
- [ ] Phase 1 — Implementation (pending)

## License

Proprietary. All rights reserved.
