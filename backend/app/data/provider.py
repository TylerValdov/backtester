"""Market data provider interface + implementations.

Every consumer (backtest runner, paper trader, chart API) goes through
`get_provider()` / `get_live_feed()`, so the data source is a one-line switch
controlled by MARKET_DATA_PROVIDER.

Providers:
- SyntheticProvider  — deterministic generated bars (default, offline)
- AlpacaProvider     — real daily bars from https://data.alpaca.markets
- PolygonProvider    — stub; implement if you switch to Polygon

Live feeds:
- SimulatedFeed      — random walk off the last close (synthetic mode)
- AlpacaLiveFeed     — anchors to real Alpaca snapshot prices, micro-walks
                       between refreshes so the dashboard stays smooth

Alpaca notes: the free "Basic" plan serves the IEX feed (set alpaca_feed=iex)
with a 15-minute recency limit and partial (IEX-only) volume; full-market SIP
history needs a paid plan (alpaca_feed=sip). Daily bars are split/dividend
adjusted (adjustment=all) for continuous backtests.
"""
import logging
import time
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np
import pandas as pd

from ..config import get_settings
from . import synthetic
from .universe import UNIVERSE

log = logging.getLogger("data.provider")
DATA_BASE = "https://data.alpaca.markets"


class MarketDataProvider(ABC):
    @abstractmethod
    def history(self, symbol: str, start: str | None = None, end: str | None = None) -> pd.DataFrame: ...

    def closes(self, symbols: list[str], start: str | None = None, end: str | None = None) -> pd.DataFrame:
        """Aligned close-price matrix: index=dates, columns=symbols."""
        frames = {s: self.history(s, start, end)["close"] for s in symbols}
        return pd.DataFrame(frames).dropna(how="all")


# ── Synthetic (default) ───────────────────────────────────────────────────────
class SyntheticProvider(MarketDataProvider):
    def history(self, symbol: str, start: str | None = None, end: str | None = None) -> pd.DataFrame:
        df = synthetic.get_ohlcv(symbol)
        if start:
            df = df.loc[df.index >= pd.Timestamp(start)]
        if end:
            df = df.loc[df.index <= pd.Timestamp(end)]
        return df


# ── Alpaca ────────────────────────────────────────────────────────────────────
def _recent_end() -> str:
    # Free IEX feed rejects an end inside the last 15 min; back off 16.
    return (datetime.now(timezone.utc) - timedelta(minutes=16)).strftime("%Y-%m-%dT%H:%M:%SZ")


class AlpacaProvider(MarketDataProvider):
    """Real daily bars. Full per-symbol history is fetched once and cached, then
    sliced per request — keeps backtests off the network after warmup."""

    _EMPTY = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    def __init__(self) -> None:
        s = get_settings()
        self._headers = {"APCA-API-KEY-ID": s.alpaca_api_key, "APCA-API-SECRET-KEY": s.alpaca_secret_key}
        self._feed = s.alpaca_feed
        self._start = s.alpaca_history_start
        self._cache: dict[str, pd.DataFrame] = {}

    def _fetch_bars(self, symbols: list[str]) -> dict[str, pd.DataFrame]:
        acc: dict[str, list] = {s: [] for s in symbols}
        page_token: str | None = None
        url = f"{DATA_BASE}/v2/stocks/bars"
        while True:
            params = {
                "symbols": ",".join(symbols),
                "timeframe": "1Day",
                "start": self._start,
                "end": _recent_end(),
                "adjustment": "all",
                "feed": self._feed,
                "limit": 10000,
            }
            if page_token:
                params["page_token"] = page_token
            resp = httpx.get(url, headers=self._headers, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            for sym, rows in (data.get("bars") or {}).items():
                acc[sym].extend(rows)
            page_token = data.get("next_page_token")
            if not page_token:
                break

        out: dict[str, pd.DataFrame] = {}
        for sym, rows in acc.items():
            if not rows:
                continue
            df = pd.DataFrame(rows)
            idx = pd.to_datetime(df["t"], utc=True).dt.tz_localize(None).dt.normalize()
            out[sym] = (
                df.assign(date=idx)
                .rename(columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"})
                .set_index("date")[["open", "high", "low", "close", "volume"]]
                .sort_index()
            )
        return out

    def _ensure_cached(self, symbols: list[str]) -> None:
        missing = [s for s in symbols if s not in self._cache]
        if not missing:
            return
        try:
            fetched = self._fetch_bars(missing)
        except Exception as exc:
            log.error("Alpaca bars fetch failed for %s: %s", missing, exc)
            fetched = {}
        for s in missing:
            self._cache[s] = fetched.get(s, self._EMPTY)

    def history(self, symbol: str, start: str | None = None, end: str | None = None) -> pd.DataFrame:
        if symbol not in UNIVERSE:
            raise KeyError(f"Unknown symbol: {symbol}")
        self._ensure_cached([symbol])
        df = self._cache[symbol]
        if start:
            df = df.loc[df.index >= pd.Timestamp(start)]
        if end:
            df = df.loc[df.index <= pd.Timestamp(end)]
        return df

    def closes(self, symbols: list[str], start: str | None = None, end: str | None = None) -> pd.DataFrame:
        self._ensure_cached(symbols)
        frames = {s: self._cache[s]["close"] for s in symbols if not self._cache[s].empty}
        df = pd.DataFrame(frames)
        if start:
            df = df.loc[df.index >= pd.Timestamp(start)]
        if end:
            df = df.loc[df.index <= pd.Timestamp(end)]
        return df.dropna(how="all")


class PolygonProvider(MarketDataProvider):
    """PLACEHOLDER[POLYGON]: implement history() to the OHLCV DataFrame contract
    if you switch MARKET_DATA_PROVIDER=polygon."""

    def history(self, symbol: str, start: str | None = None, end: str | None = None) -> pd.DataFrame:
        raise NotImplementedError("Polygon provider not wired. Use alpaca or synthetic.")


# ── Provider factory (cached singleton so the Alpaca cache persists) ───────────
_provider: MarketDataProvider | None = None


def get_provider() -> MarketDataProvider:
    global _provider
    settings = get_settings()
    name = settings.market_data_provider
    if name == "alpaca" and settings.alpaca_api_key:
        if not isinstance(_provider, AlpacaProvider):
            _provider = AlpacaProvider()
        return _provider
    if name == "polygon":
        return PolygonProvider()
    if not isinstance(_provider, SyntheticProvider):
        _provider = SyntheticProvider()
    return _provider


# ── Live feeds ────────────────────────────────────────────────────────────────
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
        out = {}
        for s in symbols:
            p = self.price(s)
            ann_vol = UNIVERSE.get(s, {}).get("vol", 0.25)
            step_vol = ann_vol / np.sqrt(252 * 390 * 30)
            p *= float(np.exp(self._rng.normal(0, step_vol)))
            self._prices[s] = p
            out[s] = round(p, 4)
        return out


class AlpacaLiveFeed:
    """Anchors to real Alpaca snapshot prices, re-fetched every REFRESH_S, with a
    small random walk between refreshes so the curve stays smooth (and keeps
    moving when the market is closed and the real price is frozen)."""

    REFRESH_S = 20.0

    def __init__(self, provider: AlpacaProvider) -> None:
        s = get_settings()
        self._provider = provider
        self._headers = {"APCA-API-KEY-ID": s.alpaca_api_key, "APCA-API-SECRET-KEY": s.alpaca_secret_key}
        self._feed = s.alpaca_feed
        self._prices: dict[str, float] = {}
        self._last_fetch = 0.0
        self._rng = np.random.default_rng()

    def _snapshots(self, symbols: list[str]) -> dict[str, float]:
        try:
            resp = httpx.get(
                f"{DATA_BASE}/v2/stocks/snapshots",
                headers=self._headers,
                params={"symbols": ",".join(symbols), "feed": self._feed},
                timeout=15,
            )
            resp.raise_for_status()
            out = {}
            for sym, snap in resp.json().items():
                p = (
                    (snap.get("latestTrade") or {}).get("p")
                    or (snap.get("dailyBar") or {}).get("c")
                    or (snap.get("prevDailyBar") or {}).get("c")
                )
                if p:
                    out[sym] = float(p)
            return out
        except Exception as exc:
            log.warning("Alpaca snapshot fetch failed: %s", exc)
            return {}

    def _fallback(self, symbol: str) -> float:
        try:
            df = self._provider.history(symbol)
            if not df.empty:
                return float(df["close"].iloc[-1])
        except Exception:
            pass
        return 100.0

    def price(self, symbol: str) -> float:
        if symbol not in self._prices:
            snap = self._snapshots([symbol])
            self._prices[symbol] = snap.get(symbol) or self._fallback(symbol)
        return self._prices[symbol]

    def tick(self, symbols: list[str]) -> dict[str, float]:
        now = time.time()
        if now - self._last_fetch > self.REFRESH_S:
            self._last_fetch = now
            for s, p in self._snapshots(symbols).items():
                self._prices[s] = p  # re-anchor to the real price
        out = {}
        for s in symbols:
            base = self._prices.get(s) or self._fallback(s)
            ann_vol = UNIVERSE.get(s, {}).get("vol", 0.25)
            step_vol = ann_vol / np.sqrt(252 * 390 * 30)
            base *= float(np.exp(self._rng.normal(0, step_vol)))
            self._prices[s] = base
            out[s] = round(base, 4)
        return out


def get_live_feed():
    settings = get_settings()
    if settings.market_data_provider == "alpaca" and settings.alpaca_api_key:
        provider = get_provider()
        if isinstance(provider, AlpacaProvider):
            return AlpacaLiveFeed(provider)
    return SimulatedFeed()
