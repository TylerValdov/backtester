"""Deterministic synthetic OHLCV generator.

Geometric Brownian motion with regime shifts (bull / bear / chop) layered on a
per-symbol drift/vol personality, plus a market factor shared across symbols so
cross-sectional strategies (pairs, ranking) have real structure to find.

Deterministic: same symbol always yields the same series, so backtests are
reproducible run-to-run. ~16 years of daily bars, 2010-01-04 → today.
"""
from datetime import date

import numpy as np
import pandas as pd

from .universe import UNIVERSE

START_DATE = date(2010, 1, 4)

# Regime schedule (applies to the shared market factor): (year-fraction length, drift mult, vol mult)
_REGIMES = [
    (1.7, 1.4, 0.9), (0.6, -1.2, 1.6), (2.1, 1.2, 0.8), (0.9, 0.2, 1.1),
    (1.5, 1.5, 0.9), (0.35, -2.8, 2.4), (1.4, 1.8, 1.0), (1.0, -0.9, 1.5),
    (2.0, 1.3, 0.9), (0.8, 0.1, 1.2), (2.5, 1.2, 0.9), (1.2, 0.8, 1.0),
]

_cache: dict[str, pd.DataFrame] = {}
_dates_cache: pd.DatetimeIndex | None = None


def trading_days() -> pd.DatetimeIndex:
    global _dates_cache
    if _dates_cache is None:
        _dates_cache = pd.bdate_range(START_DATE, date.today())
    return _dates_cache


def _regime_multipliers(n: int) -> tuple[np.ndarray, np.ndarray]:
    """Expand the regime schedule across n trading days."""
    drift = np.ones(n)
    vol = np.ones(n)
    total_years = sum(r[0] for r in _REGIMES)
    i = 0
    for length, d_mult, v_mult in _REGIMES:
        span = int(round(n * length / total_years))
        drift[i : i + span] = d_mult
        vol[i : i + span] = v_mult
        i += span
    return drift, vol


def get_ohlcv(symbol: str) -> pd.DataFrame:
    """Daily OHLCV DataFrame indexed by date: open, high, low, close, volume."""
    if symbol in _cache:
        return _cache[symbol]
    if symbol not in UNIVERSE:
        raise KeyError(f"Unknown symbol: {symbol}")

    spec = UNIVERSE[symbol]
    dates = trading_days()
    n = len(dates)
    dt = 1 / 252

    rng = np.random.default_rng(abs(hash(f"backtester:{symbol}")) % (2**32))
    market_rng = np.random.default_rng(20100104)  # shared across all symbols

    d_mult, v_mult = _regime_multipliers(n)
    market_shock = market_rng.standard_normal(n)  # common factor
    idio_shock = rng.standard_normal(n)
    beta = 0.4 + 0.6 * rng.random()  # factor loading in [0.4, 1.0)

    mu = spec["drift"] * d_mult
    sigma = spec["vol"] * v_mult
    shock = beta * market_shock + np.sqrt(max(1 - beta**2, 0.05)) * idio_shock
    log_ret = (mu - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * shock
    close = spec["start"] * np.exp(np.cumsum(log_ret))

    gap = rng.normal(0, 0.003, n)
    open_ = np.empty(n)
    open_[0] = spec["start"]
    open_[1:] = close[:-1] * (1 + gap[1:])
    intraday = np.abs(rng.normal(0, 0.008, n)) + 0.002
    high = np.maximum(open_, close) * (1 + intraday)
    low = np.minimum(open_, close) * (1 - intraday)
    volume = (rng.lognormal(mean=16.5, sigma=0.35, size=n)).astype(np.int64)

    df = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=dates,
    )
    _cache[symbol] = df
    return df


def latest_close(symbol: str) -> float:
    return float(get_ohlcv(symbol)["close"].iloc[-1])
