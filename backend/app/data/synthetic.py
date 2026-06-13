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

from .timeframes import bars_per_day, is_intraday, normalize
from .universe import UNIVERSE

START_DATE = date(2010, 1, 4)

# How far back synthetic intraday history runs per timeframe — mirrors real
# intraday data availability (you rarely get years of 1-minute bars) and keeps
# the generated arrays small.
_INTRADAY_CAP_DAYS = {"1m": 40, "5m": 180, "15m": 365, "1h": 750}

# Regime schedule (applies to the shared market factor): (year-fraction length, drift mult, vol mult)
_REGIMES = [
    (1.7, 1.4, 0.9), (0.6, -1.2, 1.6), (2.1, 1.2, 0.8), (0.9, 0.2, 1.1),
    (1.5, 1.5, 0.9), (0.35, -2.8, 2.4), (1.4, 1.8, 1.0), (1.0, -0.9, 1.5),
    (2.0, 1.3, 0.9), (0.8, 0.1, 1.2), (2.5, 1.2, 0.9), (1.2, 0.8, 1.0),
]

_cache: dict[str, pd.DataFrame] = {}
_intraday_cache: dict[tuple[str, str], pd.DataFrame] = {}
_dates_cache: pd.DatetimeIndex | None = None

_STEP_MIN = {"1m": 1, "5m": 5, "15m": 15, "1h": 60}


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


def get_ohlcv(symbol: str, timeframe: str = "1d") -> pd.DataFrame:
    """OHLCV DataFrame: daily (index=date) or intraday (index=datetime)."""
    tf = normalize(timeframe)
    if is_intraday(tf):
        return _intraday(symbol, tf)
    return _daily(symbol)


def _daily(symbol: str) -> pd.DataFrame:
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


def _intraday(symbol: str, tf: str) -> pd.DataFrame:
    """Generate intraday OHLCV by walking a Brownian bridge within each session,
    anchored to the deterministic daily close path. Deterministic per
    (symbol, timeframe); capped to a recent span (see _INTRADAY_CAP_DAYS)."""
    key = (symbol, tf)
    if key in _intraday_cache:
        return _intraday_cache[key]

    daily = _daily(symbol)
    cap = _INTRADAY_CAP_DAYS[tf]
    step = _STEP_MIN[tf]
    sigma = 0.0007 * np.sqrt(step)  # per-bar log-vol
    days = daily.index[-cap:]
    first_pos = len(daily) - len(days)
    prev_close = float(daily["close"].iloc[first_pos - 1]) if first_pos > 0 else float(daily["open"].iloc[0])

    rng = np.random.default_rng(abs(hash(f"intra:{symbol}:{tf}")) % (2**32))
    frames: list[pd.DataFrame] = []
    for d in days:
        ts = pd.date_range(d + pd.Timedelta(hours=9, minutes=30), d + pd.Timedelta(hours=15, minutes=59, seconds=59), freq=f"{step}min")
        n = len(ts)
        if n == 0:
            continue
        day_close = float(daily.at[d, "close"])
        walk = np.cumsum(rng.normal(0, sigma, n))
        drift = np.linspace(0, 1, n)
        # Brownian bridge: subtract the realized endpoint, add the target move so
        # the last bar lands exactly on the day's close (no intraday lookahead —
        # this is generation, not a signal).
        target = np.log(day_close / prev_close)
        logpath = np.log(prev_close) + (walk - drift * walk[-1]) + drift * target
        close = np.exp(logpath)
        open_ = np.empty(n)
        open_[0] = prev_close
        open_[1:] = close[:-1]
        noise = np.abs(rng.normal(0, 0.0006 * np.sqrt(step), n)) + 0.0002
        high = np.maximum(open_, close) * (1 + noise)
        low = np.minimum(open_, close) * (1 - noise)
        volume = (float(daily.at[d, "volume"]) / n * rng.lognormal(0, 0.3, n)).astype(np.int64)
        frames.append(pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=ts))
        prev_close = float(close[-1])

    out = pd.concat(frames) if frames else daily.iloc[:0]
    _intraday_cache[key] = out
    return out


def latest_close(symbol: str) -> float:
    return float(get_ohlcv(symbol)["close"].iloc[-1])
