import numpy as np
import pandas as pd
import pytest

from app.ml.features import FEATURE_NAMES_FILTER, FEATURE_NAMES_RANK, build_feature_panel


def _closes(n=300, syms=("AAPL", "MSFT", "SPY")):
    idx = pd.bdate_range("2020-01-01", periods=n)
    rng = np.random.default_rng(1)
    data = {}
    for i, s in enumerate(syms):
        steps = rng.normal(0.0005, 0.01, n)
        data[s] = 100 * np.exp(np.cumsum(steps)) + i
    return pd.DataFrame(data, index=idx)


def test_panel_has_all_features_aligned():
    closes = _closes()
    scores = closes.pct_change(20)  # stand-in base signal
    panel = build_feature_panel(closes, base_scores=scores)
    for name in FEATURE_NAMES_FILTER:
        assert name in panel, f"missing {name}"
        assert panel[name].shape == closes.shape
        assert list(panel[name].columns) == list(closes.columns)


def test_rank_panel_excludes_signal():
    closes = _closes()
    panel = build_feature_panel(closes, base_scores=None)
    assert "signal" not in panel
    assert set(FEATURE_NAMES_RANK).issubset(panel.keys())


def test_features_use_only_past_data():
    # Editing a future price must not change a feature value at an earlier date.
    closes = _closes()
    scores = closes.pct_change(20)
    panel_a = build_feature_panel(closes, base_scores=scores)
    closes2 = closes.copy()
    closes2.iloc[250:] *= 1.5  # mutate the future
    panel_b = build_feature_panel(closes2, base_scores=scores)
    t = closes.index[200]
    for name in ("mom_21", "mom_63", "zscore_20", "rsi_14", "vol_21", "dist_ma200",
                 "mom_rank", "spy_above_200", "spy_mom_21"):
        a = panel_a[name].loc[t, "AAPL"]
        b = panel_b[name].loc[t, "AAPL"]
        assert (np.isnan(a) and np.isnan(b)) or a == pytest.approx(b), name


def test_regime_flags_are_binary_and_relative_rank_in_unit_interval():
    closes = _closes()
    panel = build_feature_panel(closes, base_scores=None)
    spy = panel["spy_above_200"].dropna()
    assert set(np.unique(spy.to_numpy())).issubset({0.0, 1.0})
    rank = panel["mom_rank"].dropna()
    assert rank.to_numpy().min() >= 0.0 and rank.to_numpy().max() <= 1.0
