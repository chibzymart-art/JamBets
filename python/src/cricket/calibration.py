"""
Calibration and blending: a small logistic regression (fitted by Newton's
method with light L2) that maps raw model outputs to honest probabilities.

Inputs are logits of the simulator's win probability and the Elo win
probability (and, later, the de-margined bookmaker probability). Fitted only
on predictions made before the period being scored (walk-forward).
"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np


def logit(p: np.ndarray | float, eps: float = 1e-4):
    p = np.clip(p, eps, 1 - eps)
    return np.log(p / (1 - p))


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


class LogisticBlend:
    def __init__(self, l2: float = 1.0):
        self.l2 = l2
        self.w: np.ndarray | None = None

    def fit(self, X: np.ndarray, y: np.ndarray, iters: int = 50) -> "LogisticBlend":
        Xb = np.hstack([np.ones((len(X), 1)), X])
        w = np.zeros(Xb.shape[1])
        reg = np.eye(len(w)) * self.l2
        reg[0, 0] = 0.0
        for _ in range(iters):
            p = sigmoid(Xb @ w)
            g = Xb.T @ (p - y) + reg @ w
            H = (Xb * (p * (1 - p))[:, None]).T @ Xb + reg
            step = np.linalg.solve(H, g)
            w -= step
            if np.abs(step).max() < 1e-8:
                break
        self.w = w
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        assert self.w is not None, "fit first"
        Xb = np.hstack([np.ones((len(X), 1)), X])
        return sigmoid(Xb @ self.w)


def wilson_lower(wins: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    ph = wins / n
    d = 1 + z * z / n
    c = ph + z * z / (2 * n)
    r = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n))
    return (c - r) / d


def brier(p: Sequence[float], y: Sequence[float]) -> float:
    p, y = np.asarray(p), np.asarray(y)
    return float(np.mean((p - y) ** 2))


def calibration_table(p, y, edges=(0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0001)):
    """Rows of (band, n, mean predicted, actual) for the favourite's probability."""
    p, y = np.asarray(p, float), np.asarray(y, float)
    fav = np.where(p >= 0.5, p, 1 - p)
    hit = np.where(p >= 0.5, y, 1 - y)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mk = (fav >= lo) & (fav < hi)
        if mk.sum():
            rows.append((f"{lo:.0%}-{min(hi,1):.0%}", int(mk.sum()),
                         float(fav[mk].mean()), float(hit[mk].mean())))
    return rows
