"""Timeframe registry — the single source of truth for bar resolutions.

Every consumer (provider fetch, synthetic generator, runner annualization, the
builder UI) refers to these keys so adding a resolution is a one-place change.
`bars_per_day` uses the 6.5-hour regular session; `periods_per_year` is what
metrics annualize against (252 sessions × bars/day)."""

TIMEFRAMES: dict[str, dict] = {
    "1m":  {"label": "1 minute",   "alpaca": "1Min",  "bars_per_day": 390},
    "5m":  {"label": "5 minute",   "alpaca": "5Min",  "bars_per_day": 78},
    "15m": {"label": "15 minute",  "alpaca": "15Min", "bars_per_day": 26},
    "1h":  {"label": "1 hour",     "alpaca": "1Hour", "bars_per_day": 6.5},
    "1d":  {"label": "1 day",      "alpaca": "1Day",  "bars_per_day": 1},
}

DEFAULT_TIMEFRAME = "1d"
TRADING_DAYS = 252


def normalize(tf: str | None) -> str:
    return tf if tf in TIMEFRAMES else DEFAULT_TIMEFRAME


def is_intraday(tf: str) -> bool:
    return normalize(tf) != "1d"


def alpaca_timeframe(tf: str) -> str:
    return TIMEFRAMES[normalize(tf)]["alpaca"]


def bars_per_day(tf: str) -> float:
    return TIMEFRAMES[normalize(tf)]["bars_per_day"]


def periods_per_year(tf: str) -> float:
    """Annualization factor for Sharpe/CAGR/vol at this resolution."""
    return TRADING_DAYS * bars_per_day(tf)
