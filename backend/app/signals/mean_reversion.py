"""Mean-reversion-family signals: z-score, Bollinger, pairs spread."""
import numpy as np
import pandas as pd

from .base import ParamSpec, Signal, SignalMeta


class ZScoreReversion(Signal):
    meta = SignalMeta(
        key="zscore",
        label="Z-Score Reversion",
        category="mean_reversion",
        description="Negative of the rolling z-score: stretched-above-mean scores short, stretched-below scores long.",
        params=[
            ParamSpec("lookback", "Lookback (days)", 20, 5, 120),
            ParamSpec("cap", "Score cap (z)", 3, 1, 5, 0.5),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        lb = int(self.params["lookback"])
        mean = closes.rolling(lb).mean()
        std = closes.rolling(lb).std()
        z = (closes - mean) / std.replace(0, np.nan)
        cap = float(self.params["cap"])
        return (-z).clip(-cap, cap) / cap


class Bollinger(Signal):
    meta = SignalMeta(
        key="bollinger",
        label="Bollinger Fade",
        category="mean_reversion",
        description="Fade band touches: price at the lower band scores +1 (buy), at the upper band -1 (sell).",
        params=[
            ParamSpec("period", "Band period (days)", 20, 5, 100),
            ParamSpec("num_std", "Band width (σ)", 2, 1, 4, 0.25),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        period = int(self.params["period"])
        k = float(self.params["num_std"])
        mid = closes.rolling(period).mean()
        band = closes.rolling(period).std() * k
        # %B inverted and re-centered: lower band -> +1, upper band -> -1
        pct_b = (closes - (mid - band)) / (2 * band).replace(0, np.nan)
        return (1 - 2 * pct_b).clip(-1.5, 1.5)


class PairsSpread(Signal):
    meta = SignalMeta(
        key="pairs",
        label="Pairs Spread",
        category="mean_reversion",
        description="Trades the z-scored log-price spread of each symbol against the most correlated peer in the universe: long the cheap leg, short the rich leg.",
        params=[
            ParamSpec("corr_window", "Correlation window (days)", 252, 60, 504),
            ParamSpec("z_window", "Spread z-score window (days)", 30, 10, 120),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        if closes.shape[1] < 2:
            return pd.DataFrame(np.nan, index=closes.index, columns=closes.columns)
        log_px = np.log(closes)
        rets = log_px.diff()
        cw, zw = int(self.params["corr_window"]), int(self.params["z_window"])
        # Pair each symbol with its highest-correlation peer over the full window
        # (static pairing keeps this O(n²) once, not per-day).
        corr = rets.tail(cw).corr()
        np.fill_diagonal(corr.values, -np.inf)
        partner = corr.idxmax()

        scores = pd.DataFrame(index=closes.index, columns=closes.columns, dtype=float)
        for sym in closes.columns:
            peer = partner[sym]
            spread = log_px[sym] - log_px[peer]
            z = (spread - spread.rolling(zw).mean()) / spread.rolling(zw).std().replace(0, np.nan)
            scores[sym] = (-z).clip(-3, 3) / 3
        return scores
