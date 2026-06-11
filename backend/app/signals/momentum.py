"""Momentum-family signals: trend following, RSI, MACD, breakout."""
import numpy as np
import pandas as pd

from .base import ParamSpec, Signal, SignalMeta


class SmaCrossover(Signal):
    meta = SignalMeta(
        key="sma_crossover",
        label="SMA Crossover",
        category="momentum",
        description="Long when the fast simple moving average sits above the slow one; score is the normalized spread between them.",
        params=[
            ParamSpec("fast", "Fast window (days)", 20, 5, 100),
            ParamSpec("slow", "Slow window (days)", 100, 20, 250),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        fast = closes.rolling(int(self.params["fast"])).mean()
        slow = closes.rolling(int(self.params["slow"])).mean()
        return (fast - slow) / slow


class TimeSeriesMomentum(Signal):
    meta = SignalMeta(
        key="momentum",
        label="Price Momentum",
        category="momentum",
        description="Trailing total return over the lookback, skipping the most recent days to dodge short-term reversal.",
        params=[
            ParamSpec("lookback", "Lookback (days)", 126, 20, 252),
            ParamSpec("skip", "Skip recent (days)", 10, 0, 30),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        lb, skip = int(self.params["lookback"]), int(self.params["skip"])
        return closes.shift(skip) / closes.shift(lb) - 1


class Rsi(Signal):
    meta = SignalMeta(
        key="rsi",
        label="RSI Regime",
        category="momentum",
        description="Wilder's RSI mapped to [-1, 1]: above 50 scores positive (trend persistence reading, not a reversal trade).",
        params=[
            ParamSpec("period", "RSI period (days)", 14, 5, 50),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        period = int(self.params["period"])
        delta = closes.diff()
        gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
        rs = gain / loss.replace(0, np.nan)
        rsi = 100 - 100 / (1 + rs)
        return (rsi - 50) / 50


class Macd(Signal):
    meta = SignalMeta(
        key="macd",
        label="MACD Histogram",
        category="momentum",
        description="MACD histogram (12/26/9 by default) normalized by price — positive histogram means accelerating trend.",
        params=[
            ParamSpec("fast", "Fast EMA", 12, 5, 50),
            ParamSpec("slow", "Slow EMA", 26, 10, 100),
            ParamSpec("signal", "Signal EMA", 9, 3, 30),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        fast = closes.ewm(span=int(self.params["fast"]), adjust=False).mean()
        slow = closes.ewm(span=int(self.params["slow"]), adjust=False).mean()
        macd = fast - slow
        sig = macd.ewm(span=int(self.params["signal"]), adjust=False).mean()
        return (macd - sig) / closes


class Breakout(Signal):
    meta = SignalMeta(
        key="breakout",
        label="Channel Breakout",
        category="momentum",
        description="Donchian-style: +1 when price breaks the rolling high, -1 on a break of the rolling low, scaled in between.",
        params=[
            ParamSpec("lookback", "Channel lookback (days)", 55, 10, 200),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        lb = int(self.params["lookback"])
        hi = closes.rolling(lb).max()
        lo = closes.rolling(lb).min()
        # Position of price inside the channel mapped to [-1, 1]
        return ((closes - lo) / (hi - lo).replace(0, np.nan)) * 2 - 1
