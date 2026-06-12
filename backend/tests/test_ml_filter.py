import numpy as np
import pandas as pd

from app.data import get_provider
from app.ml.filter import FilterConfig, build_filter_mask
from app.signals import build_signal


def _setup():
    closes = get_provider().closes(["AAPL", "MSFT", "NVDA", "JPM", "XOM", "UNH", "GLD", "SPY"])
    closes = closes.loc[closes.index >= "2018-01-01"]
    scores = build_signal("sma_crossover", {"fast": 20, "slow": 100}).generate(closes)
    return closes, scores


def test_mask_aligns_and_reduces_or_equals_candidates():
    closes, scores = _setup()
    cfg = FilterConfig(model="random_forest", threshold=0.55, rebalance="weekly",
                       position_mode="long_top", top_n=4)
    res = build_filter_mask(closes, scores, cfg)
    assert isinstance(res.mask, pd.Series)  # MultiIndex(date, symbol) -> bool
    # diagnostics present
    for k in ("pct_taken", "avg_return_taken", "avg_return_skipped", "n_candidates"):
        assert k in res.diagnostics
    assert 0.0 <= res.diagnostics["pct_taken"] <= 1.0
    assert res.n_folds >= 1


def test_high_threshold_takes_fewer_trades():
    closes, scores = _setup()
    lo = build_filter_mask(closes, scores, FilterConfig(model="logistic", threshold=0.50,
                            rebalance="weekly", position_mode="long_top", top_n=4))
    hi = build_filter_mask(closes, scores, FilterConfig(model="logistic", threshold=0.70,
                            rebalance="weekly", position_mode="long_top", top_n=4))
    assert hi.diagnostics["pct_taken"] <= lo.diagnostics["pct_taken"] + 1e-9


def test_long_short_filters_both_legs():
    # In long_short mode the filter must build candidates for the short legs too,
    # not just the longs — every symbol that was shorted should be gateable.
    closes = get_provider().closes(["AAPL", "MSFT", "NVDA", "JPM", "XOM", "UNH", "GLD", "SPY"])
    closes = closes.loc[closes.index >= "2018-01-01"]
    scores = build_signal("zscore", {"lookback": 20}).generate(closes)
    cfg = FilterConfig(model="logistic", threshold=0.55, rebalance="weekly",
                       position_mode="long_short", top_n=3)
    res = build_filter_mask(closes, scores, cfg)

    from app.backtest.runner import rebalance_dates, target_weights

    rebal = sorted(d for d in rebalance_dates(closes.index, "weekly") if d in closes.index)
    shorted = {(d, s) for d in rebal for s, w in target_weights(scores.loc[d], "long_short", 3).items() if w < 0}
    assert shorted, "the zscore long_short config should produce some short legs"
    # at least some shorted (date, symbol) pairs appear in the mask -> they were gated
    assert any(key in res.mask.index for key in shorted)
    assert res.diagnostics["n_candidates"] > 0
