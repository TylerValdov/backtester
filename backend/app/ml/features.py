"""Entry feature block. Every feature at date t derives only from data <= t."""
import numpy as np
import pandas as pd

from ..data import BENCHMARK

FEATURE_NAMES_RANK = [
    "mom_21", "mom_63", "zscore_20", "rsi_14", "vol_21",
    "dist_ma200", "mom_rank", "spy_above_200", "spy_mom_21",
]
FEATURE_NAMES_FILTER = ["signal", *FEATURE_NAMES_RANK]


def _rsi(closes: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    delta = closes.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)) / 100  # scaled to [0, 1]


def build_feature_panel(closes: pd.DataFrame, base_scores: pd.DataFrame | None) -> dict[str, pd.DataFrame]:
    cols = closes.columns
    panel: dict[str, pd.DataFrame] = {}

    panel["mom_21"] = closes / closes.shift(21) - 1
    panel["mom_63"] = closes / closes.shift(63) - 1
    panel["zscore_20"] = (closes - closes.rolling(20).mean()) / closes.rolling(20).std()
    panel["rsi_14"] = _rsi(closes, 14)
    panel["vol_21"] = closes.pct_change().rolling(21).std() * np.sqrt(252)
    ma200 = closes.rolling(200).mean()
    panel["dist_ma200"] = (closes - ma200) / ma200
    # cross-sectional percentile rank of 63d momentum across the universe at t
    panel["mom_rank"] = panel["mom_63"].rank(axis=1, pct=True)

    # market regime from the benchmark, broadcast to every column
    if BENCHMARK in closes.columns:
        spy = closes[BENCHMARK]
    else:
        spy = closes.mean(axis=1)  # fallback proxy if SPY absent from the frame
    spy_above = (spy > spy.rolling(200).mean()).astype(float)
    spy_mom = spy / spy.shift(21) - 1
    panel["spy_above_200"] = pd.DataFrame({c: spy_above for c in cols})
    panel["spy_mom_21"] = pd.DataFrame({c: spy_mom for c in cols})

    if base_scores is not None:
        panel["signal"] = base_scores.reindex(index=closes.index, columns=cols)

    return panel
