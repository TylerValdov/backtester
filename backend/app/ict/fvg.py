"""Fair Value Gap detection.

A Fair Value Gap (FVG) is a 3-candle imbalance. Using candles c1 (oldest), c2,
c3 (newest), known only at c3's close (no lookahead):

  Bullish FVG: c3.low > c1.high  → unfilled gap [c1.high, c3.low] below price.
               Price often retraces DOWN into it → long on the tap.
  Bearish FVG: c3.high < c1.low  → unfilled gap [c3.high, c1.low] above price.
               Price often retraces UP into it → short on the tap.

`bottom` < `top` always; `kind` says which side the imbalance favors.
"""
from dataclasses import dataclass

import numpy as np


@dataclass
class Gap:
    kind: str          # "bull" | "bear"
    created_idx: int   # bar index of c3 (gap is known at this bar's close)
    bottom: float      # lower zone edge
    top: float         # upper zone edge
    dead: bool = False # consumed (entered) or invalidated


def detect_gap(high: np.ndarray, low: np.ndarray, close: np.ndarray, i: int, min_gap_frac: float) -> Gap | None:
    """Detect an FVG whose third candle is bar `i` (needs i >= 2). Returns None
    if there's no gap or it's smaller than `min_gap_frac` of price."""
    if i < 2:
        return None
    price = close[i]
    if price <= 0:
        return None
    if low[i] > high[i - 2]:  # bullish imbalance
        bottom, top, kind = high[i - 2], low[i], "bull"
    elif high[i] < low[i - 2]:  # bearish imbalance
        bottom, top, kind = high[i], low[i - 2], "bear"
    else:
        return None
    if (top - bottom) / price < min_gap_frac:
        return None
    return Gap(kind=kind, created_idx=i, bottom=float(bottom), top=float(top))
