"""Market data provider interface.

Every consumer (backtest runner, paper trader, chart API) goes through
`get_provider()`, so swapping synthetic data for a real vendor is a one-module
change.

PLACEHOLDER[MARKET DATA API — HISTORICAL]: to go live, implement
`PolygonProvider` (or Alpaca / Yahoo Finance) below and set
MARKET_DATA_PROVIDER + MARKET_DATA_API_KEY in backend/.env.

Expected data shape returned by `history()` — pandas DataFrame indexed by
trading date with float columns: open, high, low, close, volume.
  Polygon:  GET /v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}
  Alpaca:   GET /v2/stocks/{symbol}/bars?timeframe=1Day
  Yahoo:    yfinance.download(symbol, start, end)

PLACEHOLDER[MARKET DATA API — LIVE FEED]: `LiveFeed.subscribe()` is the hook
for a real-time stream (Polygon/Alpaca websocket). The paper trading engine
consumes ticks shaped {symbol: str, price: float, ts: iso8601}. The bundled
SimulatedFeed random-walks off the last synthetic close so the paper engine is
fully exercisable offline.
"""
from abc import ABC, abstractmethod

import numpy as np
import pandas as pd

from ..config import get_settings
from . import synthetic
from .universe import UNIVERSE


class MarketDataProvider(ABC):
    @abstractmethod
    def history(self, symbol: str, start: str | None = None, end: str | None = None) -> pd.DataFrame: ...

    def closes(self, symbols: list[str], start: str | None = None, end: str | None = None) -> pd.DataFrame:
        """Aligned close-price matrix: index=dates, columns=symbols."""
        frames = {s: self.history(s, start, end)["close"] for s in symbols}
        return pd.DataFrame(frames).dropna(how="all")


class SyntheticProvider(MarketDataProvider):
    """Deterministic generated data — default for development and demos."""

    def history(self, symbol: str, start: str | None = None, end: str | None = None) -> pd.DataFrame:
        df = synthetic.get_ohlcv(symbol)
        if start:
            df = df.loc[df.index >= pd.Timestamp(start)]
        if end:
            df = df.loc[df.index <= pd.Timestamp(end)]
        return df


class PolygonProvider(MarketDataProvider):
    """PLACEHOLDER[MARKET DATA API]: real implementation goes here.

    def history(self, symbol, start=None, end=None):
        resp = httpx.get(
            f"https://api.polygon.io/v2/aggs/ticker/{symbol}/range/1/day/{start}/{end}",
            params={"apiKey": settings.market_data_api_key},
        )
        ... normalize to the open/high/low/close/volume DataFrame contract ...
    """

    def history(self, symbol: str, start: str | None = None, end: str | None = None) -> pd.DataFrame:
        raise NotImplementedError(
            "Polygon provider not wired. Set MARKET_DATA_API_KEY and implement "
            "PolygonProvider.history (see module docstring for the contract)."
        )


def get_provider() -> MarketDataProvider:
    name = get_settings().market_data_provider
    if name == "polygon":
        return PolygonProvider()
    return SyntheticProvider()


class SimulatedFeed:
    """Random-walk live tick simulator seeded from the last synthetic close."""

    def __init__(self) -> None:
        self._prices: dict[str, float] = {}
        self._rng = np.random.default_rng()

    def price(self, symbol: str) -> float:
        if symbol not in self._prices:
            self._prices[symbol] = synthetic.latest_close(symbol)
        return self._prices[symbol]

    def tick(self, symbols: list[str]) -> dict[str, float]:
        """Advance one tick (~2s of simulated intraday time) for the symbols."""
        out = {}
        for s in symbols:
            p = self.price(s)
            ann_vol = UNIVERSE.get(s, {}).get("vol", 0.25)
            step_vol = ann_vol / np.sqrt(252 * 390 * 30)  # ~2-second steps
            p *= float(np.exp(self._rng.normal(0, step_vol)))
            self._prices[s] = p
            out[s] = round(p, 4)
        return out
