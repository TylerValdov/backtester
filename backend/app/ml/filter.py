"""Feature 1 — meta-labeling trade filter. Builds one training sample per
candidate entry — long or short (features at entry -> did the position, in its
intended direction, beat costs over the holding period), walk-forward predicts
P(win), and returns a take/skip mask. The signed base-signal feature lets one
model gate both long and short legs."""
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .features import FEATURE_NAMES_FILTER, build_feature_panel
from .walkforward import WalkForwardConfig, walk_forward_predict


@dataclass
class FilterConfig:
    model: str = "random_forest"
    threshold: float = 0.55
    rebalance: str = "weekly"
    position_mode: str = "long_top"
    top_n: int = 5
    cost_hurdle: float = 0.001       # holding return must beat this to count as a win
    train_window_days: int = 504
    retrain_every_days: int = 63
    min_train_samples: int = 200


@dataclass
class FilterResult:
    mask: pd.Series                  # MultiIndex(date, symbol) -> bool (take?)
    diagnostics: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    importances: dict = field(default_factory=dict)
    n_folds: int = 0


def build_filter_mask(closes: pd.DataFrame, base_scores: pd.DataFrame, cfg: FilterConfig) -> FilterResult:
    from ..backtest.runner import rebalance_dates, target_weights

    panel = build_feature_panel(closes, base_scores=base_scores)
    rebal = sorted(d for d in rebalance_dates(closes.index, cfg.rebalance) if d in closes.index)

    rows = []
    for i, d in enumerate(rebal):
        weights = target_weights(base_scores.loc[d], cfg.position_mode, cfg.top_n)
        # +1 for long legs, -1 for short legs; both are candidates to gate
        directions = {s: (1 if w > 0 else -1) for s, w in weights.items() if w != 0}
        if not directions:
            continue
        nxt = rebal[i + 1] if i + 1 < len(rebal) else closes.index[-1]
        for sym, direction in directions.items():
            entry = closes.at[d, sym]
            exit_ = closes.at[nxt, sym]
            if pd.isna(entry) or pd.isna(exit_) or entry <= 0:
                continue
            # position return is direction-aware: a short profits when price falls
            pos_ret = direction * (exit_ / entry - 1)
            feats = {name: panel[name].at[d, sym] for name in FEATURE_NAMES_FILTER}
            rows.append({"date": d, "symbol": sym, "label": int(pos_ret > cfg.cost_hurdle),
                         "resolved": nxt, "position_return": pos_ret, **feats})

    samples = pd.DataFrame(rows)
    if samples.empty:
        return FilterResult(pd.Series(dtype=bool))

    wf = WalkForwardConfig(cfg.train_window_days, cfg.retrain_every_days, cfg.min_train_samples)
    res = walk_forward_predict(samples, FEATURE_NAMES_FILTER, wf, cfg.model, "clf")

    keys = pd.MultiIndex.from_arrays([samples["date"], samples["symbol"]])
    prob = res.predictions.reindex(keys)
    # before the first trained fold there is no prediction -> take the trade
    take = (prob.isna()) | (prob >= cfg.threshold)
    mask = pd.Series(take.to_numpy(), index=keys)

    taken = samples["position_return"][take.to_numpy()]
    skipped = samples["position_return"][~take.to_numpy()]
    diagnostics = {
        "n_candidates": int(len(samples)),
        "pct_taken": float(take.mean()),
        "avg_return_taken": float(taken.mean()) if len(taken) else 0.0,
        "avg_return_skipped": float(skipped.mean()) if len(skipped) else 0.0,
        "threshold": cfg.threshold,
        "model": cfg.model,
    }
    return FilterResult(mask, diagnostics, res.metrics, res.importances, res.n_folds)
