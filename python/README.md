# JamBets — Football Data Acquisition Layer (Phase 2)

A resilient, multi-source, server-side data acquisition pipeline for football competitions worldwide.

## Architecture

```
                 +-----------------------+   +-----------------------+
                 |   ESPN Soccer Feed    |   |   LiveScore API Feed  |
                 +-----------+-----------+   +-----------+-----------+
                             |                           |
                             +-------------+-------------+
                                           |
                                           v
                             +---------------------------+
                             | Raw Fixture Payloads      |
                             +-------------+-------------+
                                           |
                                           v
                             +---------------------------+
                             | Stale Data Protection     |
                             | (15m live / 6h sched)     |
                             +-------------+-------------+
                                           |
                                           v
                             +---------------------------+
                             | Canonical Identity Resolv |
                             | ({league}:{home}:{away})  |
                             +-------------+-------------+
                                           |
                                           v
                             +---------------------------+
                             | Multi-Source Validation   |
                             | (VERIFIED vs CONFLICTING) |
                             +-------------+-------------+
                                           |
                                           v
                             +---------------------------+
                             | Cloud Supabase Datastore  |
                             +---------------------------+
```

## Features

1. **Configurable League Registry**: 30 competitions across major and smaller tiers (England, Spain, Italy, Germany, France, Champions League, Europa League, Netherlands, Scotland, Portugal, USA, Brazil, Argentina, Mexico, Japan, and more).
2. **Canonical Event Identity**: Deterministic identity hashing based on normalized team names (stripping accents, punctuation, club suffixes like FC/CF/SC), league code, and scheduled date.
3. **Stale Data Protection**: Distinguishes `current`, `historical`, `stale`, `unknown`, `verified`, and `conflicting`. Enforces freshness thresholds and rejects outdated payloads.
4. **Multi-Source Validation**: Compares overlapping feeds. Agreement results in `VERIFIED`. Status or score discrepancy flags the match as `CONFLICTING` with detailed conflict attributes stored in Supabase.
5. **Direct Cloud Supabase Integration**: Pushes structured fixtures, teams, leagues, and source provenance directly to PostgreSQL on Supabase.

## CLI Usage

```bash
# Run unit test suite
python -m unittest python/tests/test_acquisition.py

# Run live data acquisition
python python/src/cli.py
```
