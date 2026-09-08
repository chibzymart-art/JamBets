# JamBets — Simulation Design

## Overview

The simulation engine executes **250,000 Monte Carlo simulations** per fixture to produce probability distributions for all prediction markets. It is the statistical backbone of JamBets predictions.

---

## Why 250,000 Simulations?

| Simulation Count | Precision (95% CI for 50% event) | Use Case |
|-----------------|----------------------------------|----------|
| 1,000 | ±3.1% | Toy / demo |
| 10,000 | ±1.0% | Quick estimate |
| 100,000 | ±0.31% | Good precision |
| **250,000** | **±0.20%** | **JamBets standard** |
| 1,000,000 | ±0.10% | Diminishing returns |

250,000 provides sub-0.2% precision for common events while keeping computation time manageable (~2-5 seconds per fixture with NumPy vectorization).

---

## Simulation Algorithm

### Input

From the prediction engine:
- `λ_home` — Expected goals for home team (Poisson parameter)
- `λ_away` — Expected goals for away team (Poisson parameter)

### Process

```python
def simulate_fixture(lambda_home: float, lambda_away: float, n: int = 250_000):
    """
    Run Monte Carlo simulation for a single fixture.

    Returns:
        SimulationResult with goal distributions and scoreline matrix
    """
    # Vectorized Poisson sampling (single operation for all 250k sims)
    home_goals = np.random.poisson(lam=lambda_home, size=n)
    away_goals = np.random.poisson(lam=lambda_away, size=n)

    # Cap goals at a reasonable maximum (e.g., 10) for matrix size
    home_goals = np.clip(home_goals, 0, MAX_GOALS)
    away_goals = np.clip(away_goals, 0, MAX_GOALS)

    return SimulationResult(
        home_goals=home_goals,
        away_goals=away_goals,
        n=n
    )
```

### Output Distributions

#### 1. Goals Distribution (per team)

```json
{
  "home_goals_distribution": {
    "0": 45000,
    "1": 82500,
    "2": 72000,
    "3": 35000,
    "4": 12000,
    "5": 3000,
    "6": 500
  }
}
```

#### 2. Scoreline Matrix

A 2D matrix counting occurrences of each home×away scoreline:

```json
{
  "scoreline_matrix": {
    "0-0": 12500,
    "0-1": 18750,
    "1-0": 22500,
    "1-1": 33750,
    "1-2": 25000,
    "2-0": 20000,
    "2-1": 30000,
    "2-2": 22500,
    ...
  }
}
```

#### 3. Summary Statistics

```json
{
  "summary_stats": {
    "home": {
      "mean": 1.65,
      "median": 2,
      "std": 1.28,
      "mode": 1
    },
    "away": {
      "mean": 1.20,
      "median": 1,
      "std": 1.10,
      "mode": 1
    },
    "total_goals": {
      "mean": 2.85,
      "median": 3,
      "std": 1.69
    }
  }
}
```

---

## Market Derivation from Simulations

All markets are derived by counting simulation outcomes:

```python
class MarketCalculator:
    def __init__(self, home_goals: np.ndarray, away_goals: np.ndarray):
        self.home = home_goals
        self.away = away_goals
        self.n = len(home_goals)

    def match_result_1x2(self):
        return {
            "home": np.sum(self.home > self.away) / self.n,
            "draw": np.sum(self.home == self.away) / self.n,
            "away": np.sum(self.away > self.home) / self.n,
        }

    def over_under(self, line: float):
        total = self.home + self.away
        return {
            "over": np.sum(total > line) / self.n,
            "under": np.sum(total <= line) / self.n,
        }

    def btts(self):
        return {
            "yes": np.sum((self.home > 0) & (self.away > 0)) / self.n,
            "no": np.sum((self.home == 0) | (self.away == 0)) / self.n,
        }

    def correct_score(self):
        scores = {}
        for h in range(MAX_GOALS + 1):
            for a in range(MAX_GOALS + 1):
                count = np.sum((self.home == h) & (self.away == a))
                if count > 0:
                    scores[f"{h}-{a}"] = count / self.n
        return scores
```

---

## Performance Considerations

| Aspect | Design Decision |
|--------|----------------|
| Vectorization | NumPy array operations — no Python loops over 250k sims |
| Memory | ~2MB per fixture (250k × 2 int32 arrays) |
| CPU | ~2-5 seconds per fixture on modern hardware |
| Batch size | Process fixtures sequentially to control memory |
| Parallelism | Optional: ProcessPoolExecutor for multi-fixture batches |
| Random seed | Set per-fixture for reproducibility in testing |

---

## Data Storage

Simulation results are stored in `football.simulations`:

- Full goal distributions (JSONB)
- Full scoreline matrix (JSONB)
- Summary statistics (JSONB)
- Computation duration (ms)
- Linked to prediction and fixture

This data enables:
- Post-hoc analysis of model accuracy
- Historical calibration studies
- UI visualization of probability distributions
